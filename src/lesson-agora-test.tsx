import { useEffect, useState } from 'react'
import { AudioLines, Copy, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'
import { CallPermissionStatus } from './lesson-permissions'
import { CallVideo, useAgoraRtc, type CallDevices } from './lesson-rtc'
import { Modal, useWorkspace } from './ui'

const roomLifetime=10*60*1000
const devices:CallDevices={micId:'',cameraId:'',speakerId:''}
const parameter='agoraTest'

function newRoom() {
  const nonce=crypto.randomUUID().replaceAll('-','')
  return 'halaqat-test-'+Math.floor(Date.now()/1000)+'-'+nonce
}
function roomExpiry(room:string) {
  const match=room.match(/^halaqat-test-(\d{10})-[a-f0-9]{32}$/)
  return match?Number(match[1])*1000+roomLifetime:0
}
function stillOpen(room:string) {
  const remaining=roomExpiry(room)-Date.now()
  return remaining>0&&remaining<=roomLifetime+30_000
}
export function AgoraAppIdTest({close}:{close:()=>void}) {
  const {t,lessonRtcStatus}=useWorkspace()
  const [room,setRoom]=useState(()=>new URLSearchParams(location.search).get(parameter)??'')
  const [appId,setAppId]=useState('')
  const [checking,setChecking]=useState(false)
  const [error,setError]=useState('')
  const [copied,setCopied]=useState(false)

  useEffect(()=>{
    if(!room)return
    const check=()=>{
      if(!stillOpen(room)){
        setAppId('')
        setError(t('انتهت مدة غرفة الاختبار. أنشئ غرفة جديدة.','The test room expired. Create a new room.'))
      }
    }
    check()
    const timer=window.setTimeout(check,Math.max(0,roomExpiry(room)-Date.now()))
    window.addEventListener('focus',check)
    document.addEventListener('visibilitychange',check)
    return ()=>{
      window.clearTimeout(timer)
      window.removeEventListener('focus',check)
      document.removeEventListener('visibilitychange',check)
    }
  },[room,t])

  const link=new URL('/admin?section=lessons',location.origin)
  if(room)link.searchParams.set(parameter,room)
  const valid=Boolean(room&&stillOpen(room))
  async function connect(create:boolean) {
    if(checking)return
    setChecking(true);setError('');setCopied(false)
    try {
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
        throw new Error(t('افتح الموقع عبر HTTPS في متصفح يدعم الكاميرا والميكروفون.','Open the site over HTTPS in a browser that supports camera and microphone access.'))
      }
      const next=create?newRoom():room
      if(!stillOpen(next))throw new Error(t('رابط الاختبار غير صالح أو منتهٍ. أنشئ غرفة جديدة.','The test link is invalid or expired. Create a new room.'))
      const {appId:configured}=await lessonRtcStatus()
      if(!configured)throw new Error(t('معرّف Agora غير مضبوط في الاستضافة.','The Agora App ID is missing or invalid on the server.'))
      setRoom(next)
      setAppId(configured)
    } catch(error) {setError((error as Error).message)}
    finally {setChecking(false)}
  }
  async function copy() {
    try {await navigator.clipboard.writeText(link.href);setCopied(true)}
    catch {setCopied(false)}
  }
  function dismiss() {
    const current=new URL(location.href)
    if(current.searchParams.has(parameter)){
      current.searchParams.delete(parameter)
      history.replaceState(history.state,'',current)
    }
    close()
  }
  return <Modal title={t('اختبار Agora بمعرّف التطبيق','Agora App ID test')} close={dismiss} wide appearance="lesson-agora-trial">
    <div className="modal-body">
      <p>{t('غرفة اختبار مدتها عشر دقائق. افتح الرابط من متصفح ثانٍ مسجّل فيه حساب الإدارة لتجربة الصوت والفيديو.','The test room lasts ten minutes. Open its link in a second browser signed in as the administrator to test audio and video.')}</p>
      {error&&<p className="error-box" role="alert">{error}</p>}
      {!appId&&<div className="chip-row">
        {valid&&<button type="button" className="btn btn-primary" disabled={checking} onClick={()=>void connect(false)}>{t('انضم للاختبار','Join test')}</button>}
        <button type="button" className={'btn '+(valid?'btn-outline':'btn-primary')} disabled={checking} onClick={()=>void connect(true)}>
          {checking?t('جارٍ التحقق…','Checking…'):t('إنشاء غرفة اختبار','Create test room')}
        </button>
      </div>}
      {!!appId&&<p><strong>{t('معرّف المشروع','Project ID')}</strong> <code dir="ltr">{appId}</code></p>}
      {valid&&<div className="agora-trial-link">
        <input readOnly value={link.href} dir="ltr" aria-label={t('رابط غرفة الاختبار','Test room link')} onFocus={event=>event.currentTarget.select()}/>
        <button type="button" className="btn btn-outline compact" onClick={()=>void copy()}><Copy size={16}/>{copied?t('تم النسخ','Copied'):t('نسخ الرابط','Copy link')}</button>
      </div>}
      {appId&&valid&&<AgoraTrialCall key={room} room={room} appId={appId} leave={()=>setAppId('')}/>}
    </div>
  </Modal>
}

