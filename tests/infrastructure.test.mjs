import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { saveBackup } from '../backup.mjs';
import { checkFirebase } from '../check-firebase.mjs';

test('backs up a running SQLite WAL database and preserves its snapshot', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'waslah-backup-test-'));
  const sourcePath = join(directory, 'source.sqlite');
  const source = new DatabaseSync(sourcePath);
  t.after(() => {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  });
  source.exec("PRAGMA journal_mode=WAL; CREATE TABLE example(value TEXT); INSERT INTO example VALUES ('saved');");
  const path = await saveBackup(sourcePath, join(directory, 'backups'));
  source.exec("INSERT INTO example VALUES ('after backup');");
  const saved = new DatabaseSync(path, { readOnly: true });
  try {
    assert.deepEqual(saved.prepare('SELECT value FROM example').all().map(row => row.value), ['saved']);
  } finally {
    saved.close();
  }
});

test('checks Firebase reachability and distinguishes an unauthorized production domain', async () => {
  const origin = 'https://waslah.example.com';
  const firebase = {
    projectId: 'waslah-fixture',
    authDomain: 'waslah-fixture.firebaseapp.com',
    appId: '1:123456:web:abc123',
    apiKey: 'public_web_config_key_fixture',
  };
  let domains = ['waslah.example.com'];
  const request = async (url, options) => {
    const address = new URL(url);
    assert.equal(options.redirect, 'error');
    if (address.href === origin + '/api/health') return Response.json({ ok: true });
    if (address.href === origin + '/api/config') return Response.json({ sms: true, firebase });
    if (address.hostname === 'identitytoolkit.googleapis.com') {
      assert.equal(options.headers.Referer, origin + '/');
      assert.equal(address.searchParams.get('key'), firebase.apiKey);
      return Response.json({ authorizedDomains: domains });
    }
    assert.equal(address.hostname, 'www.googleapis.com');
    return Response.json({ fixture: '-----BEGIN CERTIFICATE-----' });
  };
  assert.deepEqual(await checkFirebase(origin, request), { projectId: firebase.projectId, origin });
  domains = [];
  await assert.rejects(checkFirebase(origin, request), /Authorized domains/);
  await assert.rejects(checkFirebase('http://localhost:3000', request), /HTTPS/);
});
