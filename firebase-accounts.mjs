import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export function firebaseAccountStore(firebase, credentials, removeAuth = false) {
  if (!credentials) return null;
  const values = JSON.parse(credentials);
  if (!firebase || values.project_id !== firebase.projectId || !values.client_email || !values.private_key) {
    throw new Error('The service account must belong to the configured Firebase project.');
  }
  const { getFirestore, initializeFirestore } = createRequire(import.meta.url)('firebase-admin/firestore');
  const name = 'waslah-accounts:' + values.project_id;
  const existing = getApps().find(app => app.name === name);
  const app = existing || initializeApp({ credential: cert(values), projectId: firebase.projectId }, name);
  const firestore = existing ? getFirestore(app) : initializeFirestore(app, { preferRest: true });
  const document = phone => firestore.collection('waslah_accounts').doc(createHash('sha256').update(phone).digest('hex'));
  return {
    async upsert(phone, account) { await document(phone).set(account); },
    async remove(phone, uid) {
      await document(phone).delete();
      if (removeAuth && uid) {
        try { await getAuth(app).deleteUser(uid); }
        catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      }
    },
  };
}

export function migrateAccountSync(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_sequence (id INTEGER PRIMARY KEY CHECK(id=1), last_id INTEGER NOT NULL);
    INSERT OR IGNORE INTO account_sequence SELECT 1, COALESCE(MAX(id),0) FROM users;
    CREATE TABLE IF NOT EXISTS account_sync (
      phone TEXT PRIMARY KEY, operation TEXT NOT NULL, firebase_uid TEXT, revision INTEGER NOT NULL DEFAULT 1,
      failures INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
      lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS account_sync_created AFTER INSERT ON users BEGIN
      UPDATE account_sequence SET last_id=MAX(last_id,NEW.id) WHERE id=1;
      INSERT INTO account_sync(phone,operation) VALUES(NEW.phone,'upsert')
        ON CONFLICT(phone) DO UPDATE SET operation='upsert', firebase_uid=NULL, revision=revision+1, failures=0, retry_at=0;
    END;
    CREATE TRIGGER IF NOT EXISTS account_sync_updated AFTER UPDATE OF name,role,approval,city,needs_registration,firebase_uid ON users BEGIN
      INSERT INTO account_sync(phone,operation) VALUES(NEW.phone,'upsert')
        ON CONFLICT(phone) DO UPDATE SET operation='upsert', firebase_uid=NULL, revision=revision+1, failures=0, retry_at=0;
    END;
    CREATE TRIGGER IF NOT EXISTS account_sync_removed AFTER DELETE ON users BEGIN
      INSERT INTO account_sync(phone,operation,firebase_uid) VALUES(OLD.phone,'delete',OLD.firebase_uid)
        ON CONFLICT(phone) DO UPDATE SET operation='delete', firebase_uid=OLD.firebase_uid, revision=revision+1, failures=0, retry_at=0;
    END;
    CREATE TRIGGER IF NOT EXISTS account_sync_invitation_created AFTER INSERT ON registration_invites BEGIN
      INSERT INTO account_sync(phone,operation) SELECT phone,'upsert' FROM users WHERE id=NEW.user_id
        ON CONFLICT(phone) DO UPDATE SET operation='upsert', revision=revision+1, failures=0, retry_at=0;
    END;
    CREATE TRIGGER IF NOT EXISTS account_sync_invitation_updated AFTER UPDATE OF digest,expires,used ON registration_invites BEGIN
      INSERT INTO account_sync(phone,operation) SELECT phone,'upsert' FROM users WHERE id=NEW.user_id
        ON CONFLICT(phone) DO UPDATE SET operation='upsert', revision=revision+1, failures=0, retry_at=0;
    END;
    INSERT OR IGNORE INTO account_sync(phone,operation) SELECT phone,'upsert' FROM users
      WHERE NOT EXISTS (SELECT 1 FROM operations_migrations WHERE name='account-sync-v1');
    INSERT OR IGNORE INTO operations_migrations VALUES ('account-sync-v1');
  `);
}

export function createAccountSync({ get, run, transaction, store, interval }) {
  if (!store) return { stop() {}, async syncNow() { return 'disabled'; } };
  let running = false;
  let closed = false;
  let heartbeat;

  function status(phone) {
    const job = get('SELECT failures FROM account_sync WHERE phone=?', phone);
    if (!job) return 'synced';
    return job.failures ? 'retrying' : 'queued';
  }

  async function drain(preferredPhone) {
    if (running || closed) return;
    running = true;
    try {
      for (let count = 0; count < 30 && !closed; count++) {
        const job = transaction(() => {
          const now = Date.now();
          const ready = 'SELECT * FROM account_sync WHERE retry_at<=? AND lease_until<=?';
          const preferred = preferredPhone && get(ready + ' AND phone=?', now, now, preferredPhone);
          const row = preferred || get(ready + ' ORDER BY retry_at,phone LIMIT 1', now, now);
          if (!row) return null;
          const lease = randomUUID();
          run('UPDATE account_sync SET lease=?,lease_until=? WHERE phone=?', lease, now + 120_000, row.phone);
          return { ...row, lease };
        });
        if (!job) break;
        heartbeat = setInterval(() => {
          try { run('UPDATE account_sync SET lease_until=? WHERE phone=? AND lease=?', Date.now() + 120_000, job.phone, job.lease); }
          catch { console.warn('[waslah] Could not extend the Firebase synchronization lease.'); }
        }, 30_000);
        heartbeat.unref();
        try {
          if (job.operation === 'delete') {
            await store.remove(job.phone, job.firebase_uid);
          } else {
            const user = get('SELECT * FROM users WHERE phone=?', job.phone);
            if (user) {
              const invite = get('SELECT digest,expires,used,activated FROM registration_invites WHERE user_id=?', user.id);
              await store.upsert(job.phone, {
                accountId: user.id, phone: user.phone, name: user.name, role: user.role,
                approval: user.approval, city: user.city || null, createdAt: user.created,
                firebaseUid: user.firebase_uid || null, needsRegistration: !!user.needs_registration,
                invitation: invite ? {
                  codeHash: invite.digest ? Buffer.from(invite.digest).toString('hex') : null,
                  expiresAt: new Date(invite.expires), usedAt: invite.used ? new Date(invite.used) : null,
                  activatedAt: invite.activated ? new Date(invite.activated) : null,
                } : null,
              });
            }
          }
          if (closed) break;
          transaction(() => {
            run('DELETE FROM account_sync WHERE phone=? AND revision=? AND lease=?', job.phone, job.revision, job.lease);
            run('UPDATE account_sync SET lease=NULL,lease_until=0 WHERE phone=? AND lease=?', job.phone, job.lease);
          });
        } catch {
          if (closed) break;
          const delay = Math.min(300_000, 1000 * 2 ** Math.min(job.failures + 1, 9));
          transaction(() => {
            run('UPDATE account_sync SET failures=failures+1,retry_at=? WHERE phone=? AND revision=? AND lease=?',
              Date.now() + delay, job.phone, job.revision, job.lease);
            run('UPDATE account_sync SET lease=NULL,lease_until=0 WHERE phone=? AND lease=?', job.phone, job.lease);
          });
          if (!job.failures) console.warn('[waslah] Firebase account synchronization will retry.');
        } finally {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
      }
    } catch {
      if (!closed) console.warn('[waslah] Account synchronization queue could not be processed.');
    } finally {
      running = false;
    }
  }
  const timer = setInterval(drain, interval);
  timer.unref();
  return {
    async syncNow(phone) {
      void drain(phone);
      const deadline = Date.now() + 2000;
      let state = status(phone);
      while (!closed && state === 'queued' && Date.now() < deadline) {
        await delay(50);
        if (!closed) state = status(phone);
      }
      return state;
    },
    stop() { closed = true; clearInterval(timer); clearInterval(heartbeat); },
  };
}
