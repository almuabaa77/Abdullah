import { activeLimit, cities, specialties, serviceSpecialties } from './public/market.js';

const active = "('new','in_progress','needs_info')";
const minute = 60_000;
const fallbackDelay = 30 * minute;
export const isActive = status => ['new', 'in_progress', 'needs_info'].includes(status);

export function migrateMarketplace(db) {
  db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
  try {
    const additions = {
      users: {
        city: 'TEXT', specialties: "TEXT NOT NULL DEFAULT '[]'", paused_until: 'INTEGER NOT NULL DEFAULT 0',
        batch_locked: 'INTEGER NOT NULL DEFAULT 0',
      },
      requests: {
        mode: "TEXT NOT NULL DEFAULT 'admin'", title: 'TEXT', city: 'TEXT', specialty: 'TEXT',
        brief: "TEXT NOT NULL DEFAULT ''", opened_at: 'INTEGER', ranking: "TEXT NOT NULL DEFAULT 'rating'",
      },
    };
    for (const [table, columns] of Object.entries(additions)) {
      const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      for (const [column, spec] of Object.entries(columns)) {
        if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
      }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS offers (
        id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
        agent_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, days INTEGER NOT NULL,
        note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', updated TEXT NOT NULL,
        UNIQUE(request_id, agent_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS offers_selected_once ON offers(request_id) WHERE status='selected';
      CREATE TABLE IF NOT EXISTS tracking (
        id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id),
        kind TEXT NOT NULL, value TEXT, created TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ratings (
        request_id INTEGER PRIMARY KEY REFERENCES requests(id), agent_id INTEGER NOT NULL REFERENCES users(id),
        score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5)
      );
      CREATE INDEX IF NOT EXISTS ratings_agent ON ratings(agent_id);
      CREATE INDEX IF NOT EXISTS tracking_request ON tracking(request_id, id);
      CREATE INDEX IF NOT EXISTS requests_market ON requests(mode,status,agent_id);
      UPDATE users SET batch_locked=1 WHERE role='agent' AND id IN (
        SELECT agent_id FROM requests WHERE status IN ${active} GROUP BY agent_id HAVING COUNT(*) >= ${activeLimit}
      );
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function distance(from, to) {
  const first = cities[from]?.coordinates;
  const second = cities[to]?.coordinates;
  if (!first || !second) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const latitude = radians(second[0] - first[0]);
  const longitude = radians(second[1] - first[1]);
  const chord = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(first[0])) * Math.cos(radians(second[0])) * Math.sin(longitude / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(Math.min(1, chord))));
}

export function createMarketplace({ get, all, run, transaction, notice, fail, input, clock = Date.now }) {
  const stamp = () => new Date(clock()).toISOString();
  const log = (id, kind, value = null) => run('INSERT INTO tracking(request_id,kind,value,created) VALUES(?,?,?,?)', id, kind, value, stamp());
  const profileSql = `SELECT u.*, coalesce(w.active_count,0) AS active_count,
    coalesce(r.review_count,0) AS review_count, r.rating FROM users u
    LEFT JOIN (SELECT agent_id,count(*) AS active_count FROM requests WHERE status IN ${active} GROUP BY agent_id) w ON w.agent_id=u.id
    LEFT JOIN (SELECT agent_id,count(*) AS review_count,round(avg(score),1) AS rating FROM ratings GROUP BY agent_id) r ON r.agent_id=u.id`;
  const info = row => ({
    id: row.id, city: row.city, specialties: JSON.parse(row.specialties), active_count: row.active_count,
    batch_locked: Boolean(row.batch_locked && row.active_count), paused_until: row.paused_until,
    rating: row.rating, review_count: row.review_count,
    available: row.approval === 'approved' && row.paused_until !== -1 && row.paused_until <= clock()
      && !(row.batch_locked && row.active_count) && row.active_count < activeLimit,
  });
  const profile = id => {
    const row = get(profileSql + " WHERE u.id=? AND u.role='agent'", id);
    if (!row) fail(404, 'not_found');
    return info(row);
  };
  function agents() {
    return all(profileSql + " WHERE u.role='agent' AND u.approval='approved'").map(info);
  }
  function directory() {
    return all(profileSql + ' ORDER BY u.id DESC').map(row => ({
      id: row.id, phone: row.phone, name: row.name, role: row.role, approval: row.approval, created: row.created, city: row.city,
      ...(row.role === 'agent' ? info(row) : {}),
    }));
  }
  function updateProfile(id, data, canSetSpecialties) {
    profile(id);
    if (data.city !== undefined) {
      if (!Object.hasOwn(cities, data.city)) fail(400, 'invalid_input');
      run('UPDATE users SET city=? WHERE id=?', data.city, id);
    }
    if (data.specialties !== undefined) {
      if (!canSetSpecialties) fail(403, 'forbidden');
      const list = data.specialties;
      if (!Array.isArray(list) || list.length > Object.keys(specialties).length || list.some(item => !Object.hasOwn(specialties, item))) fail(400, 'invalid_input');
      run('UPDATE users SET specialties=? WHERE id=?', JSON.stringify([...new Set(list)]), id);
    }
    if (data.pause !== undefined) {
      const { pause } = data;
      if (![0, -1, 60, 240, 1440].includes(pause)) fail(400, 'invalid_input');
      run('UPDATE users SET paused_until=? WHERE id=?', pause > 0 ? clock() + pause * minute : pause, id);
    }
    return profile(id);
  }
  function config(data, catalogSpecialty) {
    const mode = data.mode ?? 'admin';
    if (!['admin', 'instant', 'offers'].includes(mode)) fail(400, 'invalid_input');
    const manual = data.service === 'manual';
    const title = manual ? input(data.title, 90, true) : null;
    const specialty = manual ? data.specialty : catalogSpecialty || serviceSpecialties[data.service];
    if (!Object.hasOwn(specialties, specialty)) fail(400, 'invalid_input');
    const city = data.city ?? null;
    if ((city || mode !== 'admin') && !Object.hasOwn(cities, city)) fail(400, 'invalid_input');
    const ranking = data.ranking ?? 'rating';
    if (!['rating', 'distance'].includes(ranking)) fail(400, 'invalid_input');
    return { mode, title, specialty, city, ranking, brief: input(data.brief, 280), opened: mode === 'admin' ? null : clock() };
  }
  function opportunities(request, available) {
    const matching = available.filter(agent => agent.specialties.includes(request.specialty));
    const elapsed = clock() - (request.opened_at ?? Date.parse(request.created));
    const hasOffer = elapsed >= fallbackDelay && matching.length && all(
      "SELECT agent_id FROM offers WHERE request_id=? AND status='open'", request.id)
      .some(offer => matching.some(agent => agent.id === offer.agent_id));
    const broaden = !matching.length || (elapsed >= fallbackDelay && !hasOffer);
    const byRating = (a, b) => (b.rating ?? 0) - (a.rating ?? 0);
    const byDistance = (a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER);
    const compare = request.ranking === 'distance'
      ? (a, b) => byDistance(a, b) || byRating(a, b)
      : (a, b) => byRating(a, b) || byDistance(a, b);
    const eligible = (broaden ? available : matching)
      .filter(agent => agent.specialties.length)
      .map(agent => ({ ...agent, match: agent.specialties.includes(request.specialty), distance: distance(agent.city, request.city) }))
      .sort((a, b) => Number(b.match) - Number(a.match) || compare(a, b)
        || a.active_count - b.active_count || a.id - b.id);
    const first = request.mode === 'instant' ? 1 : 3;
    return broaden && elapsed >= fallbackDelay ? eligible : eligible.slice(0, first + Math.max(0, Math.floor(elapsed / minute)));
  }
  function live(id) {
    const available = agents().filter(agent => agent.available);
    const mine = available.find(agent => agent.id === id);
    if (!mine || !mine.specialties.length) return [];
    const offers = new Map(all("SELECT * FROM offers WHERE agent_id=? AND status='open'", id).map(row => [row.request_id, row]));
    const requests = all("SELECT id,service,title,mode,city,specialty,brief,created,opened_at,ranking,catalog_title_ar,catalog_title_en FROM requests WHERE mode<>'admin' AND status='new' AND agent_id IS NULL ORDER BY id DESC");
    return requests.flatMap(request => {
      const ranked = opportunities(request, available);
      const rank = ranked.findIndex(agent => agent.id === id);
      if (rank < 0 && !offers.has(request.id)) return [];
      return [{
        ...request, priority: rank < 0 ? null : rank + 1, distance: distance(mine.city, request.city),
        match: mine.specialties.includes(request.specialty), offer: offers.get(request.id) || null,
      }];
    });
  }
  function marketRequest(id) {
    return get('SELECT * FROM requests WHERE id=?', id);
  }
  function requireLive(id, user) {
    if (user.role !== 'agent') fail(403, 'forbidden');
    const listing = live(user.id).find(item => item.id === id);
    if (!listing) fail(409, 'market_unavailable');
    return listing;
  }
  function syncBatch(id) {
    if (!id) return;
    const { active_count } = profile(id);
    if (active_count >= activeLimit || active_count === 0) {
      run('UPDATE users SET batch_locked=? WHERE id=?', Number(active_count >= activeLimit), id);
    }
  }
  function assign(request, agent, offer = null) {
    if (!isActive(request.status)) fail(409, 'invalid_transition');
    if (request.agent_id === agent) return;
    if (!profile(agent).available) fail(409, 'agent_unavailable');
    const status = request.mode !== 'admin' && request.status === 'new' ? 'in_progress' : request.status;
    run('UPDATE requests SET agent_id=?, status=?, updated=? WHERE id=?', agent, status, stamp(), request.id);
    run("UPDATE offers SET status='closed' WHERE request_id=? AND status IN ('open','selected')", request.id);
    if (offer) run("UPDATE offers SET status='selected' WHERE id=?", offer);
    syncBatch(request.agent_id);
    syncBatch(agent);
    log(request.id, offer ? 'offer_selected' : 'assigned');
    notice(agent, request.id, 'assigned');
    notice(request.customer_id, request.id, 'assigned');
  }
  function marketAction(id, user, action, data) {
    return transaction(() => {
      const request = marketRequest(id);
      if (action === 'choose' || action === 'rate') {
        if (request?.customer_id !== user.id) fail(404, 'not_found');
      } else if (user.role !== 'agent') {
        fail(403, 'forbidden');
      }
      if (!request) fail(404, 'not_found');
      if (action === 'rate') {
        if (request.status !== 'completed' || !request.agent_id || !Number.isInteger(data.score) || data.score < 1 || data.score > 5) fail(400, 'invalid_input');
        run('INSERT OR IGNORE INTO ratings(request_id,agent_id,score) VALUES(?,?,?)', id, request.agent_id, data.score);
        return;
      }
      if (request.agent_id || request.status !== 'new') fail(409, 'market_unavailable');
      if (action === 'choose') {
        if (request.mode !== 'offers') fail(409, 'market_unavailable');
        const offer = get("SELECT * FROM offers WHERE id=? AND request_id=? AND status='open'", Number(data.offer_id), id);
        if (!offer) fail(409, 'market_unavailable');
        assign(request, offer.agent_id, offer.id);
        return;
      }
      if (action === 'withdraw') {
        run("UPDATE offers SET status='withdrawn' WHERE request_id=? AND agent_id=? AND status='open'", id, user.id);
        return;
      }
      const listing = requireLive(id, user);
      if (action === 'claim' && listing.mode === 'instant') {
        assign(request, user.id);
        return;
      }
      if (action !== 'offer' || listing.mode !== 'offers') fail(409, 'market_unavailable');
      const { amount, days } = data;
      if (!Number.isFinite(amount) || amount < 1 || amount > 100000 || !Number.isInteger(days) || days < 1 || days > 365) fail(400, 'invalid_input');
      run(`INSERT INTO offers(request_id,agent_id,amount,days,note,updated) VALUES(?,?,?,?,?,?)
        ON CONFLICT(request_id,agent_id) DO UPDATE SET amount=excluded.amount,days=excluded.days,note=excluded.note,status='open',updated=excluded.updated`,
        id, user.id, Math.round(amount * 100), days, input(data.note, 500), stamp());
      if (!listing.offer) {
        log(id, 'offer_received');
        notice(request.customer_id, id, 'offer_received');
      }
    });
  }
  function reopen(request, mode) {
    if (request.status === 'completed' || !['admin','offers','instant'].includes(mode)) fail(409, 'invalid_transition');
    const specialty = request.specialty || serviceSpecialties[request.service];
    // Legacy requests have no city. Route these as remote until a city is known.
    run("UPDATE requests SET agent_id=NULL, status='new', mode=?, specialty=?, city=coalesce(city,'other'), opened_at=?, updated=? WHERE id=?",
      mode, specialty, clock(), stamp(), request.id);
    run("UPDATE offers SET status='closed' WHERE request_id=? AND status IN ('open','selected')", request.id);
    syncBatch(request.agent_id);
    log(request.id, 'reopened');
    notice(request.customer_id, request.id, 'reopened');
  }
  function details(request, user) {
    const rows = all(`SELECT o.*,u.name AS agent_name FROM offers o JOIN users u ON u.id=o.agent_id
      WHERE o.request_id=? ORDER BY o.amount,o.days,o.id`, request.id);
    const quotes = rows.filter(row => user.role === 'admin' || row.status === 'selected'
      || (user.id === request.customer_id && !request.agent_id && request.status === 'new' && row.status === 'open')).map(row => {
      const { rating, review_count, available } = profile(row.agent_id);
      return { ...row, rating, review_count, available };
    });
    const tracking = all('SELECT kind,value,created FROM tracking WHERE request_id=? ORDER BY id', request.id);
    return {
      offers: quotes,
      history: [{ kind: 'created', created: request.created }, ...tracking.filter(row => user.role !== 'agent' || row.kind !== 'offer_received')],
      rating: get('SELECT score FROM ratings WHERE request_id=?', request.id)?.score || null,
    };
  }
  return { profile, directory, updateProfile, config, live, log, syncBatch, assign, marketAction, reopen, details };
}
