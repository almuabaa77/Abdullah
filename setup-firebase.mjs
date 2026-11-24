import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import { readFirebaseConfig } from './firebase-provider.mjs';
import { normalizePhone } from './public/phone.js';

async function configure() {
  const [projectId, authDomain, appId, apiKey, ...extra] = process.argv.slice(2);
  if (!apiKey || extra.length) {
    throw new Error('Usage: node setup-firebase.mjs PROJECT_ID AUTH_DOMAIN APP_ID WEB_API_KEY');
  }
  const firebase = readFirebaseConfig(JSON.stringify({ projectId, authDomain, appId, apiKey }));
  const serialized = JSON.stringify(firebase);
  const path = '.env';
  if (existsSync(path)) {
    const existing = parseEnv(readFileSync(path, 'utf8'));
    const saved = readFirebaseConfig(existing.FIREBASE_WEB_CONFIG);
    if (existing.AUTH_PROVIDER === 'firebase' && JSON.stringify(saved) === serialized
        && normalizePhone(existing.ADMIN_PHONE) && existing.SESSION_SECRET?.length >= 32) {
      console.log('إعدادات Firebase جاهزة بالفعل في .env.');
      return;
    }
    throw new Error('ملف .env موجود. راجع خطوات تعديل الإعدادات في FIREBASE.md للحفاظ على القيم الحالية.');
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let phone;
  try {
    phone = normalizePhone(await terminal.question('اكتب رقم جوال مدير وصلة ثم اضغط Enter: '));
  } finally {
    terminal.close();
  }
  if (!phone) throw new Error('أدخل رقم جوال المدير بصيغة محلية سعودية أو دولية.');
  const secret = randomBytes(32).toString('hex');
  writeFileSync(path, [
    'AUTH_PROVIDER=firebase',
    'FIREBASE_WEB_CONFIG=' + serialized,
    'ADMIN_PHONE=' + phone,
    'SESSION_SECRET=' + secret,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('تم حفظ إعدادات Firebase ورقم المدير ومفتاح الجلسات محليًا في .env.');
}

try {
  await configure();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
