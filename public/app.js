import { categories, legacyServiceNames, statuses, roles } from './catalog.js';
import { copy } from './copy.js';
import { normalizePhone } from './phone.js';
import { registrationName } from './registration-name.js';
import { activeLimit, cities, specialties, suggestedSpecialty } from './market.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const state = {
  marketProfile: null, live: [], liveFilters: { sort: 'priority', city: 'all', specialty: 'all' }, userQuery: '',
  lang: localStorage.getItem('waslah-language') === 'en' ? 'en' : 'ar',
  config: {}, user: null, route: 'dashboard', requests: [], events: [], users: [], services: [], adminServices: [], userRole: 'all',
  menu: '', drawer: false, category: 'all', filter: 'all', query: '', userFilter: 'all',
  authMode: 'login', authStep: 'phone', login: {}, chats: [], assistantBusy: false, ready: false,
};
const local = pair => pair?.[state.lang === 'en' ? 1 : 0] ?? '';
const t = key => local(copy[key]) || key;
const escape = text => String(text ?? '').replace(/[&<>"']/g, key => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[key]);
const byService = id => state.services.find(service => service.id === id);
const icon = (name, className = '') => `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
const drawIcons = () => window.lucide?.createIcons({ attrs: { 'stroke-width': 1.75 } });
const arrow = () => icon(state.lang === 'ar' ? 'arrow-left' : 'arrow-right');
const chevron = () => icon(state.lang === 'ar' ? 'chevron-left' : 'chevron-right');
const digit = value => new Intl.NumberFormat(state.lang === 'en' ? 'en' : 'ar-SA-u-nu-latn').format(value);
const date = stamp => stamp ? new Intl.DateTimeFormat(state.lang === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(stamp)) : '—';
const requestNumber = id => 'WS-' + String(1000 + id);
const customer = () => state.user.role === 'customer';
const admin = () => state.user.role === 'admin';
const specialist = () => state.user?.role === 'agent';
const snapshotName = row => [row.catalog_title_ar, row.catalog_title_en];
const requestTitle = row => row.service === 'manual' ? escape(row.title)
  : escape(local(snapshotName(row)) || local(byService(row.service)?.name) || local(legacyServiceNames[row.service]) || t('serviceFallback'));
const approvalLabel = { pending: 'onHold', approved: 'approved', rejected: 'rejected', suspended: 'suspended', blocked: 'blocked' };
const brand = () => `<span class="brand-symbol"><img src="/assets/waslah.svg" alt=""></span><span><strong>${t('brand')}<i></i></strong><small>${t('platform')}</small></span>`;

async function api(path, method = 'GET', payload) {
  const response = await fetch('/api' + path, {
    method, headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'error'), { retryAt: data.retryAt, serverTime: data.serverTime });
  return data;
}
let toastTimer;
function flash(message, isError = false) {
  clearTimeout(toastTimer);
  toast.className = isError ? 'toast error' : 'toast';
  toast.innerHTML = `${icon(isError ? 'circle-alert' : 'circle-check')}<span>${escape(message)}</span>`;
  toast.hidden = false;
  drawIcons();
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4400);
}
const report = error => flash(copy[error.message] ? t(error.message) : t('error'), true);
function showAuthError(error) {
  if (error?.retryAt) state.login.retryAt = Date.now() + Math.max(0, error.retryAt - error.serverTime);
  const message = app.querySelector('#auth-error');
  if (!message) {
    if (error) report(error);
    return;
  }
  message.textContent = error ? t(copy[error.message] ? error.message : 'error') : '';
  if (error?.providerCode) {
    const code = document.createElement('bdi');
    code.dir = 'ltr';
    code.textContent = `(${error.providerCode})`;
    message.append(' ', code);
  }
  message.hidden = !error;
  updateVerificationTimer();
}
function navigation() {
  return [
    ['dashboard', 'layout-dashboard', 'dashboard'],
    ...(customer() ? [['services', 'grid-2x2', 'services']] : []),
    ...(specialist() && state.config.market ? [['live', 'radio', 'live']] : []),
    ['requests', 'file-text', customer() ? 'requests' : admin() ? 'allRequests' : 'assignments'],
    ...(admin() ? [['users', 'users-round', 'users'], ['services-admin', 'layout-grid', 'servicesAdmin']] : []),
  ];
}
function navItem(route, glyph, label) {
  const current = state.route === route;
  return `<button class="nav-item${current ? ' active' : ''}" data-route="${route}" ${current ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${t(label)}</span></button>`;
}
function sidebar() {
  const links = navigation().map(item => navItem(...item)).join('');
  return `<aside class="sidebar ${state.drawer ? 'open' : ''}" aria-label="${t('workspace')}">
    <button class="brand" data-route="dashboard">${brand()}</button>
    <div class="sidebar-core"><div class="nav-label">${t('workspace')}</div><nav class="nav-stack">${links}</nav></div>
    <div class="side-bottom">
      <button class="assistant-card" data-action="assistant">
        <span class="assistant-icon">${icon('sparkles')}</span>
        <span><strong>${t('assistant')}</strong><small>${t('assistantMini')}</small></span>
        ${chevron()}
      </button>
      <div class="bottom-rule"></div>
      <nav class="nav-stack">${navItem('help', 'circle-help', 'help')}${navItem('settings', 'user-round', 'profile')}</nav>
    </div>
  </aside>`;
}
function languageBtn() {
  return `<button class="language-button" data-action="language" aria-label="${t('language')}">${icon('globe-2')} <span>${state.lang === 'ar' ? 'English' : 'العربية'}</span></button>`;
}
let installPrompt;
function installControl() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  return `<button class="language-button" data-action="install" aria-label="${t('installApp')}">${icon('download')} <span>${t('installApp')}</span></button>`;
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = undefined; app.querySelectorAll('[data-action="install"]').forEach(button => button.remove()); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
function header() {
  const current = state.route === 'dashboard' ? 'dashboardTitle' : navigation().find(([route]) => route === state.route)?.[2] || (state.route === 'settings' ? 'profile' : state.route);
  const unread = state.events.some(event => !event.seen);
  return `<header class="topbar">
    <div class="top-start"><button class="icon-button mobile-menu" data-action="drawer" aria-label="${t('menu')}" aria-expanded="${state.drawer}">${icon('menu')}</button>
      <div class="breadcrumb">${icon('panels-top-left')}<span>${t(current)}</span></div></div>
    <div class="top-actions">
      ${installControl()}${languageBtn()}
      <div class="menu-wrap"><button class="icon-button bell" data-action="notifications" aria-label="${t('notifications')}" aria-expanded="${state.menu === 'notifications'}">${icon('bell')}${unread ? '<i class="unread-dot"></i>' : ''}</button>
      ${state.menu === 'notifications' ? notificationMenu() : ''}</div>
      <div class="header-divider"></div>
      <div class="menu-wrap"><button class="profile-trigger" data-action="profile" aria-label="${t('profile')}" aria-expanded="${state.menu === 'profile'}">
        <span class="avatar">${escape(state.user.name.slice(0, 1))}</span>
        <span class="profile-name"><strong>${escape(displayName(state.user.name))}</strong><small>${local(roles[state.user.role])}</small></span>
        ${icon('chevron-down')}
      </button>${state.menu === 'profile' ? profileMenu() : ''}</div>
    </div>
  </header>`;
}
const displayName = name => name;
function profileMenu() {
  return `<div class="popover profile-popover">
    <button class="menu-item" data-route="settings">${icon('user-round')}${t('profile')}</button>
    <div class="menu-divider"></div><button class="menu-item" data-action="logout">${icon('log-out')}${t('logout')}</button>
  </div>`;
}
function notificationMenu() {
  const labels = { status: 'noticeStatus', new: 'noticeNew', message: 'noticeMessage', assigned: 'noticeAssigned', offer_received: 'historyOffer', reopened: 'historyReopened' };
  return `<div class="popover notice-popover"><div class="popover-title"><strong>${t('notifications')}</strong>${state.events.some(event => !event.seen) ? `<button class="text-button" data-action="read">${t('markRead')}</button>` : ''}</div>
    <div class="notice-list">${state.events.length ? state.events.map(event => `<button class="notice ${event.seen ? '' : 'unseen'}" data-request="${event.request_id}">${icon(event.kind === 'message' ? 'message-circle' : 'bell')}
    <span><strong>${t(labels[event.kind])}</strong><small><bdi>${requestNumber(event.request_id)}</bdi> · ${local(statuses[event.value]) || date(event.created)}</small></span></button>`).join('') : `<p class="muted">${t('noNotifications')}</p>`}</div></div>`;
}
function sectionHeader(title, subtitle, action = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}
function newRequestButton() {
  return `<button class="button primary" data-route="services">${icon('plus')}${t('newRequest')}</button>`;
}
function dashboard() {
  const count = status => state.requests.filter(item => item.status === status).length;
  const first = escape(displayName(state.user.name).split(' ')[0]);
  return `${sectionHeader(`${t('greeting')} ${first} <span class="wave" aria-hidden="true">👋</span>`,
    t(customer() ? 'greetingSub' : admin() ? 'adminSub' : 'agentSub'), customer() ? newRequestButton() : '')}
    ${admin() ? adminOverview() : customer() ? customerOverview() : ''}
    <section class="dashboard-section summary-section" aria-label="${t('summary')}"><div class="section-heading"><h2>${t('summary')}</h2></div>
    <div class="stat-grid">
      ${statCard('all', 'files', 'purple', 'total', state.requests.length)}
      ${statCard('in_progress', 'timer', 'blue', 'progress', count('in_progress'))}
      ${statCard('completed', 'circle-check', 'teal', 'complete', count('completed'))}
      ${statCard('needs_info', 'circle-alert', 'amber', 'action', count('needs_info'))}
    </div></section>
    ${customer() && state.services.length ? `<section class="dashboard-section"><div class="section-heading"><h2>${t('publishedServices')}</h2>
      <button class="text-link" data-route="services">${t('allServices')}${arrow()}</button></div>
      <div class="service-grid">${state.services.slice(0, 3).map(serviceCard).join('')}</div></section>` : ''}
    ${specialist() && state.config.market ? `<section class="dashboard-section agent-dashboard">${availabilityCard()}<div class="agent-live-link"><span class="tile-icon purple">${icon('radio')}</span><h2>${t('live')} <bdi>${state.live.length}</bdi></h2><button class="button primary" data-route="live">${t('live')}${arrow()}</button></div></section>` : ''}
    <section class="dashboard-section recent-section"><div class="section-heading"><h2>${t('latest')}</h2>
      <button class="text-link" data-route="requests">${t('viewAll')}${arrow()}</button></div>${requestTable(state.requests.slice(0, 4))}</section>`;
}
function statCard(filter, glyph, tone, label, number) {
  return `<button class="stat-card" data-stat="${filter}"><span class="tile-icon ${tone}">${icon(glyph)}</span>
    <span class="stat-data"><strong>${digit(number)}</strong><small>${t(label)}</small></span><span class="stat-arrow">${chevron()}</span></button>`;
}
function serviceCard(service) {
  const glyph = { government: 'contact-round', insurance: 'shield-plus', documents: 'badge-check', business: 'briefcase-business' }[service.category];
  return `<article class="service-card"><div class="service-card-top"><span class="tile-icon purple">${icon(glyph)}</span><span class="category-pill">${local(categories[service.category])}</span></div>
    <h3>${escape(local(service.name))}</h3><p>${escape(local(service.description))}</p>
    <div class="service-card-bottom"><span>${local(specialties[service.specialty])}</span>
      <button class="service-go" data-service="${service.id}" aria-label="${t('newRequest')} · ${escape(local(service.name))}">${arrow()}</button></div></article>`;
}
function requestTable(list, filtered = false) {
  if (!list.length) return empty('clipboard-list', filtered ? 'noResults' : 'emptyRequests', filtered ? '' : 'emptySub');
  return `<div class="table-box request-table"><table><thead><tr><th>${t('requestId')}</th><th>${t('service')}</th>${customer() ? '' : `<th>${t('customer')}</th>`}<th>${t('status')}</th><th>${t('date')}</th><th><span class="sr-only">${t('view')}</span></th></tr></thead>
    <tbody>${list.map(row => `<tr><td class="table-id"><bdi class="request-number">${requestNumber(row.id)}</bdi></td><td class="table-service">${requestTitle(row)}</td>
      ${customer() ? '' : `<td class="table-peer">${escape(displayName(row.customer_name))}</td>`}<td class="table-status">${statusBadge(row.status)}</td><td class="table-date">${date(row.created)}</td>
      <td class="table-actions"><button class="table-go" data-request="${row.id}" aria-label="${t('view')} ${requestNumber(row.id)}">${chevron()}</button></td></tr>`).join('')}</tbody></table></div>`;
}
const statusBadge = status => `<span class="status-pill status-${status}"><i></i>${local(statuses[status])}</span>`;
function empty(glyph, title, subtitle = '') {
  return `<div class="empty"><span class="tile-icon purple">${icon(glyph)}</span><strong>${t(title)}</strong>${subtitle ? `<p>${t(subtitle)}</p>` : ''}</div>`;
}
function searchBox(key) {
  return `<label class="search-box">${icon('search')}<input type="search" data-search aria-label="${t(key)}" placeholder="${t(key)}" value="${escape(state.query)}"></label>`;
}
function serviceResults() {
  if (!state.services.length) return empty('layout-grid', 'serviceEmpty', 'serviceEmptySub');
  const query = state.query.trim().toLowerCase();
  const list = state.services.filter(service => (state.category === 'all' || service.category === state.category)
    && [...service.name, ...service.description].some(value => value.toLowerCase().includes(query)));
  return list.length ? `<div class="service-grid catalog-grid">${list.map(serviceCard).join('')}</div>` : empty('search', 'noResults');
}
function catalog() {
  return `${sectionHeader(t('services'), t('catalogIntro'), state.config.market ? `<button class="button secondary" data-action="manual">${icon('pen-line')}${t('manual')}</button>` : '')}<div class="list-tools"><div class="chips">
    ${[['all', t('all')], ...Object.entries(categories).map(([key, v]) => [key, local(v)])].map(([key, label]) => `<button class="chip ${state.category === key ? 'selected' : ''}" data-category="${key}" aria-pressed="${state.category === key}">${label}</button>`).join('')}
    </div>${searchBox('searchServices')}</div><div id="results">${serviceResults()}</div>`;
}
function requestResults() {
  const query = state.query.trim().toLowerCase();
  const list = state.requests.filter(request => (state.filter === 'all'
    || (state.filter === 'unassigned' ? !request.agent_id && request.status === 'new' : request.status === state.filter))
    && [requestNumber(request.id), request.title || '', request.customer_name, request.agent_name, ...snapshotName(request), ...(byService(request.service)?.name || legacyServiceNames[request.service] || [])].filter(Boolean).some(value => value.toLowerCase().includes(query)));
  return requestTable(list, !!query || state.filter !== 'all');
}
function requestsPage() {
  const label = navigation().find(([route]) => route === 'requests')[2];
  return `${sectionHeader(t(label), t(customer() ? 'greetingSub' : admin() ? 'adminSub' : 'agentSub'), customer() ? newRequestButton() : '')}
    <div class="list-tools">${searchBox('searchRequests')}<select class="filter-select" id="request-filter" aria-label="${t('filter')}">
      ${[['all', t('all')], ...(admin() ? [['unassigned', t('dispatchQueue')]] : []), ...Object.entries(statuses).map(([key, value]) => [key, local(value)])].map(([key, label]) => `<option value="${key}" ${key === state.filter ? 'selected' : ''}>${label}</option>`).join('')}
    </select></div><div id="results">${requestResults()}</div>`;
}
function usersPage() {
  return `${sectionHeader(t('users'), t('userIntro'))}<div class="list-tools"><div class="chips">
    ${['all', 'pending', 'approved', 'suspended', 'blocked', 'rejected'].map(key => `<button class="chip ${state.userFilter === key ? 'selected' : ''}" data-userfilter="${key}" aria-pressed="${state.userFilter === key}">${t(approvalLabel[key] || key)}</button>`).join('')}
    </div><label class="search-box">${icon('search')}<input type="search" data-user-search aria-label="${t('searchUsers')}" value="${escape(state.userQuery)}" placeholder="${t('searchUsers')}"></label>
    <select id="user-role-filter" class="filter-select" aria-label="${t('filterPeople')}">${[['all', t('all')], ...Object.entries(roles).map(([key, label]) => [key, local(label)])].map(([key, label]) => `<option value="${key}" ${state.userRole === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div id="user-results">${userResults()}</div>`;
}
function userResults() {
    const query = state.userQuery.trim().toLowerCase();
  const all = state.users.filter(user => (state.userFilter === 'all' || user.approval === state.userFilter)
    && (state.userRole === 'all' || user.role === state.userRole)
    && [user.name, user.phone].some(value => value.toLowerCase().includes(query)));
  return `${all.length ? `<div class="table-box user-table"><table><thead><tr><th>${t('name')}</th><th>${t('phone')}</th><th>${t('accountType')}</th><th>${t('status')}</th><th>${t('registrationDate')}</th><th></th></tr></thead><tbody>
    ${all.map(user => `<tr><td class="table-service">${escape(displayName(user.name))}</td><td class="table-phone"><bdi>${escape(user.phone)}</bdi></td><td class="table-role">${local(roles[user.role])}</td>
      <td class="table-status"><span class="status-pill approval-${user.approval}"><i></i>${t(approvalLabel[user.approval])}</span></td><td class="table-date">${date(user.created)}</td>
      <td class="table-actions"><div class="row-actions">${user.approval === 'pending' ? `<button class="button primary small" data-approval="approved" data-user="${user.id}">${t('approve')}</button><button class="button secondary small" data-approval="rejected" data-user="${user.id}">${t('decline')}</button>` : ''}
      ${state.config.market && user.role !== 'admin' ? `<button class="button secondary small" data-manage="${user.id}">${t('userManage')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : empty('users-round', 'noUsers')}`;
}
function selectedChoice(name, label, options, value, placeholder) {
  return `<label>${label}<select name="${name}" required>${placeholder ? `<option value="">${placeholder}</option>` : ''}
    ${options.map(([key, text]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
}
const cityOptions = () => Object.entries(cities).map(([key, item]) => [key, local(item.name)]);
const specialtyOptions = () => Object.entries(specialties).map(([key, item]) => [key, local(item)]);
const modeOptions = () => [['offers', t('dispatchOffers')], ['instant', t('dispatchInstant')], ['admin', t('dispatchAdmin')]];
const pauseOptions = () => [[0, t('resume')], [60, t('pauseHour')], [240, t('pauseFour')], [1440, t('pauseDay')], [-1, t('pauseManual')]];
const localeTime = stamp => new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stamp));
function availabilityCard() {
  const profile = state.marketProfile;
  if (!profile) return '';
  const paused = profile.paused_until === -1 || profile.paused_until > Date.now();
  const summary = paused
    ? (profile.paused_until === -1 ? t('paused') : t('pausedUntil') + ' ' + localeTime(profile.paused_until))
    : t(profile.batch_locked ? 'capacityReached' : profile.specialties.length ? 'accepting' : 'setupNeeded');
  return `<section class="market-availability"><div class="availability-main">
    <span class="tile-icon ${profile.available && profile.specialties.length ? 'teal' : 'amber'}">${icon(paused ? 'bell-off' : 'radio')}</span>
    <div><h2>${t('liveStatus')}</h2><p>${summary}</p></div>
    <div class="capacity"><strong><bdi dir="ltr">${profile.active_count} / ${activeLimit}</bdi></strong><small>${t('assignedActive')}</small></div></div>
    <div class="capacity-track" aria-hidden="true">${Array.from({ length: activeLimit }, (_, i) => `<i class="${i < profile.active_count ? 'filled' : ''}"></i>`).join('')}</div>
    <p class="muted">${profile.batch_locked ? t('batchHelp') : !profile.specialties.length ? t('configureSpecialty') : t('pauseHelp')}</p>
    <div class="market-profile-tags">${profile.city ? `<span>${icon('map-pin')}${local(cities[profile.city]?.name)}</span>` : ''}
    ${profile.specialties.map(key => `<span>${local(specialties[key])}</span>`).join('')}
    ${profile.rating ? `<span>${icon('star')}${digit(profile.rating)} (${profile.review_count})</span>` : ''}</div>
    <button class="button secondary" data-action="availability">${icon('sliders-horizontal')}${t('pauseOptions')}</button></section>`;
}
function livePage() {
  const filter = (key, label, entries) => selectedChoice(key, label, entries, state.liveFilters[key]);
  return `<section class="live-canvas"><h1 class="sr-only">${t('live')}</h1>
    ${state.live.length ? `<details class="live-filter-panel"><summary>${icon('sliders-horizontal')}${t('filterLive')}</summary>
    <form class="market-filters" aria-label="${t('live')}">
    ${filter('sort', t('priority'), [['priority', t('priority')], ['distance', t('nearest')], ['newest', t('newest')]])}
    ${filter('city', t('city'), [['all', t('all')], ...cityOptions()])}
    ${filter('specialty', t('specialty'), [['all', t('all')], ...specialtyOptions()])}</form></details>` : ''}
    <div id="live-results">${liveResults()}</div></section>`;
}
function liveResults() {
  if (!state.live.length) return `<div class="live-searching" role="status"><span class="live-pulse" aria-hidden="true"></span><span>${t('searchingLive')}</span></div>`;
  const { sort, city, specialty } = state.liveFilters;
  const list = state.live.filter(row => (city === 'all' || row.city === city) && (specialty === 'all' || row.specialty === specialty));
  if (sort === 'distance') list.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.id - a.id);
  if (sort === 'priority') list.sort((a, b) => Number(b.match) - Number(a.match) || (a.priority ?? Infinity) - (b.priority ?? Infinity) || b.id - a.id);
  if (!list.length) return `<p class="live-no-matches">${t('noResults')}</p>`;
  return `<div class="live-stack">${list.map(row => `<article class="live-card">
    <span class="tile-icon ${row.match ? 'purple' : 'amber'}">${icon(row.mode === 'offers' ? 'hand-coins' : 'zap')}</span>
    <div class="live-card-main"><div class="live-badges"><span class="category-pill">${local(specialties[row.specialty])}</span>
    <span class="status-pill ${row.match ? 'status-completed' : 'status-needs_info'}">${t(row.match ? 'match' : 'fallback')}</span>
    ${row.offer ? `<span class="status-pill status-new">${t('quotePending')}</span>` : ''}</div>
    <h3>${requestTitle(row)}</h3><p>${local(cities[row.city]?.name)}${row.distance == null ? '' : ` · ${digit(row.distance)} ${t('km')}`} · ${row.mode === 'offers' ? t('offers') : t('dispatchInstant')}</p></div>
    <button class="button secondary" data-live="${row.id}">${t('liveView')}${chevron()}</button></article>`).join('')}</div>`;
}
function availabilityForm() {
  const profile = state.marketProfile;
  openDialog(`${modalHeading(t('pauseOptions'), t('pauseHelp'))}<form class="form-stack" data-form="availability">
    ${selectedChoice('city', t('city'), cityOptions(), profile.city || 'other')}
    ${selectedChoice('pause', t('liveStatus'), [['keep', t('currentAvailability')], ...pauseOptions()], 'keep')}
    <button class="button primary">${t('save')}</button></form>`);
}
function openLive(id) {
  const listing = state.live.find(row => row.id === Number(id));
  if (!listing) throw new Error('market_unavailable');
  const offer = listing.offer;
  openDialog(`${modalHeading(requestTitle(listing), `${local(specialties[listing.specialty])} · ${local(cities[listing.city]?.name)}`)}
    ${listing.brief ? `<div class="detail-notes"><h3>${t('brief')}</h3><p>${escape(listing.brief)}</p></div>` : ''}
    ${listing.mode === 'instant' ? `<button class="button primary" data-market="claim" data-id="${id}">${icon('check')}${t('apply')}</button>` :
      `<form class="form-stack" data-form="offer" data-id="${id}">
      <div class="form-pair"><label>${t('quoteAmount')}<input type="number" name="amount" min="1" max="100000" step=".01" value="${offer ? offer.amount / 100 : ''}" required></label>
      <label>${t('quoteDays')}<input type="number" name="days" min="1" max="365" value="${offer?.days || ''}" required></label></div>
      <label>${t('quoteNote')}<textarea name="note" maxlength="500" rows="3">${escape(offer?.note)}</textarea></label>
      <div class="modal-actions"><button class="button primary">${t(offer ? 'editOffer' : 'sendOffer')}</button>
      ${offer ? `<button type="button" class="button secondary" data-market="withdraw" data-id="${id}">${t('withdrawOffer')}</button>` : ''}</div></form>`}`, 'live-detail');
  dialog.dataset.live = id;
}
function quoteMarkup(request) {
  if (request.mode !== 'offers' && !request.offers?.length) return '';
  const offers = request.offers || [];
  return `<section class="quote-section"><div class="section-heading"><h3>${t('offers')}</h3></div>
    ${offers.length ? offers.map(offer => `<article class="offer-card"><div>
      <strong>${escape(displayName(offer.agent_name))}</strong>
      ${offer.rating ? `<span class="offer-rating">${icon('star')} ${digit(offer.rating)} (${offer.review_count})</span>` : ''}
      <div class="offer-terms"><span>${digit(offer.amount / 100)} ${t('sar')}</span><span>${digit(offer.days)} ${t('days')}</span></div>
      ${offer.note ? `<p class="muted">${escape(offer.note)}</p>` : ''}</div>
      ${offer.status === 'selected' ? `<span class="status-pill status-completed">${t('chosen')}</span>`
        : offer.status !== 'open' ? `<span class="status-pill status-rejected">${t(offer.status === 'withdrawn' ? 'offerStatusWithdrawn' : 'offerStatusClosed')}</span>`
        : customer() && !request.agent_id ? (offer.available ? `<button class="button primary small" data-market="choose" data-id="${request.id}" data-offer="${offer.id}">${t('chooseOffer')}</button>` : `<span class="muted">${t('offerUnavailable')}</span>`) : ''}
    </article>`).join('') : `<p class="muted">${t('noOffers')}</p>`}</section>`;
}
function timelineMarkup(request) {
  const labels = { created: 'historyCreated', offer_received: 'historyOffer', offer_selected: 'historyChosen', assigned: 'historyAssigned', reopened: 'historyReopened' };
  return request.history?.length ? `<section class="timeline-section"><h3>${t('tracking')}</h3><ol class="request-timeline">
    ${request.history.map(event => `<li><span>${event.kind === 'status' ? local(statuses[event.value]) : t(labels[event.kind])}</span><time datetime="${escape(event.created)}">${localeTime(event.created)}</time></li>`).join('')}</ol></section>` : '';
}
async function manageUser(id) {
  const account = state.users.find(user => user.id === Number(id));
  if (!account) throw new Error('not_found');
  const [audit, evidence] = await Promise.all([api('/admin/users/' + account.id), api('/admin/users/' + account.id + '/registration')]);
  const agentFields = account.role === 'agent' ? `
    <fieldset class="specialty-choice"><legend>${t('specialty')}</legend>${specialtyOptions().map(([key, label]) => `<label><input type="checkbox" name="specialty" value="${key}" ${account.specialties?.includes(key) ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>
    ${selectedChoice('pause', t('liveStatus'), [['keep', t('currentAvailability')], ...pauseOptions()], 'keep')}` : '';
  const actions = {
    approved: [['suspended', t('suspend')]], suspended: [['approved', t('reactivate')]],
    rejected: [['approved', t('reactivate')]], pending: [['approved', t('approve')], ['rejected', t('decline')]],
    blocked: [['approved', t('unblock')]],
  }[account.approval];
  if (account.approval !== 'blocked') actions.push(['blocked', t('block')]);
  openDialog(`${modalHeading(t('userManage'), '<bdi>' + escape(account.phone) + '</bdi>')}
    <form class="form-stack" data-form="manage-user" data-id="${id}" data-agent="${account.role === 'agent'}">
    <label>${t('accountName')}<input name="name" value="${escape(account.name)}" maxlength="72" required></label>
    ${selectedChoice('city', t('city'), [['none', '—'], ...cityOptions()], account.city || 'none')}
    ${selectedChoice('approval', t('status'), [['keep', t('currentAvailability')], ...actions], 'keep')}
    ${evidence ? `<fieldset class="registration-review"><legend>${t('registrationEvidence')}</legend>
      <p><bdi>${escape(evidence.nationalId)}</bdi></p><p>${escape(evidence.address)}</p>
      <p><bdi>${evidence.location.latitude}, ${evidence.location.longitude} (±${Math.round(evidence.location.accuracy)} m)</bdi></p>
      <div class="registration-images">
        <figure><img alt="${t('selfie')}" src="data:image/jpeg;base64,${escape(evidence.selfie)}"><figcaption>${t('selfie')}</figcaption></figure>
        <figure><img alt="${t('identityPhoto')}" src="data:image/jpeg;base64,${escape(evidence.identity)}"><figcaption>${t('identityPhoto')}</figcaption></figure>
      </div>
      ${account.approval !== 'approved' ? `<label class="review-check"><input type="checkbox" name="registrationReviewed">${t('registrationReviewed')}</label>` : ''}
    </fieldset>` : ''}
    <p class="muted fine-print">${t('blockHint')}</p>${agentFields}
    <button class="button primary">${t('save')}</button></form>
    <section class="timeline-section"><h3>${t('audit')}</h3>
      ${audit.length ? `<ol class="request-timeline">${audit.map(entry => `<li>
        <span>${escape(entry.actor_name)} · ${entry.field === 'approval' ? t(approvalLabel[entry.current] || 'auditUpdate') : t(auditFields[entry.field] || 'auditUpdate')}</span>
        <time datetime="${escape(entry.created)}">${localeTime(entry.created)}</time></li>`).join('')}</ol>` : `<p class="muted">${t('auditEmpty')}</p>`}
    </section>`);
}
const auditFields = { name: 'accountName', city: 'city', specialties: 'specialty', paused_until: 'liveStatus' };

function settingsPage() {
  const person = state.user;
  return `${sectionHeader(t('profile'), local(roles[person.role]))}
    <div class="profile-layout"><section class="settings-card profile-identity">
    <div class="account-heading"><span class="avatar">${escape(person.name.slice(0, 1))}</span><div><h2>${escape(person.name)}</h2><p>${local(roles[person.role])}</p></div></div>
    <dl><div><dt>${t('verifiedPhone')}</dt><dd><bdi>${escape(person.phone)}</bdi></dd></div>
    <div><dt>${t('memberSince')}</dt><dd>${date(person.created)}</dd></div>
    <div><dt>${t('language')}</dt><dd>${languageBtn()}</dd></div></dl>
    <button class="button secondary" data-action="logout">${icon('log-out')}${t('logout')}</button></section>
    <section class="settings-card profile-edit"><h2>${t('accountName')}</h2><p>${t('profileHint')}</p>
    <form class="form-stack" data-form="profile-details">
      <label>${t('name')}<input name="name" value="${escape(person.name)}" maxlength="72" autocomplete="name" required></label>
      ${selectedChoice('city', t('preferredCity'), [['none', '—'], ...cityOptions()], person.city || 'none')}
      <button class="button primary">${t('saveProfile')}</button>
    </form></section>
    ${specialist() ? availabilityCard() : ''}</div>`;
}

function adminOverview() {
  const cards = [
    ['users-round', 'purple', 'reviewAccounts', state.users.filter(user => user.approval === 'pending').length, 'review-accounts', 'users'],
    ['route', 'amber', 'dispatchQueue', state.requests.filter(request => !request.agent_id && request.status === 'new').length, 'review-dispatch', 'manageDispatch'],
    ['layout-grid', 'teal', 'publishedServices', state.adminServices.filter(service => service.active).length, 'review-services', 'servicesAdmin'],
  ];
  return `<section class="admin-overview">${cards.map(([glyph, tone, title, count, action, label]) => `<article class="operation-tile">
    <div><span class="tile-icon ${tone}">${icon(glyph)}</span><bdi>${digit(count)}</bdi></div><h2>${t(title)}</h2>
    <button class="text-link" data-action="${action}">${t(label)}${arrow()}</button></article>`).join('')}</section>`;
}
function customerOverview() {
  const active = state.requests.find(row => row.status === 'needs_info')
    || state.requests.find(row => !['completed', 'rejected'].includes(row.status));
  return `<section class="customer-overview">
    <article class="operation-tile"><div><span class="tile-icon purple">${icon('sparkles')}</span></div>
      <h2>${t('customerStart')}</h2><p>${t('customerStartSub')}</p>
      <div class="customer-actions"><button class="button primary small" data-route="services">${t('browse')}${arrow()}</button>
      <button class="button secondary small" data-action="manual">${t('manual')}</button></div></article>
    <article class="operation-tile"><div><span class="tile-icon teal">${icon('file-text')}</span>${active ? statusBadge(active.status) : ''}</div>
      <h2>${active ? t('customerNext') : t('customerQuote')}</h2><p>${active ? requestTitle(active) : t('customerQuoteSub')}</p>
      ${active ? `<button class="text-link" data-request="${active.id}">${t('view')}${arrow()}</button>` : `<button class="text-link" data-route="requests">${t('requests')}${arrow()}</button>`}</article>
    </section>`;
}
function servicesAdmin() {
  return `${sectionHeader(t('servicesAdmin'), t('servicesAdminIntro'),
    `<button class="button primary" data-action="create-service">${icon('plus')}${t('serviceNew')}</button>`)}
    ${state.adminServices.length ? `<section class="service-grid catalog-grid">
      ${state.adminServices.map(service => `<article class="service-card">
        <div class="service-card-top"><span class="tile-icon purple">${icon('layout-grid')}</span>
        <span class="status-pill ${service.active ? 'status-completed' : 'status-new'}">${t(service.active ? 'serviceVisible' : 'serviceHidden')}</span></div>
        <h3>${escape(local(service.name))}</h3><p>${escape(local(service.description))}</p>
        <div class="service-card-bottom"><span>${local(specialties[service.specialty])}</span>
        <button class="button secondary small" data-edit-service="${service.id}">${t('serviceEdit')}</button></div>
      </article>`).join('')}</section>` : empty('layout-grid', 'serviceAdminEmpty')}`;
}
function serviceEditor(id) {
  const service = id ? state.adminServices.find(row => row.id === id) : null;
  if (id && !service) throw new Error('not_found');
  openDialog(`${modalHeading(t(id ? 'serviceEdit' : 'serviceNew'))}
  <form class="form-stack" data-form="edit-service" data-id="${id || ''}">
  <div class="form-pair"><label>${t('serviceNameAr')}<input name="name_ar" dir="rtl" maxlength="90" value="${escape(service?.name[0])}" required></label>
  <label>${t('serviceNameEn')}<input name="name_en" dir="ltr" maxlength="90" value="${escape(service?.name[1])}" required></label></div>
  <div class="form-pair"><label>${t('serviceDescAr')}<textarea name="description_ar" dir="rtl" maxlength="500" rows="3" required>${escape(service?.description[0])}</textarea></label>
  <label>${t('serviceDescEn')}<textarea name="description_en" dir="ltr" maxlength="500" rows="3" required>${escape(service?.description[1])}</textarea></label></div>
  <div class="form-pair"><label>${t('serviceDocsAr')}<textarea name="documents_ar" dir="rtl" maxlength="500" rows="3">${escape(service?.documents[0])}</textarea></label>
  <label>${t('serviceDocsEn')}<textarea name="documents_en" dir="ltr" maxlength="500" rows="3">${escape(service?.documents[1])}</textarea></label></div>
  <div class="form-pair">${selectedChoice('category', t('serviceCategory'), Object.entries(categories).map(([key, text]) => [key, local(text)]), service?.category)}
  ${selectedChoice('specialty', t('specialty'), specialtyOptions(), service?.specialty)}</div>
  <label class="checkbox-line"><input type="checkbox" name="active" ${service?.active ? 'checked' : ''}>${t('servicePublish')}</label>
  <button class="button primary">${t('save')}</button></form>`);
}

function helpPage() {
  return `${sectionHeader(t('help'), t('helpIntro'))}<div class="help-grid"><section class="settings-card"><div class="tile-icon purple">${icon('sparkles')}</div><h2>${t('assistant')}</h2><p>${t('assistantIntro')}</p><button class="button primary" data-action="assistant">${t('helpStart')}${arrow()}</button></section>
    <section class="settings-card"><div class="tile-icon teal">${icon('file-text')}</div><h2>${t('helpFollow')}</h2><p>${t('emptySub')}</p><button class="button secondary" data-route="requests">${t('viewAll')}${arrow()}</button></section></div>`;
}
function authFrame(content) {
  return `<div class="auth-layout"><header class="auth-header"><div class="brand">${brand()}</div><div class="auth-tools">${installControl()}${languageBtn()}</div></header><div class="auth-body"><div class="auth-card">${content}</div><div class="auth-art" aria-hidden="true"></div></div></div>`;
}
function auth() {
  const signup = state.authMode === 'signup';
  const code = state.authStep === 'code';
  const phone = escape(state.login.phone);
  const localFirebase = state.config.firebase && !code
    && (location.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  return authFrame(`<span class="tile-icon purple">${icon(code ? 'shield-check' : 'smartphone')}</span><h1>${t(code ? 'enterCode' : state.authMode)}</h1>
    <p>${code ? `${t('codeSent')} <bdi>${phone}</bdi>` : t('authSub')}</p>
    ${state.config.sms === false ? `<p class="auth-status" role="status">${icon('info')}${t('smsSetup')}</p>` : ''}
    ${localFirebase ? `<p class="auth-status" role="status">${icon('info')}${t('firebasePublishedDomain')}</p>` : ''}
    ${state.config.firebase ? '<div id="firebase-recaptcha"></div>' : ''}
    ${code ? `<p>${t('verificationCountdown')} <bdi data-verification-time role="timer"></bdi></p>` : ''}
    <p class="auth-status" data-verification-lock hidden></p>
    <form data-form="${code ? 'verify' : 'phone'}" class="form-stack">
      ${code ? `<label>${t('enterCode')}<input class="code-input" name="code" dir="ltr" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" maxlength="6" required></label>`
      : `${signup ? `<label>${t('registrationName')}<input name="name" autocomplete="name" maxlength="72" required value="${escape(state.login.name)}"></label><label>${t('accountType')}<select name="role"><option value="customer">${local(roles.customer)}</option><option value="agent" ${state.login.role === 'agent' ? 'selected' : ''}>${local(roles.agent)}</option></select></label>` : ''}
      <label>${t('phone')}<input name="phone" type="tel" dir="ltr" autocomplete="tel" placeholder="05XXXXXXXX" value="${phone}" required maxlength="28"></label>`}
      <button class="button primary" type="submit" ${state.config.sms === false ? 'disabled' : ''}>${t(code ? 'verify' : 'sendCode')}${arrow()}</button>
      <p id="auth-error" class="auth-error" role="alert" hidden></p>
    </form>
    ${code ? `<div class="auth-links"><button class="text-button" data-action="change-phone" aria-expanded="${!!state.login.editPhone}">${t('changePhone')}</button><button class="text-button" data-action="resend">${t('resend')}</button></div>
      ${state.login.editPhone ? `<form data-form="edit-phone" class="form-stack"><label>${t('phone')}<input name="phone" type="tel" dir="ltr" autocomplete="tel" maxlength="28" required value="${phone}"></label><button class="button secondary" type="submit">${t('sendCode')}</button></form>` : ''}`
      : `<button class="text-button auth-switch" data-action="auth-switch">${t(signup ? 'login' : 'signup')}</button>`}`);
}
function pending() {
  if (state.user.approval === 'pending' && state.user.needsRegistration) return registrationForm();
  const rejected = state.user.approval === 'rejected';
  const suspended = state.user.approval === 'suspended';
  return authFrame(`<span class="tile-icon ${rejected || suspended ? 'amber' : 'purple'}">${icon(rejected || suspended ? 'circle-alert' : 'clock-3')}</span>
    <h1>${t(suspended ? 'suspendedTitle' : rejected ? 'rejectedTitle' : 'pendingTitle')}</h1><p>${t(suspended ? 'suspendedSub' : rejected ? 'rejectedSub' : 'pendingSub')}</p>
    <div class="pending-actions"><button class="button primary" data-action="check-approval">${icon('refresh-cw')}${t('checkApproval')}</button><button class="button secondary" data-action="logout">${t('logout')}</button></div>`);
}

let registrationDraft = {};
let registrationCamera;
function stopRegistrationCamera() {
  registrationCamera?.stream.getTracks().forEach(track => track.stop());
  registrationCamera = undefined;
}
function registrationForm() {
  const location = registrationDraft.location;
  return authFrame(`<h1>${t('registrationEvidence')}</h1><p>${t('registrationPrivacy')}</p>
    <form class="form-stack" data-form="registration">
      <label>${t('nationalId')}<input name="nationalId" inputmode="numeric" dir="ltr" minlength="10" maxlength="10" value="${escape(registrationDraft.nationalId)}" required></label>
      <label>${t('registrationAddress')}<textarea name="address" minlength="10" maxlength="240" required>${escape(registrationDraft.address)}</textarea></label>
      <button type="button" class="button secondary" data-action="registration-location">${icon('map-pin')}${t('captureLocation')}</button>
      ${location ? `<p class="muted" role="status">${t('locationAccuracy')} <bdi>±${Math.round(location.accuracy)} m</bdi></p>` : ''}
      <div class="registration-images">${[['selfie', 'selfie'], ['identity', 'identityPhoto']].map(([kind, label]) => `<figure>
        ${registrationDraft[kind] ? `<img alt="${t(label)}" src="data:image/jpeg;base64,${registrationDraft[kind]}">` : ''}
        <button type="button" class="button secondary" data-action="registration-camera" data-photo="${kind}">${icon('camera')}${t(label)}</button>
      </figure>`).join('')}</div>
      <div class="registration-preview" hidden><video autoplay muted playsinline></video><div class="auth-links">
        <button class="button primary" type="button" data-action="registration-capture">${t('capturePhoto')}</button>
        <button class="button secondary" type="button" data-action="registration-cancel">${t('cancel')}</button>
      </div></div>
      <button class="button primary" type="submit">${t('submitRegistration')}</button>
    </form><button class="text-button auth-switch" data-action="logout">${t('logout')}</button>`);
}
async function activateRegistrationCamera(kind) {
  stopRegistrationCamera();
  const preview = app.querySelector('.registration-preview');
  if (!preview) return;
  const video = preview.querySelector('video');
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia || (kind === 'selfie' && !media.getSupportedConstraints().facingMode)) throw new Error('registration_camera_unavailable');
  let stream;
  try {
    stream = await media.getUserMedia({ audio: false, video: { facingMode: kind === 'selfie' ? { exact: 'user' } : { ideal: 'environment' } } });
  } catch {
    throw new Error('registration_camera_unavailable');
  }
  const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (!video.isConnected || (kind === 'selfie' && facing && facing !== 'user')) {
    stream.getTracks().forEach(track => track.stop());
    if (video.isConnected) throw new Error('registration_camera_unavailable');
    return;
  }
  stopRegistrationCamera();
  registrationCamera = { stream, video, kind };
  video.srcObject = stream;
  preview.hidden = false;
  preview.scrollIntoView({ block: 'nearest' });
}
function captureRegistrationPhoto() {
  const { video, kind } = registrationCamera || {};
  if (!video?.videoWidth) throw new Error('registration_camera_unavailable');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1440 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  registrationDraft[kind] = canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
  render();
}
async function captureRegistrationLocation() {
  if (!navigator.geolocation) throw new Error('invalid_location');
  const draft = registrationDraft;
  const { coords } = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 20_000,
  })).catch(() => { throw new Error('location_permission'); });
  if (draft !== registrationDraft) return;
  const { latitude, longitude, accuracy } = coords;
  if (accuracy > 50) throw new Error('invalid_location');
  registrationDraft.location = { latitude, longitude, accuracy };
  render();
}

function render() {
  stopRegistrationCamera();
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('brand') + ' | ' + t('platform');
  if (!state.ready) app.innerHTML = `<div class="boot-screen">${brand()}<span>${t('loading')}</span></div>`;
  else if (!state.user) app.innerHTML = auth();
  else if (state.user.approval !== 'approved') app.innerHTML = pending();
  else {
    const pages = { dashboard, services: catalog, 'services-admin': servicesAdmin, live: livePage, requests: requestsPage, users: usersPage, help: helpPage, settings: settingsPage };
    app.innerHTML = `<div class="shell">${sidebar()}${state.drawer ? '<button class="drawer-scrim" data-action="drawer" aria-label="' + t('close') + '"></button>' : ''}<div class="work-area">${header()}<div class="content">${pages[state.route]()}</div></div></div>`;
  }
  drawIcons();
  updateVerificationTimer();
}
function navigate(route, filter = 'all') {
  state.route = route;
  state.query = '';
  state.filter = filter;
  state.category = 'all';
  state.menu = '';
  state.drawer = false;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
async function refresh() {
  if (state.user?.approval !== 'approved') return;
  const identity = state.user.id;
  const hasMarket = specialist() && state.config.market;
  const [requests, events, users, marketProfile, live, services, adminServices] = await Promise.all([
    api('/requests'), api('/notifications'), admin() ? api('/admin/users') : [],
    hasMarket ? api('/market/profile') : null, hasMarket ? api('/market/live') : [],
    api('/services'), admin() ? api('/admin/services') : [],
  ]);
  if (state.user?.id !== identity) return;
  const changed = JSON.stringify([requests, events, users, marketProfile, live, services, adminServices]) !==
    JSON.stringify([state.requests, state.events, state.users, state.marketProfile, state.live, state.services, state.adminServices]);
  Object.assign(state, { requests, events, users, marketProfile, live, services, adminServices });
  return changed;
}

let detailVersion = '';
function openDialog(content, classes = '') {
  dialog.className = classes;
  delete dialog.dataset.live;
  delete dialog.dataset.request;
  dialog.innerHTML = content;
  const title = dialog.querySelector('.modal-heading h2');
  title.id = 'dialog-title';
  dialog.setAttribute('aria-labelledby', title.id);
  if (!dialog.open) dialog.showModal();
  drawIcons();
}
const modalHeading = (title, sub = '') => `<header class="modal-heading"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
  <button class="icon-button" data-action="close-dialog" aria-label="${t('close')}">${icon('x')}</button></header>`;
function attachInput() {
  return `<label class="file-label">${t('attachment')} <small>· ${t('optional')}</small>
    <input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg"><small>${t('attachmentHelp')}</small></label>`;
}
function requestForm(service = null) {
  const manual = !service;
  openDialog(`${modalHeading(manual ? t('manual') : escape(local(service.name)), manual ? t('manualIntro') : escape(local(service.description)))}
    ${!manual && local(service.documents) ? `<div class="document-hint">${icon('paperclip')}<div><strong>${t('serviceRequirement')}</strong><p>${escape(local(service.documents))}</p></div></div>` : ''}
    <p class="muted fine-print">${t('serviceTerms')}</p>
    <form class="form-stack" data-form="create" data-id="${service?.id || 'manual'}">
      ${manual ? `<label>${t('manualTitle')}<input name="title" maxlength="90" data-manual-title required></label>
      <div id="manual-suggestion" aria-live="polite" hidden></div>${selectedChoice('specialty', t('specialty'), specialtyOptions(), 'general')}` : ''}
      ${state.config.market ? `<div class="form-pair">${selectedChoice('city', t('city'), cityOptions(), state.user.city || '', t('chooseCity'))}
      ${selectedChoice('mode', t('dispatch'), modeOptions().filter(([key]) => key !== 'admin'), 'offers')}</div>
      ${selectedChoice('ranking', t('shortlistPolicy'), [['rating', t('higherRated')], ['distance', t('nearest')]], 'rating')}
      <label>${t('brief')} <small>· ${t('optional')}</small><textarea name="brief" maxlength="280" rows="2" placeholder="${t('briefHint')}"></textarea></label>` : ''}
      <label>${t('notes')}<textarea name="details" maxlength="2000" rows="3" placeholder="${t('notesHint')}" required></textarea></label>
      ${attachInput()}<div class="modal-actions"><button type="submit" class="button primary">${icon('send')}${t('submitRequest')}</button><button type="button" class="button secondary" data-action="close-dialog">${t('cancel')}</button></div>
    </form>`, 'request-form');
}
const transitions = {
  new: ['in_progress', 'needs_info', 'rejected'], in_progress: ['needs_info', 'completed', 'rejected'],
  needs_info: ['in_progress', 'completed', 'rejected'], completed: [], rejected: [],
};
async function openRequest(id) {
  const request = await api('/requests/' + id);
  const list = state.config.market && request.mode !== 'admin' && !request.agent_id && request.status === 'new'
    ? ['rejected'] : transitions[request.status];
  const agents = state.users.filter(user => user.role === 'agent' && user.approval === 'approved'
    && (!state.config.market || user.available || user.id === request.agent_id));
  openDialog(`${modalHeading(requestTitle(request), `<bdi>${requestNumber(request.id)}</bdi> · ${date(request.created)}`)}
    <div class="request-meta">${statusBadge(request.status)}<span>${icon('user-round')} ${t('specialist')} · <strong>${escape(request.agent_name ? displayName(request.agent_name) : t('unassigned'))}</strong></span></div>
    ${request.city ? `<p class="request-city">${icon('map-pin')}${local(cities[request.city]?.name)} · ${local(specialties[request.specialty])}</p>` : ''}
    <div id="request-live-info">${quoteMarkup(request)}${timelineMarkup(request)}</div>
    ${request.details ? `<section class="detail-notes"><h3>${t('details')}</h3><p>${escape(request.details)}</p></section>` : ''}
    ${request.attachment ? `<a class="attachment-link" href="/api/requests/${id}/attachment">${icon('download')}<span>${escape(request.attachment)}</span></a>` : ''}
    ${admin() && list.length ? `<form data-form="assign" data-id="${id}" class="inline-form"><select required name="agent" aria-label="${t('selectAgent')}"><option value="">${t('selectAgent')}</option>${agents.map(agent => `<option value="${agent.id}" ${request.agent_id === agent.id ? 'selected' : ''}>${escape(displayName(agent.name))}</option>`).join('')}</select><button class="button secondary">${t('assign')}</button></form>` : ''}
    ${admin() && state.config.market && request.status !== 'completed' ? `<form data-form="reopen" data-id="${id}" class="inline-form">
      <select required name="mode" aria-label="${t('chooseMode')}"><option value="">${t('chooseMode')}</option>
      ${modeOptions().map(([key, name]) => `<option value="${key}">${key === 'admin' ? t('unassign') : name}</option>`).join('')}</select>
      <button class="button secondary">${t('reopen')}</button></form>` : ''}
    ${!customer() && list.length ? `<form data-form="status" data-id="${id}" class="inline-form"><select required name="status" aria-label="${t('updateStatus')}"><option value="">${t('updateStatus')}</option>${list.map(status => `<option value="${status}">${local(statuses[status])}</option>`).join('')}</select><button class="button secondary">${t('save')}</button></form>` : ''}
    ${customer() && state.config.market && request.status === 'completed' && request.agent_id ? (request.rating ? `<p class="rating-summary">${icon('star')}${t('rated')} · ${request.rating}/5</p>` : `<form data-form="rate" data-id="${id}" class="inline-form">
      <select required name="score" aria-label="${t('rateService')}"><option value="">${t('rateService')}</option>${[5,4,3,2,1].map(score => `<option value="${score}">${score} / 5</option>`).join('')}</select><button class="button secondary">${t('save')}</button></form>`) : ''}
    <section class="thread"><h3>${t('messages')}</h3><div class="message-list ${request.messages.length ? 'has-messages' : ''}">${request.messages.length ? request.messages.map(message => `<div class="message ${state.user.id === message.user_id ? 'own' : ''}">
      <strong>${escape(displayName(message.name))}</strong><p>${escape(message.text)}</p></div>`).join('') : `<p class="muted">${t('messageEmpty')}</p>`}</div>
      <form data-form="message" data-id="${id}" class="message-form"><div class="inline-form"><input name="message" placeholder="${t('messagePlaceholder')}" aria-label="${t('messagePlaceholder')}" maxlength="1500" required><button class="button primary" aria-label="${t('send')}">${icon('send')}</button></div>
      ${customer() && list.length ? `<details class="message-attachment"><summary>${t('attachment')}</summary>${attachInput()}</details>` : ''}</form>
    </section>`, 'request-detail');
  dialog.dataset.request = id;
  detailVersion = detailState(request);
  const history = dialog.querySelector('.message-list');
  if (history) history.scrollTop = history.scrollHeight;
}
function assistantAction(action) {
  if (!action) return '';
  const [type, id] = action.split(':');
  if (type === 'request' && /^\d+$/.test(id)) return `<button class="text-link" data-request="${id}">${t('view')}${arrow()}</button>`;
  if (type === 'service' && byService(id)) return `<button class="text-link" data-service="${id}">${t('openService')}${arrow()}</button>`;
  if (type === 'manual' && customer()) return `<button class="text-link" data-action="manual">${t('manual')}${arrow()}</button>`;
  if (['services', 'requests'].includes(type) && (type !== 'services' || customer())) {
    return `<button class="text-link" data-chat-route="${type}">${t(type === 'services' ? 'openCatalog' : 'requests')}${arrow()}</button>`;
  }
  return '';
}
function openAssistant({ focus = false } = {}) {
  openDialog(`${modalHeading(t('assistant'), t(state.config.ai ? 'assistantModeAi' : 'assistantModeGuide'))}
    <div class="assistant-privacy"><p>${t('assistantNotice')}</p>
    ${state.chats.length ? `<button class="text-button" data-action="new-chat" ${state.assistantBusy ? 'disabled' : ''}>${t('newChat')}</button>` : ''}</div>
    <div class="assistant-history" role="log" aria-live="polite"><div class="assistant-bubble"><span class="tile-icon purple">${icon('sparkles')}</span><p>${t(customer() ? 'assistantIntro' : specialist() ? 'assistantIntroAgent' : 'assistantIntroAdmin')}</p></div>
      ${state.chats.map(chat => `<div class="${chat.mine ? 'question-bubble' : 'assistant-bubble'}">${chat.mine ? '' : `<span class="tile-icon purple">${icon('sparkles')}</span>`}
      <div class="assistant-turn"><p>${escape(chat.text)}</p>${assistantAction(chat.action)}</div></div>`).join('')}
      ${state.assistantBusy ? `<div class="assistant-bubble assistant-typing"><span class="tile-icon purple">${icon('sparkles')}</span><p>${t('assistantThinking')}</p></div>` : ''}
    </div>
    ${state.chats.length ? '' : `<div class="chips suggested">${(customer() ? ['askTrack', 'askManual'] : ['askTrack']).map(key => `<button class="chip" data-ask="${key}">${t(key)}</button>`).join('')}</div>`}
    <form data-form="assistant" class="inline-form"><input name="question" maxlength="400" placeholder="${t('assistantPlaceholder')}" aria-label="${t('assistantPlaceholder')}" required><button class="button primary" aria-label="${t('send')}" ${state.assistantBusy ? 'disabled' : ''}>${icon('send')}</button></form>`, 'assistant-modal');
  const history = dialog.querySelector('.assistant-history');
  history.scrollTop = history.scrollHeight;
  if (focus) dialog.querySelector('input[name="question"]').focus({ preventScroll: true });
}
async function ask(question) {
  question = question.trim();
  if (state.assistantBusy || !question) return;
  const account = state.user.id;
  const identity = state.chats;
  const history = state.chats.slice(-6).map(chat => ({ role: chat.mine ? 'user' : 'assistant', content: chat.text }));
  state.chats.push({ mine: true, text: question });
  state.assistantBusy = true;
  openAssistant();
  try {
    const result = await api('/assistant', 'POST', { question, history, lang: state.lang });
    if (state.user?.id === account && state.chats === identity) state.chats.push({ mine: false, text: result.answer, action: result.action });
  } catch (error) {
    if (state.user?.id === account && state.chats === identity) report(error);
  } finally {
    if (state.user?.id === account && state.chats === identity) {
      state.assistantBusy = false;
      if (dialog.open && dialog.classList.contains('assistant-modal')) openAssistant({ focus: true });
    }
  }
}

let firebaseCaptchaVisible = false;
function updateVerificationTimer() {
  const now = Date.now();
  const remaining = Math.max(0, Math.ceil(((state.login.expiresAt || 0) - now) / 1000));
  const locked = Math.max(0, Math.ceil(((state.login.retryAt || 0) - now) / 1000));
  const format = seconds => String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  const timer = app.querySelector('[data-verification-time]');
  if (timer) timer.textContent = remaining ? format(remaining) : t('verification_expired');
  const lock = app.querySelector('[data-verification-lock]');
  if (lock) {
    lock.hidden = !locked;
    if (locked) lock.textContent = t('verification_locked') + ' ' + format(locked);
  }
  for (const button of app.querySelectorAll('[data-form="verify"] button[type="submit"], [data-action="resend"]')) {
    const resend = button.dataset.action === 'resend';
    button.disabled = !!(button.dataset.waiting || locked || (resend ? now < (state.login.resend || 0) : !remaining));
  }
}
function firebaseError(error) {
  const codes = {
    'auth/invalid-phone-number': 'invalid_phone',
    'auth/invalid-verification-code': 'invalid_code',
    'auth/code-expired': 'invalid_code',
    'auth/too-many-requests': 'rate_limited',
    'auth/quota-exceeded': 'rate_limited',
    'auth/operation-not-allowed': 'firebasePhoneDisabled',
    'auth/billing-not-enabled': 'firebaseBilling',
    'auth/unauthorized-domain': 'firebaseDomain',
    'auth/unauthorized-continue-uri': 'firebaseDomain',
    'auth/app-not-authorized': 'firebaseApp',
    'auth/invalid-api-key': 'firebaseApp',
    'auth/invalid-app-credential': 'firebaseCaptcha',
    'auth/captcha-check-failed': 'firebaseCaptcha',
    'auth/network-request-failed': 'firebaseNetwork',
  };
  const reason = /sms region policy/i.test(error?.message) ? 'firebaseRegion' : codes[error?.code];
  const result = new Error(reason || 'sms_unavailable');
  if (/^auth\/[a-z0-9-]{2,80}$/.test(error?.code)) result.providerCode = error.code;
  return result;
}
async function sendCode(phone) {
  let result;
  if (state.config.firebase) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error('invalid_phone');
    try {
      const { requestFirebaseCode } = await import('/assets/firebase-auth.js?v=3');
      await api('/auth/check', 'POST', { phone: normalized });
      const session = await requestFirebaseCode(
        state.config.firebase, normalized, state.lang, document.querySelector('#firebase-recaptcha'),
        { visible: firebaseCaptchaVisible },
      );
      firebaseCaptchaVisible = false;
      result = await api('/auth/challenge', 'POST', { phone: normalized, session });
    } catch (error) {
      if (copy[error.message]) throw error;
      const failure = firebaseError(error);
      if (failure.message === 'firebaseCaptcha') firebaseCaptchaVisible = true;
      throw failure;
    }
  } else {
    result = await api('/auth/send', 'POST', { phone });
  }
  Object.assign(state.login, result, {
    expiresAt: Date.now() + (result.expiresAt - result.serverTime), resend: Date.now() + 55000,
    retryAt: 0, editPhone: false,
  });
  state.authStep = 'code';
  render();
}
async function readAttachment(form) {
  const file = form.elements.attachment?.files[0];
  if (!file) return undefined;
  if (file.size > 5 * 1024 * 1024) throw new Error('too_large');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('invalid_file'));
    reader.readAsDataURL(file);
  });
  return { name: file.name, data: dataUrl.split(',')[1] };
}
function translatedDigits(value) {
  return value.replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) % 16));
}
async function sessionCheck() {
  const { user } = await api('/me');
  if (!user) {
    Object.assign(state, {
      user: null, chats: [], assistantBusy: false, route: 'dashboard', menu: '',
      login: {}, authMode: 'login', authStep: 'phone',
    });
    render();
    return;
  }
  state.user = user;
  await refresh();
  render();
}

