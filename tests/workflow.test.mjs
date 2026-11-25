import { once } from 'node:events';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { makeApp } from '../server.mjs';
import { lookupAddress } from '../geocoding.mjs';

const testPin = '637592';
const adminPhone = '0550001017';
async function start(t, { sms = true, database = ':memory:', marketClock, verificationClock, geocodingKey, reverseAddress, accountStore } = {}) {
  const pending = new Set();
  const verifySms = sms ? async (operation, values) => {
    if (operation === 'Verifications') {
      pending.add(values.To);
      return { status: 'pending' };
    }
    const approved = values.Code === testPin && pending.delete(values.To);
    return { status: approved ? 'approved' : 'pending' };
  } : undefined;
  const server = makeApp({ database, adminPhone: sms ? adminPhone : undefined, verifySms, marketClock, verificationClock, geocodingKey, reverseAddress, accountStore, accountSyncInterval: 15, assistantKey: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return 'http://127.0.0.1:' + server.address().port;
}
function client(base) {
  let cookie = '';
  return async (path, method = 'GET', data, code = 200) => {
    const headers = cookie ? { cookie } : {};
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api' + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    const value = response.headers.get('set-cookie');
    if (value) cookie = value.split(';')[0];
    assert.equal(response.status, code, path + ' returned ' + response.status);
    if (response.headers.get('content-type')?.includes('application/json')) return response.json();
    return response;
  };
}

test('serves the home page and frontend assets from the public folder', async t => {
  const base = await start(t);
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  assert.match(await home.text(), /وصلة/);
  for (const file of ['/app.js', '/styles.css', '/assets/waslah.svg', '/assets/lucide.js']) {
    const asset = await fetch(base + file, { method: 'HEAD' });
    assert.equal(asset.status, 200, file);
  }
  assert.equal((await fetch(base + '/..%2Fserver.mjs')).status, 404);
  const manifest = await fetch(base + '/manifest.webmanifest');
  assert.match(manifest.headers.get('content-type'), /^application\/manifest\+json/);
  const metadata = await manifest.json();
  assert.equal(metadata.display, 'standalone');
  for (const icon of metadata.icons) assert.equal((await fetch(base + icon.src, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '/sw.js', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base + '/offline.html', { method: 'HEAD' })).status, 200);
});

test('serves the app shell for HTML navigation without masking missing APIs or assets', async t => {
  const base = await start(t);
  const index = await (await fetch(base + '/')).text();
  const headers = { Accept: 'text/html,application/xhtml+xml' };
  const deepLink = base + '/requests/123/details?tab=messages';
  const page = await fetch(deepLink, { headers });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('vary'), 'Accept');
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(await page.text(), index);
  const head = await fetch(deepLink, { method: 'HEAD', headers });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(index)));
  assert.equal(await head.text(), '');
  const json = await fetch(deepLink, { headers: { Accept: 'application/json' } });
  assert.equal(json.status, 404);
  const api = await fetch(base + '/api/missing', { headers });
  assert.equal(api.status, 401);
  assert.match(api.headers.get('content-type'), /^application\/json/);
  for (const path of ['/api', '/assets/missing', '/missing.js']) {
    const missing = await fetch(base + path, { headers });
    assert.equal(missing.status, 404, path);
    assert.deepEqual(await missing.json(), { error: 'not_found' });
  }
});

async function login(account, number, signup = {}) {
  const result = await account('/auth/send', 'POST', { phone: number });
  assert.equal(result.expiresAt - result.serverTime, 120_000);
  return account('/auth/verify', 'POST', { phone: result.phone, challenge: result.challenge, code: testPin, ...signup });
}
async function register(account, admin, number, name, role = 'customer', profile = {}) {
  const user = await login(account, number, { name, role });
  await account('/registration', 'POST', evidence);
  await admin('/admin/users/' + user.id, 'PATCH', { approval: 'approved', registrationReviewed: true, ...profile });
  return user;
}
const image = Buffer.from('ffd8ffdb0004ffd9', 'hex').toString('base64');
const evidence = {
  nationalId: '1000000008', address: '123 Main Street Riyadh 12345',
  location: { latitude: 24.7, longitude: 46.68, accuracy: 19 }, selfie: image, identity: image,
};
const serviceFields = {
  name_ar: 'تمديد الزيارة العائلية', name_en: 'Family visit extension',
  description_ar: 'مراجعة طلب تمديد الزيارة العائلية', description_en: 'Review of a family visit extension request',
  documents_ar: 'جواز السفر', documents_en: 'Passport',
  category: 'government', specialty: 'passports', active: true,
};
async function publish(admin, overrides = {}) {
  return admin('/admin/services', 'POST', { ...serviceFields, ...overrides }, 201);
}

