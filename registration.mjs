import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export const codeLifetime = 120_000;
const lockDuration = 31 * 60_000;

export function createRegistration({ get, run, transaction, fail, secret, clock = Date.now }) {
  const key = createHmac('sha256', secret).update('waslah-registration-v1').digest();
  function check(phone) {
    const row = get('SELECT * FROM phone_challenges WHERE phone=?', phone);
    if (row?.locked > clock()) fail(429, 'verification_locked', { retryAt: row.locked, serverTime: clock() });
    if (row?.busy > clock()) fail(409, 'verification_busy');
    return row;
  }
  function issue(phone, providerSession = null) {
    return transaction(() => {
      const row = check(phone);
      const time = clock();
      if (providerSession) {
        const token = createHmac('sha256', key).update(providerSession).digest('hex');
        if (!run('INSERT OR IGNORE INTO phone_provider_sessions VALUES(?,?)', token, time + 86_400_000).changes) {
          fail(400, 'verification_expired');
        }
      }
      const id = randomBytes(24).toString('hex');
      const expiresAt = time + codeLifetime;
      run(`INSERT INTO phone_challenges(phone,id,provider_session,expires,attempts,locked,busy)
        VALUES(?,?,?,?,?,0,0) ON CONFLICT(phone) DO UPDATE SET id=excluded.id,
        provider_session=excluded.provider_session,expires=excluded.expires,
        attempts=excluded.attempts,locked=0,busy=0`,
      phone, id, providerSession, expiresAt, row?.locked || !row || time - row.expires > lockDuration ? 0 : row.attempts);
      return { phone, challenge: id, expiresAt, serverTime: time };
    });
  }
  function reserve(phone, id) {
    return transaction(() => {
      const row = check(phone);
      if (!row || row.id !== id || row.expires <= clock()) fail(400, 'verification_expired');
      run('UPDATE phone_challenges SET busy=? WHERE phone=?', clock() + 30_000, phone);
      return row.provider_session;
    });
  }
  function finish(phone, id, outcome) {
    return transaction(() => {
      const row = get('SELECT * FROM phone_challenges WHERE phone=? AND id=?', phone, id);
      if (!row) return { locked: 0, accepted: false };
      const attempts = row.attempts + (outcome === 'invalid' ? 1 : 0);
      const locked = attempts >= 3 ? clock() + lockDuration : 0;
      const accepted = outcome === 'accepted';
      run('UPDATE phone_challenges SET busy=0, attempts=?, locked=?, id=?, provider_session=? WHERE phone=?',
        accepted ? 0 : attempts, locked, accepted || locked ? '' : id, accepted || locked ? null : row.provider_session, phone);
      return { locked, accepted: accepted && row.expires > clock() };
    });
  }
  function saveEvidence(userId, packet) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(String(userId)));
    const data = Buffer.concat([cipher.update(JSON.stringify(packet), 'utf8'), cipher.final()]);
    run('INSERT INTO registration_evidence(user_id, iv, tag, data) VALUES(?,?,?,?)', userId, iv, cipher.getAuthTag(), data);
  }
  function evidence(userId) {
    const row = get('SELECT iv, tag, data FROM registration_evidence WHERE user_id=?', userId);
    if (!row) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, row.iv);
    decipher.setAAD(Buffer.from(String(userId)));
    decipher.setAuthTag(row.tag);
    return JSON.parse(Buffer.concat([decipher.update(row.data), decipher.final()]).toString('utf8'));
  }
  return { check, issue, reserve, finish, saveEvidence, evidence };
}

export function registrationPacket(data, fail) {
  const nationalId = data.nationalId;
  if (typeof nationalId !== 'string' || !/^[12]\d{9}$/.test(nationalId)) fail(400, 'invalid_national_id');
  const checksum = [...nationalId].reduce((sum, digit, index) => {
    const value = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return sum + (value > 9 ? value - 9 : value);
  }, 0);
  if (checksum % 10 !== 0) fail(400, 'invalid_national_id');
  const address = typeof data.address === 'string' ? data.address.trim() : '';
  const { latitude, longitude, accuracy } = data.location || {};
  if (address.length < 10 || address.length > 240 || !Number.isFinite(latitude) || Math.abs(latitude) > 90
      || !Number.isFinite(longitude) || Math.abs(longitude) > 180
      || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 50) fail(400, 'invalid_location');
  for (const photo of [data.selfie, data.identity]) {
    if (typeof photo !== 'string' || photo.length > 1_400_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo)) fail(400, 'registration_photo_required');
    const bytes = Buffer.from(photo, 'base64');
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail(400, 'registration_photo_required');
  }
  return { nationalId, address, location: { latitude, longitude, accuracy }, selfie: data.selfie, identity: data.identity };
}