function detailState(request) {
  return JSON.stringify([request.status, request.agent_id, request.offers, request.history]);
}
function refreshResults() {
  if (!document.activeElement?.matches('input, select, textarea') ||
      (state.route === 'live' && Boolean(document.querySelector('.live-filter-panel')) !== Boolean(state.live.length))) {
    render();
    return;
  }
  const results = {
    live: ['#live-results', liveResults], requests: ['#results', requestResults], users: ['#user-results', userResults],
  }[state.route];
  if (!results) return;
  const [selector, markup] = results;
  const container = document.querySelector(selector);
  if (container) container.innerHTML = markup();
  drawIcons();
}
let marketBusy = false;
let refreshingPage = false;
async function refreshVisiblePage() {
  if (refreshingPage || marketBusy || !state.user || document.hidden || state.drawer || state.menu) return;
  refreshingPage = true;
  try {
    if (state.user.approval !== 'approved') {
      const { user } = await api('/me');
      if (user?.id === state.user?.id && user.approval !== state.user.approval) {
        state.user = user;
        await refresh();
        render();
      }
      return;
    }
    if (dialog.open && dialog.dataset.live) {
      const id = Number(dialog.dataset.live);
      const live = await api('/market/live');
      if (!marketBusy && Number(dialog.dataset.live) === id && !live.some(row => row.id === id)) {
        dialog.close();
        await refresh();
        render();
        flash(t('market_unavailable'), true);
      }
      return;
    }
    if (dialog.open && dialog.dataset.request && state.config.market) {
      const id = dialog.dataset.request;
      const request = await api('/requests/' + id);
      if (marketBusy || dialog.dataset.request !== id || !dialog.open || detailVersion === detailState(request)) return;
      const content = dialog.querySelector('#request-live-info');
      if (content) content.innerHTML = quoteMarkup(request) + timelineMarkup(request);
      const badge = dialog.querySelector('.request-meta .status-pill');
      if (badge) badge.outerHTML = statusBadge(request.status);
      const agent = dialog.querySelector('.request-meta strong');
      if (agent) agent.textContent = request.agent_name ? displayName(request.agent_name) : t('unassigned');
      detailVersion = detailState(request);
      drawIcons();
      return;
    }
    if (!dialog.open && await refresh()) refreshResults();
  } catch (error) {
    if (error.message === 'approval_required' || error.message === 'unauthorized') {
      if (dialog.open) dialog.close();
      await sessionCheck();
    } else if (error.message === 'not_found' && dialog.open && dialog.dataset.request) {
      dialog.close();
      await refresh();
      render();
    } else {
      throw error;
    }
  } finally {
    refreshingPage = false;
  }
}
setInterval(() => { refreshVisiblePage().catch(() => {}); }, 4500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVisiblePage().catch(() => {}); });

