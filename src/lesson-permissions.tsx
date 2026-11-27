import { useCallback, useEffect, useState } from 'react'
import { Camera, Mic } from 'lucide-react'
import type { Tr } from './ui'
import { useWorkspace } from './ui'

export type CallDevice = 'audio'|'video'
type DeviceState = PermissionState|'unknown'|'missing'|'busy'|'unsupported'
type Snapshot = Record<CallDevice,DeviceState>
const names={audio:'microphone',video:'camera'} as const

function errorState(error:unknown):DeviceState {
  const failure=error as {name?:string;code?:string|number}|undefined
  const code=typeof failure?.code==='string'?failure.code:failure?.name
  switch(code) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'PERMISSION_DENIED': case 'SecurityError': return 'denied'
    case 'NotFoundError': case 'DEVICE_NOT_FOUND': case 'NotFound': return 'missing'
    case 'NotReadableError': case 'TrackStartError': case 'NOT_READABLE': case 'DEVICE_BUSY': return 'busy'
    case 'NotSupportedError': case 'NOT_SUPPORTED': return 'unsupported'
    default:return 'unknown'
  }
}
export function callDeviceError(error:unknown,kind:CallDevice,t:Tr) {
  const state=errorState(error)
  if(state==='denied')return kind==='audio'
    ?t('إذن الميكروفون محظور. اسمح به في إعدادات الموقع في المتصفح ثم أعد المحاولة.','Microphone access is blocked. Allow it in the browser’s site settings, then try again.')
    :t('إذن الكاميرا محظور. اسمح به في إعدادات الموقع في المتصفح ثم أعد المحاولة.','Camera access is blocked. Allow it in the browser’s site settings, then try again.')
  if(state==='missing')return kind==='audio'?t('لم يُعثر على ميكروفون. وصّل جهازًا أو اختر ميكروفونًا آخر.','No microphone found. Connect a device or select another microphone.')
    :t('لم يُعثر على كاميرا. وصّل جهازًا أو اختر كاميرا أخرى.','No camera found. Connect a device or select another camera.')
  if(state==='busy')return t('تعذر تشغيل الجهاز. أغلق أي تطبيق آخر يستخدمه ثم أعد المحاولة.','The device could not start. Close other apps using it and try again.')
  if(state==='unsupported'||!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
    return t('افتح المنصة عبر HTTPS في متصفح يدعم الكاميرا والميكروفون.','Open this site over HTTPS in a browser that supports camera and microphone access.')
  return t('تعذر تشغيل الجهاز. راجع الإذن والجهاز المحدد ثم جرّب مرة أخرى.','Could not start the device. Check its permission and selection, then try again.')
}

export function useCallDevicePermissions(videoAllowed:boolean,enabled=true) {
  const [permissions,setPermissions]=useState<Snapshot>({audio:'unknown',video:'unknown'})
  const report=useCallback((kind:CallDevice,granted:boolean,error?:unknown)=>{
    const state=granted?'granted':errorState(error)
    if(state!=='unknown')setPermissions(value=>value[kind]===state?value:{...value,[kind]:state})
  },[])
  useEffect(()=>{
    if(!enabled)return
    const kinds:CallDevice[]=videoAllowed?['audio','video']:['audio']
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia) {
      setPermissions(value=>({...value,audio:'unsupported',...(videoAllowed?{video:'unsupported'}:{})}))
      return
    }
    let active=true
    let revision=0
    let clean:(()=>void)[]=[]
    const refresh=async ()=>{
      if(!navigator.permissions?.query)return
      const current=++revision
      const probes=await Promise.all(kinds.map(async kind=>{
        try{return {kind,status:await navigator.permissions.query({name:names[kind] as PermissionName})}}
        catch{return undefined}
      }))
      if(!active||current!==revision)return
      clean.forEach(dispose=>dispose())
      clean=[]
      for(const probe of probes) {
        if(!probe)continue
        const {kind,status}=probe
        const update=()=>setPermissions(value=>{
          // Browser permission alone cannot tell whether an attached device is usable.
          if(status.state==='granted'&&['missing','busy'].includes(value[kind]))return value
          return value[kind]===status.state?value:{...value,[kind]:status.state}
        })
        update()
        status.addEventListener?.('change',update)
        clean.push(()=>status.removeEventListener?.('change',update))
      }
    }
    const onDevicesChanged=()=>{
      setPermissions(value=>Object.fromEntries(Object.entries(value).map(([kind,state])=>[kind,state==='missing'||state==='busy'?'unknown':state])) as Snapshot)
      void refresh()
    }
    void refresh()
    window.addEventListener('focus',refresh)
    navigator.mediaDevices.addEventListener?.('devicechange',onDevicesChanged)
    return ()=>{
      active=false
      clean.forEach(dispose=>dispose())
      window.removeEventListener('focus',refresh)
      navigator.mediaDevices?.removeEventListener?.('devicechange',onDevicesChanged)
    }
  },[videoAllowed,enabled])
  return {permissions,report}
}

export function CallPermissionStatus({permissions,videoAllowed}:{permissions:Snapshot;videoAllowed:boolean}) {
  const {t}=useWorkspace()
  const text:Record<DeviceState,string>={
    granted:t('مسموح','Allowed'),prompt:t('يلزم الإذن','Permission needed'),unknown:t('يُفحص عند الاستخدام','Checked when used'),
    denied:t('محظور','Blocked'),missing:t('الجهاز غير متاح','Device unavailable'),busy:t('الجهاز مشغول','Device busy'),unsupported:t('غير مدعوم','Unsupported'),
  }
  return <div className="call-device-permissions" aria-live="polite">
    <span data-state={permissions.audio}><Mic size={15}/><strong>{t('الميكروفون','Microphone')}</strong> · {text[permissions.audio]}</span>
    {videoAllowed&&<span data-state={permissions.video}><Camera size={15}/><strong>{t('الكاميرا','Camera')}</strong> · {text[permissions.video]}</span>}
  </div>
}
