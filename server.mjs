import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, createReadStream, statSync } from 'node:fs';
import { resolve, dirname, extname, relative, isAbsolute, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { statuses } from './public/catalog.js';
import { createOperations, migrateOperations } from './operations.mjs';
import { answerConversation, prepareConversation } from './assistant.mjs';
import { readFirebaseConfig, verifiedPhone, verifierFor } from './firebase-provider.mjs';
import { normalizePhone } from './public/phone.js';
import { createMarketplace, isActive, migrateMarketplace } from './marketplace.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(root, 'public');
const sessionAge = 7 * 24 * 60 * 60;

class StartupConfigurationError extends Error {}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };
const publicUser = ({ id, phone, name, role, approval, city, created }) => ({ id, phone, name, role, approval, city, created });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
const nextStatuses = {
  new: ['in_progress', 'needs_info', 'rejected'], in_progress: ['needs_info', 'completed', 'rejected'],
  needs_info: ['in_progress', 'completed', 'rejected'], completed: [], rejected: [],
};
const now = () => new Date().toISOString();
function phoneNumber(value) {
  const phone = normalizePhone(value);
  if (!phone) fail(400, 'invalid_phone');
  return phone;
}
function input(value, max, required = false) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    fail(400, 'invalid_input');
  }
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max) fail(400, 'invalid_input');
  return trimmed;
}
async function body(req, limit = 8192) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'invalid_input');
  const data = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) fail(413, 'too_large');
    data.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(data).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'invalid_input');
    return value;
  } catch {
    fail(400, 'invalid_input');
  }
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function documentFile(file) {
  if (!file) return null;
  const name = input(file.name, 160, true);
  const data = Buffer.from(input(file.data, 6990520, true), 'base64');
  if (data.length > 5 * 1024 * 1024) fail(413, 'too_large');
  let type;
  if (data.subarray(0, 5).toString() === '%PDF-') type = 'application/pdf';
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) type = 'image/png';
  if (data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) type = 'image/jpeg';
  if (!type) fail(400, 'invalid_file');
  return { name, data, type };
}

