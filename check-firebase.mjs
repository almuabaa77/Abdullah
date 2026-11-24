import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFirebaseConfig } from './firebase-provider.mjs';

const certsUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

async function requestJson(request, url, label, headers) {
  let response;
  try {
    response = await request(url, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error('تعذّر الاتصال بـ ' + label);
  }
  if (!response.ok) throw new Error(label + ' استجاب بحالة HTTP ' + response.status);
  try {
    return await response.json();
  } catch {
    throw new Error('استجابة غير صالحة من ' + label);
  }
}

export async function checkFirebase(url, request = fetch) {
  let site;
  try {
    site = new URL(url);
  } catch {
    throw new Error('أدخل رابط وصلة المنشور عبر HTTPS.');
  }
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/'
      || site.search || site.hash || ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname)) {
    throw new Error('استخدم رابط وصلة المنشور عبر HTTPS من النطاق الرئيسي للتطبيق.');
  }
  const [health, config] = await Promise.all([
    requestJson(request, new URL('/api/health', site), 'فحص خادم وصلة'),
    requestJson(request, new URL('/api/config', site), 'إعدادات وصلة'),
  ]);
  if (health?.ok !== true) throw new Error('خادم وصلة لم يؤكد جاهزيته.');
  const firebase = readFirebaseConfig(config?.firebase && JSON.stringify(config.firebase));
  if (!config?.sms || !firebase) throw new Error('فعّل إعدادات Firebase Phone في خادم وصلة.');

  const projectUrl = new URL('https://identitytoolkit.googleapis.com/v1/projects');
  projectUrl.searchParams.set('key', firebase.apiKey);
  const [project, certificates] = await Promise.all([
    requestJson(request, projectUrl, 'إعدادات مشروع Firebase', { Referer: site.origin + '/' }),
    requestJson(request, certsUrl, 'شهادات توقيع Google'),
  ]);
  const domains = Array.isArray(project?.authorizedDomains) ? project.authorizedDomains : [];
  if (!domains.some(domain => typeof domain === 'string'
      && (site.hostname === domain.toLowerCase() || site.hostname.endsWith('.' + domain.toLowerCase())))) {
    throw new Error('أضف ' + site.hostname + ' إلى Authorized domains في Firebase Authentication.');
  }
  if (!certificates || !Object.values(certificates).some(value =>
    typeof value === 'string' && value.includes('-----BEGIN CERTIFICATE-----'))) {
    throw new Error('تعذّر الحصول على شهادات Google اللازمة للتحقق من الهوية.');
  }
  return { projectId: firebase.projectId, origin: site.origin };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { origin, projectId } = await checkFirebase(process.argv[2]);
    console.log(`وصلة تستجيب على ${origin}، والنطاق مصرح به في Firebase ${projectId}، وشهادات Google متاحة.`);
    console.log('تحقّق من تفعيل Phone والفوترة وسياسة مناطق الرسائل، ثم اختبر وصول SMS من شاشة الدخول.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
