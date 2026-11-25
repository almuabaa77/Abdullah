const version = '__BUILD_VERSION__'
const cacheName = 'halaqat-' + version
const precache = '__PRECACHE_FILES__'
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(precache)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('halaqat-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const {request} = event, url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return
  if (request.mode === 'navigate') {
    if (url.pathname !== '/') return
    event.respondWith(fetch(request).catch(() => caches.match('/')))
  } else if (precache.includes(url.pathname)) event.respondWith(caches.open(cacheName).then(cache => cache.match(request)).then(entry => entry || fetch(request)))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
    const tab = clients.find(client => new URL(client.url).pathname === '/')
    return tab ? tab.focus() : self.clients.openWindow('/')
  }))
})
