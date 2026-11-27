const releasePattern = /^[0-9a-f]{12}$/
const release = () => document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content

export function watchAppUpdates(onUpdate: (version:string|undefined)=>void) {
  const current = release()
  if (!current || !releasePattern.test(current)) return ()=>{}
  const controller = new AbortController()
  const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined
  let registration:ServiceWorkerRegistration|undefined
  let checking = false
  let lastWorkerCheck = 0
  void worker?.register('/sw.js',{updateViaCache:'none'}).then(result=>{registration=result}).catch(()=>{})

  async function check() {
    if (checking || document.hidden || !navigator.onLine) return
    checking = true
    if (registration && Date.now()-lastWorkerCheck>10000) {
      lastWorkerCheck = Date.now()
      void registration.update().catch(()=>{})
    }
    try {
      const response = await fetch('/app-version.json',{cache:'no-store',signal:controller.signal})
      if (!response.ok) return
      const {version} = await response.json() as {version?:string}
      if (!controller.signal.aborted && typeof version==='string' && releasePattern.test(version)) onUpdate(version===current?undefined:version)
    } catch { /* A network interruption should not interrupt the current session. */ }
    finally { checking = false }
  }

  const timer = window.setInterval(check,45000)
  const events = ['pageshow','focus','online'] as const
  for (const event of events) window.addEventListener(event,check)
  document.addEventListener('visibilitychange',check)
  worker?.addEventListener('controllerchange',check)
  void check()
  return ()=>{
    controller.abort()
    window.clearInterval(timer)
    for (const event of events) window.removeEventListener(event,check)
    document.removeEventListener('visibilitychange',check)
    worker?.removeEventListener('controllerchange',check)
  }
}

export function applyAppUpdate(version: string, automatic = false) {
  const url = new URL(location.href)
  // An edge cache can briefly return the old shell. Prevent repeated automatic reloads.
  if (automatic && url.searchParams.get('v')===version) return
  url.searchParams.set('v',version)
  location.replace(url)
}

export async function refreshApp() {
  if(!navigator.onLine)throw new Error('Offline')
  if('serviceWorker' in navigator){
    void navigator.serviceWorker.getRegistration().then(worker=>worker?.update()).catch(()=>{})
  }
  const stamp=Date.now().toString()
  const response=await fetch('/app-version.json?_='+stamp,{cache:'no-store',signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(10_000):undefined})
  if(!response.ok)throw new Error('Could not check the current release')
  const {version}=await response.json() as {version?:string}
  if(typeof version!=='string'||!releasePattern.test(version))throw new Error('Invalid app version')
  const url=new URL(location.href)
  url.searchParams.set('v',version)
  url.searchParams.set('reload',stamp)
  location.replace(url)
}
