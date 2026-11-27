const version = '__BUILD_VERSION__'
const cacheName = 'halaqat-' + version
const cacheable = '__CACHEABLE_FILES__'
const shell = ['/', ...cacheable.filter(path=>/\/index-[^/]+\.(js|css)$/.test(path))]

async function installShell() {
  const cache = await caches.open(cacheName)
  await cache.addAll(shell.map(path=>new Request(path,{cache:'reload'})))
  const page = await cache.match('/')
  if (!page || !(await page.text()).includes(`name="app-version" content="${version}"`)) {
    await caches.delete(cacheName)
    throw new Error('App shell version does not match its service worker')
  }
  await self.skipWaiting()
}
self.addEventListener('install', event => {
  event.waitUntil(installShell())
})
self.addEventListener('activate', event => {
  // Keep the last release available for tabs that are still using its lazy-loaded modules.
  event.waitUntil(caches.keys().then(keys=>{
    const previous = keys.filter(key=>key.startsWith('halaqat-') && key!==cacheName)
    return Promise.all(previous.slice(0,-1).map(key=>caches.delete(key)))
  }).then(()=>self.clients.claim()))
})

async function navigation(request) {
  let response
  try {
    response = await fetch(request,{cache:'no-store'})
    if (response.status<500) return response
  } catch { /* Use the installed shell while offline. */ }
  const cached = await caches.match('/',{cacheName}).catch(()=>undefined)
  return cached || response || Response.error()
}

async function asset(request, path) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  if (!cacheable.includes(path)) {
    for (const key of await caches.keys()) {
      if (key===cacheName || !key.startsWith('halaqat-')) continue
      const previous = await (await caches.open(key)).match(request)
      if (previous) return previous
    }
    return fetch(request)
  }
  const response = await fetch(request)
  if (response.ok) await cache.put(request,response.clone()).catch(()=>{})
  return response
}

self.addEventListener('fetch', event => {
  const {request} = event, url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return
  if (request.mode === 'navigate') {
    if (!['/', '/admin', '/admin/'].includes(url.pathname)) return
    event.respondWith(navigation(request))
  } else if (cacheable.includes(url.pathname) || /^\/assets\/[^/]+\.(js|css)$/.test(url.pathname)) {
    event.respondWith(asset(request,url.pathname))
  }
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  let target=new URL('/',self.location.origin)
  try {
    const candidate=new URL(event.notification.data?.url || '/',self.location.origin)
    if(candidate.origin===target.origin&&['/','/admin'].includes(candidate.pathname))target=candidate
  } catch { /* Open the homepage if a link is invalid. */ }
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
    const tab=clients.find(client=>client.url===target.href)
    return tab?tab.focus():self.clients.openWindow(target.href)
  }))
})

self.addEventListener('push', event => {
  let payload
  try {payload=event.data?.json() ?? {}} catch {payload={}}
  if(!payload||typeof payload!=='object')payload={}
  const title=typeof payload.title==='string'?payload.title.slice(0,90):'حلقات جامع الخير'
  const body=typeof payload.body==='string'?payload.body.slice(0,200):'لديك تحديث جديد في التطبيق.'
  event.waitUntil(self.registration.showNotification(title,{
    body,icon:'/assets/icon-192.png',badge:'/assets/icon-64.png',
    tag:typeof payload.tag==='string'?payload.tag.slice(0,50):undefined,
    data:{url:typeof payload.url==='string'?payload.url:'/'},
  }))
})
