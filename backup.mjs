import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

export async function saveBackup(sourcePath, directory) {
  if (!statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) throw new Error('لم يُعثر على قاعدة بيانات وصلة.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(join(directory, '.waslah-backup-'));
  const pending = join(temporary, 'backup.sqlite');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = join(directory, `waslah-${stamp}-${randomBytes(4).toString('hex')}.sqlite`);
  try {
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      await backup(source, pending);
    } finally {
      source.close();
    }
    const saved = new DatabaseSync(pending, { readOnly: true });
    try {
      const checks = saved.prepare('PRAGMA quick_check').all();
      if (checks.length !== 1 || checks[0].quick_check !== 'ok') throw new Error('فشل فحص سلامة النسخة الاحتياطية.');
    } finally {
      saved.close();
    }
    chmodSync(pending, 0o600);
    renameSync(pending, destination);
    return destination;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = dirname(fileURLToPath(import.meta.url));
  const name = process.env.NODE_ENV === 'production' ? 'production.sqlite' : 'waslah.sqlite';
  const source = resolve(process.env.DATABASE_PATH || join(root, 'data', name));
  const folder = resolve(process.env.BACKUP_DIR || join(dirname(source), 'backups'));
  try {
    console.log(await saveBackup(source, folder));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
