import { once } from 'node:events';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { makeApp } from '../server.mjs';

const testPin = '637592';
const adminPhone = '0550001017';
async function start(t, { sms = true, marketClock } = {}) {
  const pending = new Set();
  const verifySms = sms ? async (operation, values) => {
    if (operation === 'Verifications') {
      pending.add(values.To);
      return { status: 'pending' };
    }
    const approved = values.Code === testPin && pending.delete(values.To);
    return { status: approved ? 'approved' : 'pending' };
  } : undefined;
  const server = makeApp({ database: ':memory:', adminPhone: sms ? adminPhone : undefined, verifySms, marketClock, assistantKey: '' });
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

async function login(account, number, signup = {}) {
  const result = await account('/auth/send', 'POST', { phone: number });
  assert.deepEqual(Object.keys(result), ['phone']);
  return account('/auth/verify', 'POST', { phone: result.phone, code: testPin, ...signup });
}
async function register(account, admin, number, name, role = 'customer', profile = {}) {
  const user = await login(account, number, { name, role });
  await admin('/admin/users/' + user.id, 'PATCH', { approval: 'approved', ...profile });
  return user;
}
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
  const otherId = (await register(outsider, admin, '0550001021', 'طلب آخر')).id;
  const assigned = await register(specialist, admin, '0550001022', 'معقّب اختبار', 'agent', { city: 'riyadh', specialties: ['passports'] });
  const { phone } = await customer('/auth/send', 'POST', { phone: '0550001023' });
  await customer('/auth/verify', 'POST', { phone, name: 'عميل اختبار', role: 'customer', code: '000000' }, 400);
  const registered = await customer('/auth/verify', 'POST', { phone, name: 'عميل اختبار', role: 'customer', code: testPin });
  assert.equal(registered.approval, 'pending');
  assert.notEqual(registered.id, otherId);
  await customer('/requests', 'GET', undefined, 403);
  assert.ok((await admin('/admin/users')).some(user => user.id === registered.id && user.approval === 'pending'));
  await admin('/admin/users/' + registered.id, 'PATCH', { approval: 'approved' });
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
    register(customer, admin, '0550001030', 'Customer'),
    register(riyadh, admin, '0550001031', 'Riyadh specialist', 'agent', { city: 'riyadh', specialties: ['passports', 'insurance'] }),
    register(jeddah, admin, '0550001032', 'Jeddah specialist', 'agent', { city: 'jeddah', specialties: ['passports', 'translation'] }),
    register(chamber, admin, '0550001033', 'Chamber specialist', 'agent', { city: 'riyadh', specialties: ['chamber'] }),
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
  const account = await register(customer, admin, '0550001040', 'عميل');
  await register(outsider, admin, '0550001041', 'عميل آخر');
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
  for (const proof of ['invalid', 'other-project', 'stale', 'email']) {
    await customer('/auth/firebase', 'POST', { idToken: proof, name: 'Customer', role: 'customer' }, 400);
  }
  await customer('/auth/firebase', 'POST', { idToken: 'customer', phone: identities.admin, name: 'Customer', role: 'admin' }, 400);
  const account = await customer('/auth/firebase', 'POST', {
    idToken: 'customer', phone: identities.admin, name: 'Customer', role: 'customer',
  });
  assert.equal(account.phone, identities.customer);
  assert.equal(account.approval, 'pending');
  await customer('/requests', 'GET', undefined, 403);
  assert.equal((await admin('/auth/firebase', 'POST', { idToken: 'admin' })).role, 'admin');
  await admin('/admin/users/' + account.id, 'PATCH', { approval: 'approved' });
  assert.deepEqual(await customer('/requests'), []);
  await admin('/admin/users/' + account.id, 'PATCH', { approval: 'blocked' });
  assert.equal((await customer('/me')).user, null);
  await customer('/auth/firebase', 'POST', { idToken: 'customer' }, 403);
});
