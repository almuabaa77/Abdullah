import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { saveBackup } from '../backup.mjs';
import { checkFirebase } from '../check-firebase.mjs';

test('the managed startup file serves the home page with incomplete production settings', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['-e', "require('./start.cjs')"], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env, NODE_ENV: 'production', PORT: '0', DATABASE_PATH: ':memory:',
      AUTH_PROVIDER: 'firebase', FIREBASE_WEB_CONFIG: '', ADMIN_PHONE: '', SESSION_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });
  let diagnostics = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { diagnostics += chunk; });
  let port;
  for await (const line of createInterface({ input: child.stdout })) {
    const match = line.match(/Listening on 0\.0\.0\.0:(\d+)$/);
    if (match) {
      port = Number(match[1]);
      break;
    }
  }
  assert.ok(port, diagnostics);
  const origin = `http://127.0.0.1:${port}`;
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /وصلة/);
  const health = await fetch(origin + '/api/health');
  assert.equal(health.status, 503);
  assert.deepEqual(await health.json(), { ok: false, error: 'configuration_required' });
  const privateData = await fetch(origin + '/api/admin/users');
  assert.equal(privateData.status, 503);
  assert.deepEqual(await privateData.json(), { error: 'configuration_required' });
});

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