test('mobile signup, approval, scoped service delivery and bilingual assistant', async t => {
  const base = await start(t);
  const customer = client(base);
  const admin = client(base);
  const specialist = client(base);
  const outsider = client(base);
  await login(admin, adminPhone);
  const otherId = (await register(outsider, admin, '0550001021', 'عمر علي الزهراني')).id;
  const assigned = await register(specialist, admin, '0550001022', 'سالم سعد العتيبي', 'agent', { city: 'riyadh', specialties: ['passports'] });
  const { phone, challenge } = await customer('/auth/send', 'POST', { phone: '0550001023' });
  await customer('/auth/verify', 'POST', { phone, challenge, name: 'محمد سالم العتيبي', role: 'customer', code: '000000' }, 400);
  const registered = await customer('/auth/verify', 'POST', { phone, challenge, name: 'محمد سالم العتيبي', role: 'customer', code: testPin });
  assert.equal(registered.approval, 'pending');
  assert.notEqual(registered.id, otherId);
  await customer('/requests', 'GET', undefined, 403);
  assert.ok((await admin('/admin/users')).some(user => user.id === registered.id && user.approval === 'pending'));
  await admin('/admin/users/' + registered.id, 'PATCH', { approval: 'approved' }, 409);
  await customer('/registration', 'POST', { ...evidence, location: { ...evidence.location, accuracy: 100 } }, 400);
  await customer('/registration', 'POST', evidence);
  assert.equal((await customer('/registration', 'POST', evidence)).needsRegistration, false);
  assert.deepEqual(await admin('/admin/users/' + registered.id + '/registration'), evidence);
  await customer('/admin/users/' + registered.id + '/registration', 'GET', undefined, 403);
  await admin('/admin/users/' + registered.id, 'PATCH', { approval: 'approved' }, 409);
  await admin('/admin/users/' + registered.id, 'PATCH', { approval: 'approved', registrationReviewed: true });
  assert.equal((await customer('/me')).user.approval, 'approved');

  const { id: service } = await publish(admin);
  const bytes = Buffer.from('%PDF-1.4\n%%EOF\n');
  await customer('/requests', 'POST', { service, details: 'تمديد شهر', file: { name: 'doc.exe', data: 'AA==' } }, 400);
  const { id } = await customer('/requests', 'POST', { service, details: 'تمديد شهر', file: { name: 'visit.pdf', data: bytes.toString('base64') } }, 201);
  const request = '/requests/' + id;
  assert.ok((await admin('/notifications')).some(event => event.request_id === id && event.kind === 'new'));
  await outsider(request, 'GET', undefined, 404);
  await outsider(request + '/attachment', 'GET', undefined, 404);
  await specialist(request, 'GET', undefined, 404);
  await customer(request, 'PATCH', { status: 'completed' }, 403);
  assert.equal((await customer(request)).status, 'new');

  await admin(request, 'PATCH', { agent_id: assigned.id });
  const attachment = await specialist(request + '/attachment');
  assert.equal(attachment.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), bytes);
  await specialist(request, 'PATCH', { status: 'completed' }, 409);
  await specialist(request, 'PATCH', { status: 'in_progress' });
  await specialist(request, 'PATCH', { status: 'needs_info' });
  await specialist(request + '/messages', 'POST', { text: 'يرجى إرسال المرفق المحدّث' }, 201);
  assert.equal((await customer(request)).messages.length, 1);
  await customer(request + '/messages', 'POST', { text: 'تم الإرفاق', file: { name: 'updated.pdf', data: bytes.toString('base64') } }, 201);
  assert.equal((await specialist(request)).attachment, 'updated.pdf');
  await specialist(request, 'PATCH', { status: 'completed' });
  assert.equal((await customer(request)).status, 'completed');
  assert.ok((await customer('/notifications')).some(event => !event.seen && event.value === 'completed'));
  await customer('/notifications', 'POST', {});
  assert.ok((await customer('/notifications')).every(event => event.seen));
  assert.match((await customer('/assistant', 'POST', { question: 'ما متطلبات تمديد الزيارة؟', lang: 'ar' })).answer, /جواز السفر/);
  assert.match((await customer('/assistant', 'POST', { question: 'How do I track my request?', lang: 'en' })).answer, /request/i);
  await customer('/auth/logout', 'POST', {});
  assert.equal((await customer('/me')).user, null);
});