function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL, approval TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY, service TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES users(id),
      agent_id INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'new',
      details TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      request_id INTEGER PRIMARY KEY REFERENCES requests(id), name TEXT NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
      user_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      request_id INTEGER REFERENCES requests(id), kind TEXT NOT NULL, value TEXT, created TEXT NOT NULL, seen INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS requests_customer ON requests(customer_id);
    CREATE INDEX IF NOT EXISTS requests_agent ON requests(agent_id);
    CREATE INDEX IF NOT EXISTS events_user ON events(user_id, id);
  `);
  migrateMarketplace(db);
  migrateOperations(db);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return db;
}

export function makeApp({
  database, marketClock = Date.now, verifySms,
  adminPhone = process.env.ADMIN_PHONE, assistantKey = process.env.OPENAI_API_KEY,
  firebase,
  verifyFirebase,
} = {}) {
  const production = process.env.NODE_ENV === 'production';
  const provider = process.env.AUTH_PROVIDER;
  if (provider && !['firebase', 'twilio'].includes(provider)) {
    throw new StartupConfigurationError('AUTH_PROVIDER must be firebase or twilio.');
  }
  if (firebase === undefined) {
    try {
      firebase = provider === 'twilio' ? null : readFirebaseConfig(process.env.FIREBASE_WEB_CONFIG);
    } catch (error) {
      throw new StartupConfigurationError(error.message, { cause: error });
    }
  }
  const twilio = Boolean(process.env.TWILIO_VERIFY_SERVICE_SID && (
    process.env.TWILIO_VERIFY_AUTHORIZATION || (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ));
  const sms = firebase ? null : (verifySms ?? (twilio ? verifyService : null));
  const secret = process.env.SESSION_SECRET;
  const missing = [];
  if (provider === 'firebase' && !firebase) missing.push('FIREBASE_WEB_CONFIG');
  else if (production && !firebase && !sms) missing.push('FIREBASE_WEB_CONFIG or Twilio Verify settings');
  if (production && (!secret || secret.length < 32)) missing.push('SESSION_SECRET (32+ characters)');
  if (production && !adminPhone) missing.push('ADMIN_PHONE');
  if (missing.length) throw new StartupConfigurationError(`Set ${missing.join(', ')}.`);

  const phone = normalizePhone(adminPhone);
  if (adminPhone && !phone) throw new StartupConfigurationError('ADMIN_PHONE must contain a valid phone number.');
  let verifyIdentity = null;
  if (firebase) {
    try {
      verifyIdentity = verifyFirebase ?? verifierFor(firebase.projectId);
    } catch (error) {
      throw new StartupConfigurationError(error.message, { cause: error });
    }
  }
  const sessionSecret = secret || randomBytes(32).toString('hex');
  const digest = value => createHmac('sha256', sessionSecret).update(value).digest('hex');
  const cookieName = process.env.FIREBASE_HOSTING === '1' ? '__session' : 'waslah_session';
  const dbPath = database ?? (process.env.DATABASE_PATH || resolve(root, production ? 'data/production.sqlite' : 'data/waslah.sqlite'));
  const db = openDatabase(dbPath);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const createUser = (phone, name, role, approval) => run(
    'INSERT OR IGNORE INTO users(phone,name,role,approval,created) VALUES(?,?,?,?,?)', phone, name, role, approval, now());
  const byPhone = phone => get('SELECT * FROM users WHERE phone = ?', phone);
  const transaction = action => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = action();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const notice = (user, request, kind, value = null) => {
    if (user) run('INSERT INTO events(user_id,request_id,kind,value,created) VALUES(?,?,?,?,?)', user, request, kind, value, now());
  };
  const market = createMarketplace({ get, all, run, transaction, notice, fail, input, clock: marketClock });
  const ops = createOperations({ get, all, run, input, fail, stamp: now });
  if (phone) {
    createUser(phone, process.env.ADMIN_NAME || 'إدارة وصلة', 'admin', 'approved');
    if (byPhone(phone).role !== 'admin') {
      db.close();
      throw new StartupConfigurationError('ADMIN_PHONE already belongs to a non-admin account.');
    }
  }
  const limits = new Map();
  const cleanup = setInterval(() => {
    const time = Date.now();
    for (const [key, entry] of limits) if (entry.until < time) limits.delete(key);
    run('DELETE FROM sessions WHERE expires < ?', time);
  }, 300000);
  cleanup.unref();

  function rate(key, max, windowMs) {
    const time = Date.now();
    const entry = limits.get(key);
    if (!entry || entry.until < time) {
      limits.set(key, { count: 1, until: time + windowMs });
      return;
    }
    if (entry.count >= max) fail(429, 'rate_limited');
    entry.count++;
  }
  function setSession(res, user) {
    const token = randomBytes(32).toString('hex');
    run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', digest(token), user.id, Date.now() + sessionAge * 1000);
    res.setHeader('Set-Cookie', cookie(token, sessionAge));
    return publicUser(user);
  }
  function cookie(token, age) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? '; Secure' : ''}`;
  }
  function tokenFrom(req) {
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
  }
  const listSql = `SELECT r.*, c.name AS customer_name, a.name AS agent_name, f.name AS attachment
    FROM requests r JOIN users c ON c.id = r.customer_id LEFT JOIN users a ON a.id = r.agent_id
    LEFT JOIN attachments f ON f.request_id = r.id`;
  function accessRequest(user, id) {
    const request = get(listSql + ' WHERE r.id = ?', id);
    if (!request || (user.role !== 'admin' && request.customer_id !== user.id && request.agent_id !== user.id)) fail(404, 'not_found');
    return request;
  }
  async function verifyService(endpoint, values) {
    const base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID)}`;
    const authorization = process.env.TWILIO_VERIFY_AUTHORIZATION ||
      'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    let response;
    try {
      response = await fetch(`${base}/${endpoint}`, {
        method: 'POST', headers: { Authorization: authorization },
        body: new URLSearchParams(values), signal: AbortSignal.timeout(10000),
      });
    } catch {
      fail(503, 'sms_unavailable');
    }
    if (response.status === 429) fail(429, 'rate_limited');
    if (!response.ok) fail(endpoint === 'VerificationCheck' && [400, 404].includes(response.status) ? 400 : 503,
      endpoint === 'VerificationCheck' && [400, 404].includes(response.status) ? 'invalid_code' : 'sms_unavailable');
    return response.json();
  }

  function completePhoneLogin(phone, data, req, res) {
    let user = byPhone(phone);
    if (user?.approval === 'blocked') fail(403, 'account_blocked');
    if (!user) {
      if (!['customer', 'agent'].includes(data.role)) fail(400, 'invalid_input');
      createUser(phone, input(data.name, 72, true), data.role, 'pending');
      user = byPhone(phone);
    }
    const token = tokenFrom(req);
    if (token) run('DELETE FROM sessions WHERE token = ?', token);
    return send(res, 200, setSession(res, user));
  }

  async function api(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    if (!['GET', 'HEAD'].includes(method) && req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'forbidden');
    if (method === 'GET' && pathname === '/api/health') {
      get('SELECT id FROM users LIMIT 1');
      return send(res, 200, { ok: true });
    }
    if (method === 'GET' && pathname === '/api/config') return send(res, 200, { sms: !!(sms || verifyIdentity), firebase, ai: !!assistantKey, market: true });
    if (pathname === '/api/demo') fail(404, 'not_found');
    if (method === 'POST' && pathname === '/api/auth/send') {
      if (!sms) fail(503, 'sms_unavailable');
      const phone = phoneNumber((await body(req)).phone);
      rate('send:' + phone, 1, 55000);
      rate('send-hour:' + phone, 6, 3600000);
      await sms('Verifications', { To: phone, Channel: 'sms' });
      return send(res, 200, { phone });
    }
    if (method === 'POST' && pathname === '/api/auth/verify') {
      const data = await body(req);
      const phone = phoneNumber(data.phone);
      if (!sms) fail(503, 'sms_unavailable');
      const code = input(data.code, 6, true);
      if (!/^\d{6}$/.test(code)) fail(400, 'invalid_code');
      rate('verify:' + phone, 10, 300000);
      const check = await sms('VerificationCheck', { To: phone, Code: code });
      if (check.status !== 'approved') fail(400, 'invalid_code');
      return completePhoneLogin(phone, data, req, res);
    }
    if (method === 'POST' && pathname === '/api/auth/firebase') {
      if (!verifyIdentity) fail(404, 'not_found');
      const data = await body(req);
      const proof = input(data.idToken, 6000, true);
      rate('firebase-verify:' + req.socket.remoteAddress, 300, 300000);
      let claims;
      try { claims = await verifyIdentity(proof); }
      catch (error) {
        if (error?.code === 'auth/internal-error' || error?.code === 'app/network-error') fail(503, 'sms_unavailable');
        fail(400, 'invalid_code');
      }
      const phone = verifiedPhone(claims, firebase.projectId);
      if (!phone) fail(400, 'invalid_code');
      return completePhoneLogin(phone, data, req, res);
    }
    const token = tokenFrom(req);
    if (method === 'POST' && pathname === '/api/auth/logout') {
      if (token) run('DELETE FROM sessions WHERE token = ?', token);
      res.setHeader('Set-Cookie', cookie('', 0));
      return send(res, 200, { ok: true });
    }
    const user = token && get('SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = ? AND s.expires > ?', token, Date.now());
    if (method === 'GET' && pathname === '/api/me') return send(res, 200, { user: user ? publicUser(user) : null });
    if (!user) fail(401, 'unauthorized');
    if (user.approval !== 'approved') fail(403, 'approval_required');
    const actionBody = async limit => {
      const data = await body(req, limit);
      if (!get("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.approval='approved'", token, Date.now())) fail(403, 'approval_required');
      return data;
    };
    if (method === 'PATCH' && pathname === '/api/me') {
      const data = await actionBody();
      const profile = transaction(() => {
        const current = get('SELECT * FROM users WHERE id=?', user.id);
        if (current.approval !== 'approved') fail(403, 'approval_required');
        ops.updateIdentity(current, data, user.id);
        return publicUser(get('SELECT * FROM users WHERE id=?', user.id));
      });
      return send(res, 200, { user: profile });
    }
    if (method === 'GET' && pathname === '/api/services') return send(res, 200, ops.catalog(false));
    if (pathname === '/api/admin/services' && ['GET', 'POST'].includes(method)) {
      if (user.role !== 'admin') fail(403, 'forbidden');
      if (method === 'GET') return send(res, 200, ops.catalog(true));
      const data = await actionBody(16000);
      return send(res, 201, transaction(() => ops.saveService(null, data)));
    }
    const serviceMatch = pathname.match(/^\/api\/admin\/services\/([a-f0-9-]+)$/);
    if (serviceMatch && method === 'PATCH') {
      if (user.role !== 'admin') fail(403, 'forbidden');
      const data = await actionBody(16000);
      return send(res, 200, transaction(() => ops.saveService(serviceMatch[1], data)));
    }


    if (pathname === '/api/market/profile' && user.role === 'agent') {
      if (method === 'GET') return send(res, 200, market.profile(user.id));
      if (method === 'PATCH') {
        const data = await actionBody();
        return send(res, 200, transaction(() => market.updateProfile(user.id, data, false)));
      }
    }
    if (pathname === '/api/market/live' && method === 'GET' && user.role === 'agent') {
      return send(res, 200, market.live(user.id));
    }
    const marketMatch = pathname.match(/^\/api\/market\/(\d+)\/(claim|offer|choose|withdraw|rate)$/);
    if (marketMatch && method === 'POST') {
      market.marketAction(Number(marketMatch[1]), user, marketMatch[2], await actionBody());
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/requests') {
      const condition = user.role === 'admin' ? '' : user.role === 'agent' ? ' WHERE r.agent_id = ?' : ' WHERE r.customer_id = ?';
      return send(res, 200, all(listSql + condition + ' ORDER BY r.id DESC', ...(condition ? [user.id] : [])));
    }
    if (method === 'POST' && pathname === '/api/requests') {
      if (user.role !== 'customer') fail(403, 'forbidden');
      const data = await actionBody(7020000);
      const serviceId = input(data.service, 70, true);
      const details = input(data.details, 2000, true);
      const file = documentFile(data.file);
      const id = transaction(() => {
        const service = serviceId === 'manual' ? null : ops.service(serviceId);
        if (serviceId !== 'manual' && !service) fail(404, 'not_found');
        const { mode, title, city, specialty, brief, opened, ranking } = market.config(data, service?.specialty);
        const stamp = now();
        const { lastInsertRowid } = run(
          'INSERT INTO requests(service,customer_id,details,created,updated,mode,title,city,specialty,brief,opened_at,ranking,catalog_title_ar,catalog_title_en) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          serviceId, user.id, details, stamp, stamp, mode, title, city, specialty, brief, opened, ranking, service?.name[0] ?? null, service?.name[1] ?? null);
        if (file) run('INSERT INTO attachments VALUES(?,?,?,?)', lastInsertRowid, file.name, file.type, file.data);
        for (const admin of all("SELECT id FROM users WHERE role = 'admin' AND approval = 'approved'")) {
          notice(admin.id, lastInsertRowid, 'new');
        }
        return lastInsertRowid;
      });
      return send(res, 201, { id });
    }
    const requestMatch = pathname.match(/^\/api\/requests\/(\d+)(?:\/(messages|attachment))?$/);
    if (requestMatch) {
      const id = Number(requestMatch[1]);
      const section = requestMatch[2];
      const request = accessRequest(user, id);
      if (method === 'GET' && section === 'attachment') {
        const file = get('SELECT * FROM attachments WHERE request_id = ?', id);
        if (!file) fail(404, 'not_found');
        res.writeHead(200, { 'Content-Type': file.type, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
          'Content-Length': file.data.length, 'Cache-Control': 'no-store' });
        return res.end(file.data);
      }
      if (method === 'GET' && !section) {
        const messages = all('SELECT m.*, u.name, u.role FROM messages m JOIN users u ON u.id=m.user_id WHERE request_id=? ORDER BY m.id', id);
        return send(res, 200, { ...request, messages, ...market.details(request, user) });
      }
      if (method === 'POST' && section === 'messages') {
        const data = await actionBody(7020000);
        const message = input(data.text, 1500, true);
        const file = documentFile(data.file);
        transaction(() => {
          const current = accessRequest(user, id);
          if (file && (user.role !== 'customer' || !nextStatuses[current.status].length)) fail(403, 'forbidden');
          run('INSERT INTO messages(request_id,user_id,text,created) VALUES(?,?,?,?)', id, user.id, message, now());
          if (file) {
            run('INSERT OR REPLACE INTO attachments VALUES(?,?,?,?)', id, file.name, file.type, file.data);
            run('UPDATE requests SET updated=? WHERE id=?', now(), id);
          }
          const recipients = new Set([current.customer_id, current.agent_id]);
          if (!current.agent_id) {
            for (const admin of all("SELECT id FROM users WHERE role = 'admin' AND approval = 'approved'")) recipients.add(admin.id);
          }
          for (const recipient of recipients) {
            if (recipient !== user.id) notice(recipient, id, 'message');
          }
        });
        return send(res, 201, { ok: true });
      }
      if (method === 'PATCH' && !section) {
        const data = await actionBody();
        if (user.role === 'customer') fail(403, 'forbidden');
        transaction(() => {
          // Recheck authorization and transition state after the request body has been received.
          const current = accessRequest(user, id);
          if (data.reopen !== undefined) {
            if (user.role !== 'admin') fail(403, 'forbidden');
            if (data.agent_id !== undefined || data.status !== undefined) fail(400, 'invalid_input');
            market.reopen(current, data.reopen);
            return;
          }
          if (data.agent_id !== undefined) {
            if (user.role !== 'admin') fail(403, 'forbidden');
            if (!Number.isInteger(data.agent_id) || data.status !== undefined) fail(400, 'invalid_input');
            const candidate = get("SELECT id FROM offers WHERE request_id=? AND agent_id=? AND status='open'", id, data.agent_id);
            market.assign(current, data.agent_id, candidate?.id);
          }
          if (data.status && data.status !== current.status) {
            if (!nextStatuses[current.status].includes(data.status)) fail(409, 'invalid_transition');
            if (current.mode !== 'admin' && !current.agent_id && data.status !== 'rejected') fail(409, 'invalid_transition');
            run('UPDATE requests SET status=?, updated=? WHERE id=?', data.status, now(), id);
            market.log(id, 'status', data.status);
            if (!isActive(data.status)) {
              run("UPDATE offers SET status='closed' WHERE request_id=? AND status='open'", id);
              market.syncBatch(current.agent_id);
            }
            notice(current.customer_id, id, 'status', data.status);
          }
        });
        return send(res, 200, { ok: true });
      }
    }
    if (method === 'GET' && pathname === '/api/admin/users') {
      if (user.role !== 'admin') fail(403, 'forbidden');
      return send(res, 200, market.directory());
    }
    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && method === 'GET') {
      if (user.role !== 'admin') fail(403, 'forbidden');
      return send(res, 200, ops.auditFor(Number(userMatch[1])));
    }
    if (userMatch && method === 'PATCH') {
      if (user.role !== 'admin') fail(403, 'forbidden');
      const data = await actionBody();
      const id = Number(userMatch[1]);
      transaction(() => {
        const account = get("SELECT * FROM users WHERE id=? AND role<>'admin'", id);
        if (!account) fail(404, 'not_found');
        if (data.approval !== undefined) {
          const allowed = {
            pending: ['approved', 'rejected', 'blocked'], approved: ['suspended', 'blocked'],
            suspended: ['approved', 'blocked'], rejected: ['approved', 'blocked'], blocked: ['approved'],
          };
          if (!allowed[account.approval].includes(data.approval)) fail(409, 'invalid_transition');
          run('UPDATE users SET approval=? WHERE id=?', data.approval, id);
          if (data.approval === 'blocked') run('DELETE FROM sessions WHERE user_id=?', id);
          ops.audit(id, user.id, 'approval', account.approval, data.approval);
        }
        ops.updateIdentity(account, data, user.id);
        if (data.specialties !== undefined || data.pause !== undefined) {
          if (account.role !== 'agent') fail(400, 'invalid_input');
          const profile = market.updateProfile(id, { specialties: data.specialties, pause: data.pause }, true);
          ops.audit(id, user.id, 'specialties', account.specialties, JSON.stringify(profile.specialties));
          ops.audit(id, user.id, 'paused_until', String(account.paused_until), String(profile.paused_until));
        }
      });
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/notifications') {
      if (method === 'GET') {
        const events = user.role === 'agent'
          ? all('SELECT e.* FROM events e JOIN requests r ON r.id=e.request_id WHERE e.user_id=? AND r.agent_id=? ORDER BY e.id DESC LIMIT 30', user.id, user.id)
          : all('SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id);
        return send(res, 200, events);
      }
      if (method === 'POST') {
        run('UPDATE events SET seen=1 WHERE user_id=? AND seen=0', user.id);
        return send(res, 200, { ok: true });
      }
    }
    if (pathname === '/api/assistant' && method === 'POST') {
      rate('assistant:' + user.id, 20, 60000);
      const data = await actionBody(32000);
      const conversation = prepareConversation(data, input);
      if (!conversation) fail(400, 'invalid_input');
      const requestedId = conversation.question.match(/WS-(\d+)/i)?.[1];
      let knownRequest;
      if (requestedId) {
        const id = Number(requestedId) - 1000;
        const row = Number.isSafeInteger(id) && get('SELECT id,status,customer_id,agent_id FROM requests WHERE id=?', id);
        const permitted = row && (user.role === 'admin' || row.customer_id === user.id || row.agent_id === user.id);
        const english = conversation.lang === 'en';
        knownRequest = permitted ? {
          answer: english ? `The latest status for WS-${requestedId} is ${statuses[row.status][1]}.` : `آخر حالة مسجّلة للطلب WS-${requestedId} هي «${statuses[row.status][0]}».`,
          action: 'request:' + id,
        } : { answer: english ? 'I couldn’t find that request in your account. Check the number under Requests.' : 'ما لقيت هذا الطلب في حسابك. تأكد من رقمه في قسم الطلبات.', action: 'requests' };
      }
      return send(res, 200, await answerConversation({
        conversation, catalog: ops.catalog(false), knownRequest, requester: user.role,
        apiKey: assistantKey, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      }));
    }
    fail(404, 'not_found');
  }

  const server = createWebServer(firebase, api);
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return server;
}

function createWebServer(firebase, api) {
  const production = process.env.NODE_ENV === 'production';
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Referrer-Policy', firebase ? 'strict-origin-when-cross-origin' : 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const policy = ["default-src 'self'", "img-src 'self' data:", "style-src 'self'", "font-src 'self'",
      "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'", "object-src 'none'"];
    if (firebase) {
      const authOrigin = 'https://' + firebase.authDomain;
      policy.push(
        "script-src 'self' https://www.google.com https://www.gstatic.com https://www.recaptcha.net",
        "frame-src " + authOrigin + ' https://www.google.com https://recaptcha.google.com https://www.recaptcha.net',
        "connect-src 'self' " + authOrigin + ' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.google.com https://www.recaptcha.net',
      );
    }
    res.setHeader('Content-Security-Policy', policy.join('; '));
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'invalid_input');
      serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('[waslah] Request failed:', error);
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'server_error' });
      else res.end();
    }
  });
}

function serveStatic(req, res, path) {
  const assets = {
    '/assets/lucide.js': 'node_modules/lucide/dist/umd/lucide.min.js',
  };
  const clean = decodeURIComponent(path);
  const font = clean.match(/^\/assets\/(ibm-plex-sans-arabic-(?:arabic|latin)-(?:400|500|600|700)-normal\.woff2)$/);
  const filename = font ? resolve(root, 'node_modules/@fontsource/ibm-plex-sans-arabic/files', font[1])
    : Object.hasOwn(assets, clean) ? resolve(root, assets[clean]) : resolve(publicDirectory, '.' + clean);
  const publicPath = relative(publicDirectory, filename);
  const outsidePublic = isAbsolute(publicPath) || publicPath === '..' || publicPath.startsWith('..' + sep);
  if (!font && !Object.hasOwn(assets, clean) && outsidePublic) fail(404, 'not_found');
  const info = statSync(filename, { throwIfNoEntry: false });
  if (!info?.isFile()) {
    if (!extname(clean) && !/^\/(?:api|assets)(?:\/|$)/.test(clean)) {
      res.setHeader('Vary', 'Accept');
      const acceptsHtml = (req.headers.accept || '*/*').split(',').some(value => {
        const [type, ...parameters] = value.trim().split(';');
        return ['text/html', 'text/*', '*/*'].includes(type.toLowerCase())
          && !parameters.some(parameter => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(parameter));
      });
      if (acceptsHtml) return serveStatic(req, res, '/index.html');
    }
    fail(404, 'not_found');
  }
  res.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Content-Length': info.size,
    'Cache-Control': clean.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filename).pipe(res);
}

export function startServer() {
  try {
    loadEnvFile(resolve(root, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const configuredPort = process.env.PORT || '3000';
  const port = Number(configuredPort);
  if (!/^\d+$/.test(configuredPort) || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
  if (!statSync(resolve(publicDirectory, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Missing public/index.html. Deploy the complete source archive.');
  }
  if (!statSync(resolve(publicDirectory, 'assets/firebase-auth.js'), { throwIfNoEntry: false })?.isFile()) {
    console.warn('[waslah] Missing public/assets/firebase-auth.js. Run npm run build:firebase before using Firebase sign-in.');
  }

  let server;
  try {
    server = makeApp();
  } catch (error) {
    if (!(error instanceof StartupConfigurationError)) throw error;
    console.error(`[waslah] Serving public pages only. ${error.message}`);
    server = createWebServer(null, (req, res, url) => {
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return send(res, 200, { sms: false, firebase: null, ai: false, market: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user: null });
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 503, { ok: false, error: 'configuration_required' });
      }
      fail(503, 'configuration_required');
    });
  }
  server.on('error', error => {
    console.error('[waslah] HTTP server error:', error);
    process.exitCode = 1;
  });
  return server.listen(port, '0.0.0.0', () => {
    console.log(`[waslah] Listening on 0.0.0.0:${server.address()?.port ?? port}`);
  });
}

if (import.meta.main ?? (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  try {
    startServer();
  } catch (error) {
    console.error('[waslah] Startup failed:', error);
    process.exitCode = 1;
  }
}
