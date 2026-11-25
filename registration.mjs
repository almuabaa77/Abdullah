import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { preciseLocation, validNationalId } from './public/registration-fields.js';

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
  function invitationPending(userId) {
    return !!get('SELECT 1 FROM registration_invites WHERE user_id=? AND used IS NULL', userId);
  }
  function inviteDigest(userId, code) {
    return createHmac('sha256', key).update(`invite:${userId}:${code}`).digest();
  }
  function issueInvitation(userId) {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const expiresAt = clock() + 86_400_000;
    run(`INSERT INTO registration_invites(user_id,digest,expires,attempts) VALUES(?,?,?,0)
      ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest, expires=excluded.expires, attempts=0`,
    userId, inviteDigest(userId, code), expiresAt);
    return { code, expiresAt };
  }
  function redeemInvitation(userId, code) {
    const outcome = transaction(() => {
      const row = get('SELECT * FROM registration_invites WHERE user_id=? AND used IS NULL', userId);
      const account = get('SELECT approval FROM users WHERE id=?', userId);
      if (!row || account?.approval !== 'pending') return 'invitation_unavailable';
      const time = clock();
      if (row.expires <= time || row.attempts >= 5) return 'invitation_expired';
      if (!timingSafeEqual(row.digest, inviteDigest(userId, code))) {
        run('UPDATE registration_invites SET attempts=attempts+1 WHERE user_id=?', userId);
        return row.attempts >= 4 ? 'invitation_expired' : 'invalid_invitation';
      }
      run('UPDATE registration_invites SET used=?, digest=NULL WHERE user_id=?', time, userId);
      return null;
    });
    if (outcome) fail(400, outcome);
  }
  function tracking(user) {
    let row = get('SELECT reference,submitted,decided FROM registration_tracking WHERE user_id=?', user.id);
    if (!row && user.approval === 'pending') {
      const reference = 'WSR-' + randomBytes(8).toString('hex').toUpperCase();
      if (!run('INSERT OR IGNORE INTO registration_tracking(user_id,reference,submitted) VALUES(?,?,?)',
        user.id, reference, user.needs_registration ? null : user.created).changes) {
        return get('SELECT reference,submitted,decided FROM registration_tracking WHERE user_id=?', user.id);
      }
      row = { reference, submitted: user.needs_registration ? null : user.created, decided: null };
    }
    return row || null;
  }
  return { check, issue, reserve, finish, saveEvidence, evidence, invitationPending, issueInvitation, redeemInvitation, tracking };
}

export function registrationPacket(data, fail) {
  const nationalId = data.nationalId;
  if (!validNationalId(nationalId)) fail(400, 'invalid_national_id');
  const address = typeof data.address === 'string' ? data.address.trim() : '';
  if (address.length < 10 || address.length > 240) fail(400, 'invalid_registration_address');
  if (!preciseLocation(data.location)) fail(400, 'invalid_location');
  const { latitude, longitude, accuracy } = data.location;
  for (const [photo, error] of [[data.selfie, 'registration_selfie_required'], [data.identity, 'registration_id_photo_required']]) {
    if (typeof photo !== 'string' || photo.length > 1_400_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo)) fail(400, error);
    const bytes = Buffer.from(photo, 'base64');
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail(400, error);
  }
  return { nationalId, address, location: { latitude, longitude, accuracy }, selfie: data.selfie, identity: data.identity };
}