test('address lookup is limited to an incomplete registration and keeps the map key private', async t => {
  const base = await start(t, { geocodingKey: 'private-map-key', reverseAddress: async (key, location, lang) => {
    assert.equal(key, 'private-map-key');
    assert.deepEqual(location, evidence.location);
    assert.equal(lang, 'ar');
    return { address: 'طريق الملك عبدالعزيز، الرياض', city: 'الرياض', street: 'طريق الملك عبدالعزيز', distance: 20,
      landmark: { name: 'حديقة الحي', distance: 85 } };
  } });
  const account = client(base);
  const config = await account('/config');
  assert.equal(config.addressLookup, true);
  assert.ok(!JSON.stringify(config).includes('private-map-key'));
  await account('/registration/address', 'POST', { location: evidence.location }, 401);
  await login(account, '0550001088', { name: 'سعد ناصر الشمري', role: 'customer' });
  await account('/registration/address', 'POST', { location: { ...evidence.location, accuracy: 99 } }, 400);
  assert.deepEqual(await account('/registration/address', 'POST', { location: evidence.location, lang: 'ar' }), {
    address: 'طريق الملك عبدالعزيز، الرياض', city: 'الرياض', street: 'طريق الملك عبدالعزيز', distance: 20,
    landmark: { name: 'حديقة الحي', distance: 85 },
  });
  await account('/registration', 'POST', evidence);
  await account('/registration/address', 'POST', { location: evidence.location }, 403);
});

test('administrator invitations activate a unique phone without SMS, with an atomic one-time session', async t => {
  const base = await start(t);
  const admin = client(base);
  const invited = client(base);
  const other = client(base);
  const details = { name: 'محمد وليد الشمري', phone: '0550001068', role: 'agent' };
  await admin('/admin/users', 'POST', details, 401);
  await login(admin, adminPhone);
  const first = await admin('/admin/users', 'POST', details, 201);
  assert.match(first.code, /^\d{6}$/);
  assert.equal(first.user.invitationPending, true);
  assert.match(first.user.tracking.reference, /^WSR-[A-F0-9]{16}$/);
  const conflict = await admin('/admin/users', 'POST', { ...details, phone: '+966550001068' }, 409);
  assert.equal(conflict.error, 'phone_in_use');
  await invited('/registration/invitation', 'POST', { code: first.code }, 401);
  assert.deepEqual(await invited('/auth/check', 'POST', { phone: details.phone }), { method: 'invitation' });
  assert.equal((await invited('/auth/send', 'POST', { phone: details.phone }, 409)).error, 'invitation_required');
  await invited('/auth/verify', 'POST', { phone: details.phone, code: testPin, challenge: 'irrelevant' }, 409);
  await invited('/registration', 'POST', evidence, 401);
  await other('/auth/invitation', 'POST', { phone: adminPhone, code: first.code }, 400);
  await other('/auth/invitation', 'POST', { phone: '0550001069', code: first.code }, 400);
  const invalidFirst = first.code === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await invited('/auth/invitation', 'POST', { phone: details.phone, code: invalidFirst }, 400);
    assert.equal(result.error, attempt < 4 ? 'invalid_invitation' : 'invitation_expired');
  }
  assert.equal((await invited('/auth/invitation', 'POST', { phone: details.phone, code: first.code }, 400)).error, 'invitation_expired');
  const replacement = await admin('/admin/users/' + first.user.id + '/invitation', 'POST', {});
  const invalid = replacement.code === '000000' ? '000001' : '000000';
  await invited('/auth/invitation', 'POST', { phone: details.phone, code: invalid }, 400);
  const account = await invited('/auth/invitation', 'POST', { phone: details.phone, code: replacement.code });
  assert.equal(account.invitationPending, false);
  assert.equal(account.invitationActivated, true);
  assert.equal(account.id, first.user.id);
  assert.equal(account.tracking.reference, first.user.tracking.reference);
  assert.equal((await invited('/me')).user.id, account.id);
  await other('/auth/invitation', 'POST', { phone: details.phone, code: replacement.code }, 400);
  assert.deepEqual(await other('/auth/check', 'POST', { phone: details.phone }), { method: 'sms' });
  await admin('/admin/users/' + account.id + '/invitation', 'POST', {}, 409);
  const saved = await invited('/registration', 'POST', evidence);
  assert.equal(saved.tracking.reference, account.tracking.reference);
  assert.ok(saved.tracking.submitted);
  await admin('/admin/users/' + account.id, 'PATCH', { approval: 'approved', registrationReviewed: true });
  const me = (await invited('/me')).user;
  assert.equal(me.approval, 'approved');
  assert.ok(me.tracking.decided);
});