async function submitMarket(id, action, payload = {}) {
  marketBusy = true;
  try {
    await api('/market/' + id + '/' + action, 'POST', payload);
    await refresh();
    if (action === 'claim') {
      dialog.close();
      navigate('requests');
      await openRequest(id);
    } else if (['choose', 'rate'].includes(action)) {
      render();
      await openRequest(id);
    } else {
      dialog.close();
      render();
    }
    flash(t(action === 'offer' ? 'offered' : action === 'rate' ? 'rated' : 'saved'));
  } catch (error) {
    if (['market_unavailable', 'agent_unavailable'].includes(error.message)) {
      await refresh();
      render();
      if (dialog.dataset.live && !state.live.some(row => row.id === Number(id))) dialog.close();
      if (action === 'choose' && dialog.open) await openRequest(id);
    }
    throw error;
  } finally {
    marketBusy = false;
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) {
    if (state.menu && !event.target.closest('.menu-wrap')) { state.menu = ''; render(); }
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
    return;
  }
  const { action, route, stat, category, request, service, userfilter, user, approval, live, manage, market, id, offer, suggest, ask: question } = target.dataset;
  try {
    if (route) {
      navigate(route);
      return await refreshVisiblePage();
    }
    if (stat) return navigate('requests', stat);
    if (category) { state.category = category; return render(); }
    if (userfilter) { state.userFilter = userfilter; return render(); }
    if (live) return openLive(live);
    if (manage) return await manageUser(manage);
    if (target.dataset.editService) return serviceEditor(target.dataset.editService);
    if (target.dataset.chatRoute) {
      dialog.close();
      return navigate(target.dataset.chatRoute);
    }
    if (suggest) {
      dialog.querySelector('select[name="specialty"]').value = suggest;
      return;
    }
    if (market) {
      target.disabled = true;
      try { return await submitMarket(id, market, offer ? { offer_id: Number(offer) } : {}); }
      finally { target.disabled = false; }
    }
    if (request) {
      if (state.menu) { state.menu = ''; render(); }
      return await openRequest(request);
    }
    if (service) {
      const selected = byService(service);
      if (!selected) throw new Error('not_found');
      return requestForm(selected);
    }
    if (question) return await ask(t(question));
    if (approval) {
      target.disabled = true;
      try {
        await api('/admin/users/' + user, 'PATCH', { approval });
        await refresh();
        render();
        flash(t('saved'));
      } finally { target.disabled = false; }
      return;
    }
    if (!action) return;
    if (action === 'install') {
      if (installPrompt) { const prompt = installPrompt; installPrompt = undefined; await prompt.prompt(); }
      else openDialog(`${modalHeading(t('installApp'), t('installHelp'))}`);
      return;
    }
    if (action === 'registration-camera' || action === 'registration-location') {
      target.disabled = true;
      try {
        if (action === 'registration-camera') await activateRegistrationCamera(target.dataset.photo);
        else await captureRegistrationLocation();
      } finally { target.disabled = false; }
      return;
    }
    if (action === 'registration-capture') return captureRegistrationPhoto();
    if (action === 'registration-cancel') return render();
    if (action === 'language') {
      state.lang = state.lang === 'ar' ? 'en' : 'ar';
      localStorage.setItem('waslah-language', state.lang);
      return render();
    }
    if (action === 'drawer') { state.drawer = !state.drawer; return render(); }
    if (action === 'close-dialog') return dialog.close();
    if (action === 'assistant') return openAssistant({ focus: true });
    if (action === 'new-chat') {
      state.chats = [];
      return openAssistant({ focus: true });
    }
    if (action === 'review-accounts') {
      state.userFilter = 'pending';
      state.userQuery = '';
      state.userRole = 'all';
      return navigate('users');
    }
    if (action === 'review-dispatch') return navigate('requests', 'unassigned');
    if (action === 'review-services') return navigate('services-admin');
    if (action === 'create-service') return serviceEditor();
    if (action === 'manual') return requestForm();
    if (action === 'availability') return availabilityForm();
    if (action === 'profile' || action === 'notifications') {
      const menu = state.menu === action ? '' : action;
      if (menu === 'notifications') state.events = await api('/notifications');
      state.menu = menu;
      return render();
    }
    if (action === 'read') {
      await api('/notifications', 'POST', {});
      state.events = await api('/notifications');
      return render();
    }
    if (action === 'logout') {
      await api('/auth/logout', 'POST', {});
      registrationDraft = {};
      Object.assign(state, { user: null, login: {}, authStep: 'phone', authMode: 'login', menu: '', route: 'dashboard', chats: [], assistantBusy: false });
      if (dialog.open) dialog.close();
      return render();
    }
    if (action === 'auth-switch') { state.authMode = state.authMode === 'login' ? 'signup' : 'login'; return render(); }
    if (action === 'change-phone') { state.login.editPhone = !state.login.editPhone; return render(); }
    if (action === 'check-approval' || action === 'resend') {
      target.dataset.waiting = '1';
      target.disabled = true;
      try {
        if (action === 'check-approval') await sessionCheck();
        else {
          showAuthError();
          try { await sendCode(state.login.phone); }
          catch (error) { showAuthError(error); }
        }
      } finally { delete target.dataset.waiting; target.disabled = false; updateVerificationTimer(); }
    }
  } catch (error) { report(error); }
});
document.addEventListener('input', event => {
  if (event.target.form?.dataset.form === 'registration' && ['nationalId', 'address'].includes(event.target.name)) {
    registrationDraft[event.target.name] = event.target.value;
  }
  if (event.target.matches('[data-user-search]')) {
    state.userQuery = event.target.value;
    document.querySelector('#user-results').innerHTML = userResults();
    drawIcons();
    return;
  }
  if (event.target.matches('[data-manual-title]')) {
    const inferred = suggestedSpecialty(event.target.value);
    const suggestion = document.querySelector('#manual-suggestion');
    suggestion.hidden = inferred === 'general';
    if (suggestion.hidden || suggestion.dataset.current === inferred) return;
    suggestion.dataset.current = inferred;
    suggestion.innerHTML = `<div class="manual-suggestion"><span>${icon('sparkles')}${t('suggestion')} · <strong>${local(specialties[inferred])}</strong></span>
      <button type="button" class="text-button" data-suggest="${inferred}">${t('useSuggestion')}</button></div>`;
    drawIcons();
    return;
  }
  if (event.target.matches('[data-search]')) {
    state.query = event.target.value;
    const results = document.querySelector('#results');
    results.innerHTML = state.route === 'services' ? serviceResults() : requestResults();
    drawIcons();
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'user-role-filter') {
    state.userRole = event.target.value;
    document.querySelector('#user-results').innerHTML = userResults();
    drawIcons();
  }
  if (event.target.closest('.market-filters')) {
    state.liveFilters[event.target.name] = event.target.value;
    document.querySelector('#live-results').innerHTML = liveResults();
    drawIcons();
  }
  if (event.target.id === 'request-filter') {
    state.filter = event.target.value;
    document.querySelector('#results').innerHTML = requestResults();
    drawIcons();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !dialog.open && (state.menu || state.drawer)) {
    state.menu = '';
    state.drawer = false;
    render();
  }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  const mode = form.dataset.form;
  if (!mode) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"], .inline-form button, button');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.dataset.waiting = '1'; }
  const data = new FormData(form);
  const id = form.dataset.id;
  const authForm = ['phone', 'verify', 'edit-phone'].includes(mode);
  if (authForm) showAuthError();
  try {
    if (mode === 'phone') {
      const signup = state.authMode === 'signup';
      const name = signup ? registrationName(data.get('name')) : '';
      if (signup && !name) throw new Error('invalid_registration_name');
      Object.assign(state.login, { name, role: signup ? data.get('role') : null });
      await sendCode(data.get('phone'));
    } else if (mode === 'edit-phone') {
      await sendCode(data.get('phone'));
    } else if (mode === 'verify') {
      const code = translatedDigits(String(data.get('code')).trim());
      const { phone, challenge, name, role } = state.login;
      state.user = await api('/auth/verify', 'POST', { phone, challenge, name, role, code });
      state.route = 'dashboard';
      state.login = {};
      state.authMode = 'login';
      state.authStep = 'phone';
      await refresh();
      render();
    } else if (mode === 'registration') {
      state.user = await api('/registration', 'POST', {
        ...registrationDraft, nationalId: translatedDigits(String(data.get('nationalId')).trim()), address: String(data.get('address')).trim(),
      });
      registrationDraft = {};
      render();
    } else if (mode === 'create') {
      const result = await api('/requests', 'POST', {
        service: id, title: data.get('title'), specialty: data.get('specialty'), city: data.get('city'),
        mode: data.get('mode') || undefined, ranking: data.get('ranking') || undefined, brief: data.get('brief'),
        details: data.get('details'), file: await readAttachment(form),
      });
      dialog.close();
      await refresh();
      navigate('requests');
      await openRequest(result.id);
      flash(t('created'));
    } else if (mode === 'message') {
      await api('/requests/' + id + '/messages', 'POST', { text: data.get('message'), file: await readAttachment(form) });
      await openRequest(id);
    } else if (mode === 'offer') {
      await submitMarket(id, 'offer', { amount: Number(data.get('amount')), days: Number(data.get('days')), note: data.get('note') });
    } else if (mode === 'rate') {
      await submitMarket(id, 'rate', { score: Number(data.get('score')) });
    } else if (mode === 'profile-details') {
      const result = await api('/me', 'PATCH', { name: data.get('name'), city: data.get('city') === 'none' ? null : data.get('city') });
      state.user = result.user;
      await refresh();
      render();
      flash(t('profileSaved'));
    } else if (mode === 'edit-service') {
      const payload = { ...Object.fromEntries(data), active: data.has('active') };
      await api('/admin/services' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', payload);
      dialog.close();
      await refresh();
      render();
      flash(t('saved'));
    } else if (mode === 'availability' || mode === 'manage-user') {
      const payload = { city: data.get('city') === 'none' ? null : data.get('city') };
      if (mode === 'availability' || form.dataset.agent === 'true') {
        if (data.get('pause') !== 'keep') payload.pause = Number(data.get('pause'));
      }
      if (mode === 'manage-user') {
        payload.registrationReviewed = data.get('registrationReviewed') === 'on';
        payload.name = data.get('name');
        if (form.dataset.agent === 'true') payload.specialties = data.getAll('specialty');
        if (data.get('approval') !== 'keep') payload.approval = data.get('approval');
      }
      await api(mode === 'availability' ? '/market/profile' : '/admin/users/' + id, 'PATCH', payload);
      dialog.close();
      await refresh();
      render();
      flash(t('saved'));
    } else if (['assign', 'status', 'reopen'].includes(mode)) {
      const payload = mode === 'assign' ? { agent_id: Number(data.get('agent')) }
        : mode === 'reopen' ? { reopen: data.get('mode') } : { status: data.get('status') };
      await api('/requests/' + id, 'PATCH', payload);
      await refresh();
      render();
      await openRequest(id);
      flash(t('saved'));
    } else if (mode === 'assistant') await ask(String(data.get('question')));
  } catch (error) {
    if (authForm) showAuthError(error);
    else report(error);
  }
  finally { if (button) { delete button.dataset.waiting; button.disabled = false; } updateVerificationTimer(); }
});

setInterval(updateVerificationTimer, 250);
render();
try {
  const [config, { user }] = await Promise.all([api('/config'), api('/me')]);
  Object.assign(state, { config, user });
  await refresh();
} catch (error) {
  report(error);
} finally {
  state.ready = true;
  render();
}
