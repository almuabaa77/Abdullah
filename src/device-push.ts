type PushAction = 'subscribe'|'unsubscribe'|'status'|'test'

export function supportsDevicePush() {
  return isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window
}

async function registration() {
  const ready=navigator.serviceWorker.ready
  let timer:number|undefined
  try {
    return await Promise.race([
      ready,
      new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error('Service worker unavailable')),8000)}),
    ])
  } finally {window.clearTimeout(timer)}
}

async function pushRequest(token:string,action?:PushAction,body:Record<string,unknown>={}) {
  const response=await fetch('/api/push',{
    method:action?'POST':'GET',
    headers:{Authorization:'Bearer '+token,...(action?{'Content-Type':'application/json'}:{})},
    body:action?JSON.stringify({...body,action}):undefined,
    cache:'no-store',
    signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(6000):undefined,
  })
  if(!response.ok) {
    const detail=await response.json().catch(()=>({}))
    throw new Error(detail.error || 'Notifications are unavailable')
  }
  return response.status===204?{}:response.json()
}

export async function devicePushStatus(token:string) {
  if(!supportsDevicePush()||Notification.permission!=='granted')return false
  const current=await navigator.serviceWorker.getRegistration()
  const subscription=await current?.pushManager.getSubscription()
  if(!subscription)return false
  return (await pushRequest(token,'status',{endpoint:subscription.endpoint})).enabled===true
}

export async function enableDevicePush(token:string,en:boolean) {
  if(!supportsDevicePush())return false
  const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission()
  if(permission!=='granted')return false
  const [{publicKey},worker]=await Promise.all([pushRequest(token),registration()])
  const bytes=Uint8Array.from(atob(String(publicKey).replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))
  let subscription=await worker.pushManager.getSubscription()
  const old=subscription?.options.applicationServerKey
  if(old&&!new Uint8Array(old).every((byte,index)=>byte===bytes[index])) {
    await subscription!.unsubscribe()
    subscription=null
  }
  subscription??=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes})
  await pushRequest(token,'subscribe',{subscription:subscription.toJSON(),language:en?'en':'ar'})
  return true
}

export async function disableDevicePush(token:string) {
  if(!supportsDevicePush())return
  const worker=await navigator.serviceWorker.getRegistration()
  const subscription=await worker?.pushManager.getSubscription()
  if(!subscription)return
  try {await pushRequest(token,'unsubscribe',{endpoint:subscription.endpoint})}
  finally {await subscription.unsubscribe().catch(()=>{})}
}

export async function sendDeviceTest(token:string) {
  const worker=await navigator.serviceWorker.getRegistration()
  const subscription=await worker?.pushManager.getSubscription()
  if(!subscription)throw new Error('Subscribe first')
  await pushRequest(token,'test',{endpoint:subscription.endpoint})
}