function AgoraTrialCall({room,appId,leave}:{room:string;appId:string;leave:()=>void}) {
  const {t}=useWorkspace()
  const rtc=useAgoraRtc({
    scope:room,test:true,speak:true,enabled:true,media:'video',
    getCredentials:async()=>({appId,channel:room,uid:0,token:null,audio:true,video:true}),
  },devices)
  const connected=rtc.network==='CONNECTED'&&Boolean(rtc.connection)
  const [sendStalled,setSendStalled]=useState(false)
  const publishing=rtc.micOn||rtc.cameraOn
  useEffect(()=>{
    setSendStalled(false)
    if(!connected||!publishing||!rtc.connection)return
    const client=rtc.connection.client
    const baseline=client.getRTCStats().SendBytes
    const start=Date.now()
    const timer=window.setInterval(()=>{
      const sent=client.getRTCStats().SendBytes
      if(sent>baseline){
        setSendStalled(false)
        window.clearInterval(timer)
      }else if(Date.now()-start>=12_000)setSendStalled(true)
    },1500)
    return ()=>window.clearInterval(timer)
  },[connected,publishing,rtc.connection])
  return <div className="agora-trial-call">
    <div className="chip-row">
      <span className="hint-line" role="status"><AudioLines size={16}/>{connected?t('متصل بـ Agora','Connected to Agora'):
        rtc.loading?t('جارٍ الاتصال بـ Agora…','Connecting to Agora…'):t('اتصال الاختبار متوقف','Test disconnected')}</span>
      {connected&&<span className="badge status-active">{rtc.peerIds.length+1} {t('في غرفة الاختبار','in the test room')}</span>}
      {rtc.error&&!connected&&<button type="button" className="btn btn-outline compact" disabled={rtc.loading} onClick={rtc.retry}>{t('إعادة المحاولة','Retry')}</button>}
    </div>
    {rtc.error&&<p className="error-box" role="alert">{rtc.error}</p>}
    {sendStalled&&<p className="error-box" role="status">{t('اتصلت الغرفة، لكن Agora لم يرصد إرسال وسائط من هذا الجهاز بعد. جرّب جهازًا أو شبكة أخرى.','The room connected, but Agora has not reported media being sent by this device yet. Try another device or network.')}</p>}
    {rtc.playbackBlocked&&<button type="button" className="btn btn-outline compact" onClick={rtc.resumeAudio}>{t('تشغيل الصوت','Enable playback')}</button>}
    {connected&&<>
      <CallPermissionStatus permissions={rtc.permissions} videoAllowed/>
      <p className="hint-line" role="status"><AudioLines size={16}/>{rtc.audioPeers.length
        ?t('يصل صوت من الجهاز الآخر','Receiving audio from the other device')
        :t('بانتظار صوت من الجهاز الآخر','Waiting for audio from the other device')}</p>
      <div className="agora-trial-videos">
        <div className="agora-trial-video" role="img" aria-label={t('الفيديو المحلي','Local video')}>
          {rtc.localVideo?<CallVideo local track={rtc.localVideo}/>:<VideoOff size={26}/>}
          <span>{t('أنت','You')}</span>
        </div>
        <div className="agora-trial-video" role="img" aria-label={t('الفيديو الوارد','Remote video')}>
          {rtc.remote[0]?<CallVideo track={rtc.remote[0].track}/>:<VideoOff size={26}/>}
          <span>{rtc.remote[0]?t('الطرف الآخر','Other device'):t('في انتظار فيديو من جهاز آخر','Waiting for video from another device')}</span>
        </div>
      </div>
    </>}
    <div className="chip-row">
      <button type="button" className="btn btn-outline compact" disabled={!rtc.canPublish} aria-pressed={rtc.micOn} onClick={()=>void rtc.toggle('audio')}>
        {rtc.micOn?<MicOff size={17}/>:<Mic size={17}/>} {rtc.micOn?t('كتم الميكروفون','Mute microphone'):t('تشغيل الميكروفون','Enable microphone')}
      </button>
      <button type="button" className="btn btn-outline compact" disabled={!rtc.canVideo} aria-pressed={rtc.cameraOn} onClick={()=>void rtc.toggle('video')}>
        {rtc.cameraOn?<VideoOff size={17}/>:<Video size={17}/>} {rtc.cameraOn?t('إيقاف الكاميرا','Turn off camera'):t('تشغيل الكاميرا','Enable camera')}
      </button>
      <button type="button" className="btn btn-outline compact lesson-danger" onClick={leave}><PhoneOff size={17}/>{t('مغادرة الاختبار','Leave test')}</button>
    </div>
  </div>
}