test('runtime never exposes test accounts or codes and reports unavailable SMS accurately', async t => {
  const base = await start(t, { sms: false });
  const anon = client(base);
  assert.equal(Object.hasOwn(await anon('/config'), 'demo'), false);
  await anon('/demo', 'POST', { role: 'admin' }, 404);
  await anon('/requests', 'GET', undefined, 401);
  if (!process.env.TWILIO_VERIFY_SERVICE_SID) await anon('/auth/send', 'POST', { phone: '0550001023' }, 503);
});

async function marketClients(base) {
  const [customer, admin, riyadh, jeddah, chamber] = Array.from({ length: 5 }, () => client(base));
  await login(admin, adminPhone);
  const [, riyadhUser, jeddahUser, chamberUser] = await Promise.all([
    register(customer, admin, '0550001030', 'Omar Rami Salim'),
    register(riyadh, admin, '0550001031', 'Khalid Amar Hassan', 'agent', { city: 'riyadh', specialties: ['passports', 'insurance'] }),
    register(jeddah, admin, '0550001032', 'Jamal Ziad Nasser', 'agent', { city: 'jeddah', specialties: ['passports', 'translation'] }),
    register(chamber, admin, '0550001033', 'Ramzi Adel Mansour', 'agent', { city: 'riyadh', specialties: ['chamber'] }),
  ]);
  return { customer, admin, riyadh, jeddah, chamber, riyadhUser, jeddahUser, chamberUser };
}
const marketAction = (client, id, type, payload = {}, code = 200) => client('/market/' + id + '/' + type, 'POST', payload, code);
const makeRequest = (customer, overrides = {}) => customer('/requests', 'POST', {
  service: 'manual', title: 'Family visit extension', specialty: 'passports', city: 'riyadh', mode: 'offers', details: 'private applicant details',
  brief: 'One month, one visitor', ...overrides,
}, 201);
const listing = async (agent, id) => (await agent('/market/live')).find(row => row.id === id);

test('marketplace compares offers and assigns exactly one agent under concurrent customer selections', async t => {
  const base = await start(t);
  const { customer, admin, riyadh, jeddah, chamber } = await marketClients(base);
  const { id } = await makeRequest(customer);
  const req = '/requests/' + id;
  const available = await listing(riyadh, id);
  assert.equal(available.distance, 0);
  assert.equal(available.brief, 'One month, one visitor');
  for (const field of ['details', 'customer_name', 'attachment']) assert.ok(!(field in available));
  assert.equal((await listing(jeddah, id)).priority, 2);
  assert.equal(await listing(chamber, id), undefined);
  await riyadh(req, 'GET', undefined, 404);

  await Promise.all([
    marketAction(riyadh, id, 'offer', { amount: 175.5, days: 2, note: 'Available today' }),
    marketAction(jeddah, id, 'offer', { amount: 150, days: 4, note: 'Includes follow-up' }),
  ]);
  const quotes = (await customer(req)).offers;
  assert.deepEqual(quotes.map(row => row.amount), [15000, 17550]);
  const results = await Promise.all(quotes.map(async offer => {
    try {
      return await marketAction(customer, id, 'choose', { offer_id: offer.id });
    } catch (error) {
      assert.match(error.message, /returned 409/);
      return null;
    }
  }));
  assert.equal(results.filter(Boolean).length, 1);
  const assigned = await customer(req);
  assert.equal(assigned.status, 'in_progress');
  assert.equal(assigned.offers.length, 1);
  assert.equal(assigned.offers[0].status, 'selected');
  assert.equal(assigned.history.at(-1).kind, 'offer_selected');
  assert.equal((await admin(req)).offers.filter(offer => offer.status === 'closed').length, 1);
  assert.equal(await listing(riyadh, id), undefined);
  assert.equal(await listing(jeddah, id), undefined);
  const winner = assigned.offers[0].amount === 15000 ? jeddah : riyadh;
  const loser = winner === jeddah ? riyadh : jeddah;
  assert.equal((await winner(req)).details, 'private applicant details');
  await loser(req, 'GET', undefined, 404);
  await winner(req, 'PATCH', { status: 'completed' });
  await marketAction(customer, id, 'rate', { score: 5 });
  assert.equal((await winner('/market/profile')).rating, 5);
  const { id: byRating } = await makeRequest(customer, { mode: 'instant', city: winner === jeddah ? 'riyadh' : 'jeddah' });
  assert.ok(await listing(winner, byRating));
  assert.equal(await listing(loser, byRating), undefined);
  const { id: byDistance } = await makeRequest(customer, { mode: 'instant', ranking: 'distance', city: winner === jeddah ? 'riyadh' : 'jeddah' });
  assert.ok(await listing(loser, byDistance));
  assert.equal(await listing(winner, byDistance), undefined);
});

