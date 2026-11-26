import { assetList } from './generated-assets'

export function serveAsset(request: Request) {
  const {pathname} = new URL(request.url)
  const assetPath = pathname === '/admin' || pathname === '/admin/' ? '/' : pathname
  const entry = assetList[assetPath]
  if (!entry) return new Response('Not found',{status:404})
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}})
  const [type, data] = entry
  const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(data), c => c.charCodeAt(0))
  return new Response(bytes,{headers:{
    'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
    'Cache-Control':assetPath === '/' || ['/sw.js','/manifest.webmanifest','/app-version.json'].includes(pathname) ? 'no-store' : 'public, max-age=3600',
  }})
}
