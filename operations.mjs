import { randomUUID } from 'node:crypto';
import { categories } from './public/catalog.js';
import { cities, specialties } from './public/market.js';

export function migrateOperations(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(requests)').all().map(row => row.name));
    for (const field of ['catalog_title_ar', 'catalog_title_en']) {
      if (!columns.has(field)) db.exec(`ALTER TABLE requests ADD COLUMN ${field} TEXT`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_services (
        id TEXT PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
        description_ar TEXT NOT NULL, description_en TEXT NOT NULL,
        documents_ar TEXT NOT NULL, documents_en TEXT NOT NULL,
        category TEXT NOT NULL, specialty TEXT NOT NULL, active INTEGER NOT NULL,
        created TEXT NOT NULL, updated TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_audit (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        actor_id INTEGER NOT NULL REFERENCES users(id), field TEXT NOT NULL,
        previous TEXT, current TEXT, created TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS account_audit_user ON account_audit(user_id, id);
      CREATE TABLE IF NOT EXISTS operations_migrations (name TEXT PRIMARY KEY);
    `);
    if (!db.prepare('SELECT 1 FROM operations_migrations WHERE name=?').get('retire-synthetic-v1')) {
      db.exec(`
        CREATE TEMP TABLE retired_accounts AS SELECT id FROM users WHERE
          (phone='+966500000101' AND name='محمد العتيبي') OR
          (phone='+966500000102' AND name='أحمد الحربي') OR
          (phone='+966500000103' AND name='إدارة وصلة') OR
          (phone='+966500000104' AND name='ليان القحطاني') OR
          (phone='+966500000105' AND name='نورة الدوسري');
        CREATE TEMP TABLE retired_requests AS SELECT id FROM requests WHERE customer_id IN (SELECT id FROM retired_accounts);
        DELETE FROM ratings WHERE agent_id IN (SELECT id FROM retired_accounts) OR request_id IN (SELECT id FROM retired_requests);
        DELETE FROM tracking WHERE request_id IN (SELECT id FROM retired_requests);
        DELETE FROM offers WHERE agent_id IN (SELECT id FROM retired_accounts) OR request_id IN (SELECT id FROM retired_requests);
        DELETE FROM messages WHERE user_id IN (SELECT id FROM retired_accounts) OR request_id IN (SELECT id FROM retired_requests);
        DELETE FROM events WHERE user_id IN (SELECT id FROM retired_accounts) OR request_id IN (SELECT id FROM retired_requests);
        DELETE FROM attachments WHERE request_id IN (SELECT id FROM retired_requests);
        DELETE FROM sessions WHERE user_id IN (SELECT id FROM retired_accounts);
        DELETE FROM account_audit WHERE user_id IN (SELECT id FROM retired_accounts) OR actor_id IN (SELECT id FROM retired_accounts);
        DELETE FROM requests WHERE id IN (SELECT id FROM retired_requests);
        UPDATE requests SET agent_id=NULL, status=CASE
          WHEN status IN ('new','in_progress','needs_info') THEN 'new' ELSE status END,
          mode=CASE WHEN status IN ('new','in_progress','needs_info') THEN 'admin' ELSE mode END
          WHERE agent_id IN (SELECT id FROM retired_accounts);
        DELETE FROM users WHERE id IN (SELECT id FROM retired_accounts);
        DROP TABLE retired_requests;
        DROP TABLE retired_accounts;
        DROP TABLE IF EXISTS codes;
        INSERT INTO operations_migrations VALUES ('retire-synthetic-v1');
      `);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createOperations({ get, all, run, input, fail, stamp }) {
  const audit = (user, actor, field, previous, current) => {
    if (previous !== current) run(
      'INSERT INTO account_audit(user_id,actor_id,field,previous,current,created) VALUES(?,?,?,?,?,?)',
      user, actor, field, previous ?? null, current ?? null, stamp(),
    );
  };
  const auditFor = id => all(`SELECT a.field,a.previous,a.current,a.created,u.name AS actor_name
    FROM account_audit a JOIN users u ON u.id=a.actor_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT 20`, id);
  function updateIdentity(account, data, actor) {
    if (data.name !== undefined) {
      const name = input(data.name, 72, true);
      run('UPDATE users SET name=? WHERE id=?', name, account.id);
      audit(account.id, actor, 'name', account.name, name);
    }
    if (data.city !== undefined) {
      const city = data.city === '' || data.city === null ? null : data.city;
      if (city !== null && (typeof city !== 'string' || !Object.hasOwn(cities, city))) fail(400, 'invalid_input');
      run('UPDATE users SET city=? WHERE id=?', city, account.id);
      audit(account.id, actor, 'city', account.city, city);
    }
  }
  const catalogView = row => row && ({
    id: row.id, category: row.category, specialty: row.specialty, active: Boolean(row.active),
    name: [row.name_ar, row.name_en], description: [row.description_ar, row.description_en],
    documents: [row.documents_ar, row.documents_en], updated: row.updated,
  });
  const catalog = inactive => all('SELECT * FROM catalog_services' + (inactive ? '' : ' WHERE active=1') + ' ORDER BY created DESC, id').map(catalogView);
  const service = id => catalogView(get('SELECT * FROM catalog_services WHERE id=? AND active=1', id));
  function saveService(id, data) {
    if (id && !get('SELECT id FROM catalog_services WHERE id=?', id)) fail(404, 'not_found');
    if (!Object.hasOwn(categories, data.category) || !Object.hasOwn(specialties, data.specialty) || typeof data.active !== 'boolean') fail(400, 'invalid_input');
    const fields = [
      input(data.name_ar, 90, true), input(data.name_en, 90, true),
      input(data.description_ar, 500, true), input(data.description_en, 500, true),
      input(data.documents_ar, 500), input(data.documents_en, 500), data.category, data.specialty, Number(data.active),
    ];
    if (id) run(`UPDATE catalog_services SET name_ar=?,name_en=?,description_ar=?,description_en=?,
      documents_ar=?,documents_en=?,category=?,specialty=?,active=?,updated=? WHERE id=?`, ...fields, stamp(), id);
    else {
      id = randomUUID();
      run('INSERT INTO catalog_services VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, ...fields, stamp(), stamp());
    }
    return catalogView(get('SELECT * FROM catalog_services WHERE id=?', id));
  }
  return { audit, auditFor, updateIdentity, catalog, service, saveService };
}