test('matching respects pause, timed fallback, manual requests and administrator controls', async t => {
  let time = Date.now();
  const base = await start(t, { marketClock: () => time });
  const { customer, admin, riyadh, jeddah, chamber, jeddahUser, chamberUser } = await marketClients(base);
  const { id } = await makeRequest(customer, {
    service: 'manual', title: 'تمديد زيارة لمقابلة عائلية', specialty: 'passports', mode: 'instant',
  });
  assert.ok(await listing(riyadh, id));
  assert.equal(await listing(jeddah, id), undefined);
  assert.equal(await listing(chamber, id), undefined);
  await riyadh('/market/profile', 'PATCH', { specialties: ['chamber'] }, 403);
  await riyadh('/market/profile', 'PATCH', { pause: 60 });
  assert.equal((await riyadh('/market/profile')).available, false);
  assert.deepEqual(await riyadh('/requests'), []);
  assert.equal(await listing(riyadh, id), undefined);
  assert.ok(await listing(jeddah, id));
  time += 31 * 60_000;
  assert.equal((await listing(chamber, id)).match, false);
  time += 30 * 60_000;
  assert.equal((await riyadh('/market/profile')).available, true);
  const claims = await Promise.all([riyadh, jeddah].map(async agent => {
    try {
      return await marketAction(agent, id, 'claim');
    } catch (error) {
      assert.match(error.message, /returned 409/);
      return null;
    }
  }));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await customer('/requests/' + id)).title, 'تمديد زيارة لمقابلة عائلية');
  assert.equal(await listing(chamber, id), undefined);
  await admin('/requests/' + id, 'PATCH', { reopen: 'offers' });
  assert.ok(await listing(jeddah, id));
  await admin('/admin/users/' + jeddahUser.id, 'PATCH', { approval: 'suspended' });
  await jeddah('/market/live', 'GET', undefined, 403);
  await admin('/admin/users/' + jeddahUser.id, 'PATCH', { approval: 'approved' });
  assert.ok(await listing(jeddah, id));
  await admin('/admin/users/' + chamberUser.id, 'PATCH', { specialties: ['passports'], city: 'riyadh' });
  assert.equal((await listing(chamber, id)).match, true);
});

test('batch limit blocks a fourth assignment until all three requests finish', async t => {
  const base = await start(t);
  const { customer, admin, riyadh, jeddah, riyadhUser } = await marketClients(base);
  const existing = [];
  for (let index = 0; index < 2; index++) {
    const row = await makeRequest(customer, { mode: 'instant' });
    await marketAction(riyadh, row.id, 'claim');
    existing.push(row);
  }
  const request = await makeRequest(customer, { mode: 'instant' });
  const next = await makeRequest(customer, { mode: 'instant' });
  await marketAction(riyadh, request.id, 'claim');
  assert.equal((await riyadh('/market/profile')).active_count, 3);
  assert.equal((await riyadh('/market/profile')).batch_locked, true);
  assert.equal(await listing(riyadh, next.id), undefined);
  assert.ok(await listing(jeddah, next.id));
  await admin('/requests/' + next.id, 'PATCH', { agent_id: riyadhUser.id }, 409);
  for (const row of existing) {
    await riyadh('/requests/' + row.id, 'PATCH', { status: 'completed' });
    assert.equal((await riyadh('/market/profile')).available, false);
  }
  await riyadh('/requests/' + request.id, 'PATCH', { status: 'completed' });
  assert.equal((await riyadh('/market/profile')).batch_locked, false);
  assert.ok(await listing(riyadh, next.id));
});

test('published catalog, profile changes, conversational context and account blocking use real permissions', async t => {
  const base = await start(t);
  const admin = client(base);
  const customer = client(base);
  const outsider = client(base);
  await login(admin, adminPhone);
  assert.deepEqual(await admin('/admin/services'), []);
  assert.equal((await admin('/admin/users')).length, 1);
  const account = await register(customer, admin, '0550001040', 'حسن وليد الشمري');
  await register(outsider, admin, '0550001041', 'ماجد عبدون الحربي');
  assert.deepEqual(await customer('/services'), []);
  await customer('/admin/services', 'POST', serviceFields, 403);
  const service = await publish(admin, { active: false });
  assert.deepEqual(await customer('/services'), []);
  await makeRequestForService(customer, service.id, 404);
  await admin('/admin/services/' + service.id, 'PATCH', serviceFields);
  assert.equal((await customer('/services'))[0].id, service.id);
  const updated = await customer('/me', 'PATCH', { name: 'الاسم المحدث', city: 'jeddah' });
  assert.equal(updated.user.city, 'jeddah');
  assert.equal((await customer('/me')).user.name, 'الاسم المحدث');
  const { id } = await makeRequestForService(customer, service.id);
  assert.equal((await customer('/requests/' + id)).catalog_title_ar, serviceFields.name_ar);
  await admin('/admin/services/' + service.id, 'PATCH', { ...serviceFields, name_ar: 'اسم آخر', active: false });
  assert.equal((await customer('/requests/' + id)).catalog_title_ar, serviceFields.name_ar);
  await makeRequestForService(customer, service.id, 404);
  const question = 'ما حالة WS-' + (1000 + id) + '؟';
  assert.match((await customer('/assistant', 'POST', { question, lang: 'ar' })).answer, /بانتظار المراجعة/);
  assert.doesNotMatch((await outsider('/assistant', 'POST', { question, lang: 'ar' })).answer, /بانتظار المراجعة/);
  await admin('/admin/services/' + service.id, 'PATCH', serviceFields);
  const followUp = await customer('/assistant', 'POST', {
    question: 'وكم السعر؟', lang: 'ar', history: [{ role: 'user', content: 'تمديد الزيارة العائلية' }],
  });
  assert.equal(followUp.action, 'service:' + service.id);
  assert.match(followUp.answer, /المعقّب/);
  await admin('/admin/users/' + account.id, 'PATCH', { approval: 'blocked' });
  assert.equal((await customer('/me')).user, null);
  await customer('/requests', 'GET', undefined, 401);
  assert.ok((await admin('/admin/users/' + account.id)).some(row => row.field === 'approval' && row.current === 'blocked'));
  await admin('/admin/users/' + account.id, 'PATCH', { name: 'اسم بعد المراجعة', approval: 'approved' });
  const record = (await admin('/admin/users')).find(user => user.id === account.id);
  assert.equal(record.approval, 'approved');
  assert.equal(record.name, 'اسم بعد المراجعة');
});

function makeRequestForService(account, service, code = 201) {
  return account('/requests', 'POST', { service, mode: 'offers', city: 'jeddah', details: 'مراجعة خدمة' }, code);
}

test('Firebase phone sign-in trusts the verified phone and preserves approvals and account blocking', async t => {
  const projectId = 'waslah-fixture';
  const firebase = { projectId, apiKey: 'public_web_config_key_fixture', authDomain: 'waslah-fixture.firebaseapp.com', appId: '1:123456:web:abc123' };
  const identities = {
    admin: '+966550001099',
    customer: '+966550001098',
  };
  const server = makeApp({
    database: ':memory:', adminPhone: identities.admin, assistantKey: '', firebase,
    confirmFirebase: async (_config, session, code) => code === testPin ? session : null,
    verifyFirebase: async proof => {
      const phone = identities[proof] ?? identities.customer;
      if (proof === 'invalid') throw new Error('Signature rejected');
      return {
        aud: proof === 'other-project' ? 'another-project' : projectId,
        iss: 'https://securetoken.google.com/' + projectId,
        auth_time: Math.floor(Date.now() / 1000) - (proof === 'stale' ? 601 : 0),
        firebase: { sign_in_provider: proof === 'email' ? 'password' : 'phone' },
        phone_number: phone,
      };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const admin = client(base);
  const customer = client(base);
  assert.deepEqual((await customer('/config')).firebase, firebase);
  await customer('/auth/send', 'POST', { phone: identities.customer }, 503);
  await customer('/auth/firebase', 'POST', { idToken: 'customer' }, 404);
  const first = await customer('/auth/challenge', 'POST', { phone: '+966550001097', session: 'other-project' });
  await customer('/auth/verify', 'POST', { ...first, code: testPin }, 400);

  const registration = await customer('/auth/challenge', 'POST', { phone: identities.customer, session: 'customer' });
  const account = await customer('/auth/verify', 'POST', {
    ...registration, name: 'Ali Faisal Khalid', role: 'customer', code: testPin,
  });
  assert.equal(account.phone, identities.customer);
  assert.equal(account.approval, 'pending');
  await customer('/requests', 'GET', undefined, 403);
  await customer('/registration', 'POST', evidence);
  const adminChallenge = await admin('/auth/challenge', 'POST', { phone: identities.admin, session: 'admin' });
  assert.equal((await admin('/auth/verify', 'POST', { ...adminChallenge, code: testPin })).role, 'admin');
  await admin('/admin/users/' + account.id, 'PATCH', { approval: 'approved', registrationReviewed: true });
  assert.deepEqual(await customer('/requests'), []);
  await admin('/admin/users/' + account.id, 'PATCH', { approval: 'blocked' });
  assert.equal((await customer('/me')).user, null);
});

test('verification expires after two minutes and locks the number on three wrong codes', async t => {
  let now = Date.now();
  const base = await start(t, { verificationClock: () => now });
  const account = client(base);
  const first = await account('/auth/send', 'POST', { phone: '0550001055' });
  now += 120_000;
  assert.equal((await account('/auth/verify', 'POST', { ...first, code: testPin }, 400)).error, 'verification_expired');
  const second = await account('/auth/send', 'POST', { phone: '0550001056' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await account('/auth/verify', 'POST', { ...second, code: '000000' }, 400);
  }
  const locked = await account('/auth/verify', 'POST', { ...second, code: '000000' }, 429);
  assert.equal(locked.retryAt - locked.serverTime, 31 * 60_000);
  await account('/auth/check', 'POST', { phone: second.phone }, 429);
  now = locked.retryAt;
  assert.deepEqual(await account('/auth/check', 'POST', { phone: second.phone }), { method: 'sms' });
});

test('an older pending-session credential retains tracking without giving account access', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'waslah-review-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'review.sqlite');
  const base = await start(t, { database });
  const admin = client(base);
  const account = client(base);
  await login(admin, adminPhone);
  const user = await login(account, '0550001067', { name: 'مازن عمر العتيبي', role: 'customer' });
  const saved = await account('/registration', 'POST', evidence);
  const sqlite = new DatabaseSync(database);
  const session = sqlite.prepare('SELECT expires,account_expires FROM sessions WHERE user_id=?').get(user.id);
  assert.equal(session.expires - session.account_expires, 23 * 86_400_000);
  sqlite.prepare('UPDATE sessions SET account_expires=? WHERE user_id=?').run(Date.now() - 1, user.id);
  sqlite.close();
  const review = (await account('/me')).user;
  assert.equal(review.reviewOnly, true);
  assert.equal(review.tracking.reference, saved.tracking.reference);
  assert.ok(!Object.hasOwn(review, 'phone'));
  await admin('/admin/users/' + user.id, 'PATCH', { approval: 'approved', registrationReviewed: true });
  assert.equal((await account('/me')).user.approval, 'approved');
  assert.equal((await account('/requests', 'GET', undefined, 403)).error, 'review_session_only');
});

test('map lookup provides the street and measures distance to the nearest returned landmark', async t => {
  const origin = { latitude: 24.7, longitude: 46.68 };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const endpoint = new URL(url);
    calls.push(endpoint.hostname);
    if (endpoint.hostname === 'places.googleapis.com') {
      assert.equal(options.headers['X-Goog-Api-Key'], 'places-fixture');
      assert.equal(JSON.parse(options.body).rankPreference, 'DISTANCE');
      return Response.json({ places: [{ displayName: { text: 'حديقة الحي' }, location: { latitude: 24.701, longitude: 46.68 } }] });
    }
    assert.equal(endpoint.searchParams.get('key'), 'address-fixture');
    return Response.json({ status: 'OK', results: [{
      types: ['street_address'], formatted_address: 'شارع الملك، حي الندى، الرياض',
      address_components: [
        { types: ['locality'], long_name: 'الرياض' }, { types: ['route'], long_name: 'شارع الملك' },
      ],
      geometry: { location: { lat: 24.7001, lng: 46.68 } },
    }] });
  });
  assert.deepEqual(await lookupAddress('address-fixture', origin, 'ar', 'places-fixture'), {
    address: 'شارع الملك، حي الندى، الرياض', city: 'الرياض', street: 'شارع الملك', distance: 11,
    landmark: { name: 'حديقة الحي', distance: 111 },
  });
  assert.equal(calls.length, 2);
});

async function until(check, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  assert.fail(description);
}

test('Firestore synchronization saves private account metadata, retries failures, and removes deleted documents', async t => {
  const documents = new Map();
  let failOnce = true;
  const pendingPhone = '+966550001077';
  const base = await start(t, { accountStore: {
    async upsert(phone, document) {
      if (phone === pendingPhone && failOnce) { failOnce = false; throw new Error('temporary outage'); }
      documents.set(phone, document);
    },
    async remove(phone) { documents.delete(phone); },
  } });
  const admin = client(base);
  const customer = client(base);
  await login(admin, adminPhone);
  const created = await admin('/admin/users', 'POST', { phone: pendingPhone, name: 'سالم عمر الحربي', role: 'customer' }, 201);
  assert.match(created.code, /^\d{6}$/);
  assert.equal(created.firebaseSync, 'retrying');
  await until(() => documents.has(pendingPhone), 'Firestore job should retry the failed write');
  const synced = documents.get(pendingPhone);
  assert.equal(synced.phone, pendingPhone);
  assert.equal(synced.name, created.user.name);
  assert.equal(synced.role, 'customer');
  assert.match(synced.invitation.codeHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(synced.invitation, 'code'), false);
  await customer('/auth/invitation', 'POST', { phone: pendingPhone, code: created.code });
  await until(() => documents.get(pendingPhone)?.invitation?.usedAt, 'Firestore should receive the redemption timestamp');
  assert.equal(documents.get(pendingPhone).invitation.codeHash, null);
  await customer('/admin/users/' + created.user.id, 'DELETE', { confirmation: pendingPhone }, 403);
  await admin('/admin/users/' + created.user.id, 'DELETE', { confirmation: '0550001078' }, 400);
  const removed = await admin('/admin/users/' + created.user.id, 'DELETE', { confirmation: pendingPhone });
  assert.deepEqual(removed, { deleted: true, firebaseSync: 'queued' });
  assert.equal((await customer('/me')).user, null);
  await until(() => !documents.has(pendingPhone), 'Firestore should remove the account');
  const replacement = await admin('/admin/users', 'POST', { phone: pendingPhone, name: 'سالم عمر الحربي', role: 'customer' }, 201);
  assert.equal(replacement.firebaseSync, 'synced');
  assert.equal(documents.get(pendingPhone).accountId, replacement.user.id);
  assert.ok(replacement.user.id > created.user.id);
  assert.equal((await admin('/admin/users/1', 'DELETE', { confirmation: adminPhone }, 403)).error, 'admin_account_protected');
});

test('deleting an agent reopens customer requests and deleting the owner removes dependent data', async t => {
  const base = await start(t);
  const admin = client(base);
  const customer = client(base);
  const specialist = client(base);
  await login(admin, adminPhone);
  const person = await register(customer, admin, '0550001079', 'بدر عبيد العتيبي');
  const agent = await register(specialist, admin, '0550001080', 'مراد فتحي صالح', 'agent');
  const { id: service } = await publish(admin);
  const { id } = await customer('/requests', 'POST', {
    service, details: 'تمديد الزيارة', file: { name: 'visit.pdf', data: Buffer.from('%PDF-1.4\n').toString('base64') },
  }, 201);
  const path = '/requests/' + id;
  await admin(path, 'PATCH', { agent_id: agent.id });
  await specialist(path + '/messages', 'POST', { text: 'تم استلام الطلب' }, 201);
  await admin('/admin/users/' + agent.id, 'DELETE', { confirmation: agent.phone });
  assert.equal((await specialist('/me')).user, null);
  const reopened = await customer(path);
  assert.equal(reopened.agent_id, null);
  assert.equal(reopened.status, 'new');
  assert.equal(reopened.mode, 'admin');
  assert.equal(reopened.attachment, 'visit.pdf');
  assert.deepEqual(reopened.messages, []);
  await admin('/admin/users/' + person.id, 'DELETE', { confirmation: person.phone });
  assert.equal((await customer('/me')).user, null);
  await admin(path, 'GET', undefined, 404);
  await admin(path + '/attachment', 'GET', undefined, 404);
});
