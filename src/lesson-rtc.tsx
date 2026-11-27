import { useEffect, useRef, useState } from 'react'
import { Headphones, Mic, MicOff, Video, VideoOff, Wifi } from 'lucide-react'
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from 'agora-rtc-sdk-ng'
import type { LessonCredentials, LessonView } from './lessons'
import { useWorkspace } from './ui'

type Connection = {client:IAgoraRTCClient; credentials:LessonCredentials}
type Remote = {uid:number|string; track:IRemoteVideoTrack}

export function LessonRtc({lesson}:{lesson:LessonView}) {
  const {data,lessonRtc,t}=useWorkspace()
  const [requested,setRequested]=useState(false)
  const [connection,setConnection]=useState<Connection>()
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [quality,setQuality]=useState(0)
  const [network,setNetwork]=useState('')
  const [remote,setRemote]=useState<Remote[]>([])
  const [speaker,setSpeaker]=useState<number|string>()
  const [micOn,setMicOn]=useState(false),[cameraOn,setCameraOn]=useState(false)
  const [sources,setSources]=useState<MediaDeviceInfo[]>([])
  const [micId,setMicId]=useState(''),[cameraId,setCameraId]=useState('')
  const mic=useRef<IMicrophoneAudioTrack|undefined>(undefined),camera=useRef<ICameraVideoTrack|undefined>(undefined)
  const videoBox=useRef<HTMLDivElement>(null)
  const generation=useRef(0)
  const localAction=useRef(false)
  const credentials=useRef(lessonRtc)
  credentials.current=lessonRtc
  const allowed=Boolean(data.lessonHealth?.rtcConfigured&&lesson.status==='live'&&lesson.self?.status==='admitted'
    &&!lesson.mediaChanging&&isSecureContext&&navigator.mediaDevices)
  const publishing=lesson.manager||data.user?.role==='teacher'&&['meeting','urgent'].includes(lesson.kind)||lesson.currentStudent===data.user?.id
  const speak=Boolean(publishing)
  const show=remote.find(item=>item.uid===speaker)??remote[0]
  useEffect(()=>{
    if(!show||!videoBox.current)return
    show.track.play(videoBox.current)
    return ()=>show.track.stop()
  },[show])
  useEffect(()=>{
    if(!requested||!allowed)return
    const attempt=++generation.current
    let client:IAgoraRTCClient|undefined
    let renewing=false
    const active=()=>generation.current===attempt
    const cleanup=()=>{mic.current?.close();camera.current?.close();mic.current=undefined;camera.current=undefined}
    const start=async()=>{
      setLoading(true);setError('')
      try{
        const parameters=await credentials.current(lesson.id)
        if(!active())return
        const {default:sdk}=await import('agora-rtc-sdk-ng')
        if(!active())return
        sdk.setLogLevel(4)
        client=sdk.createClient({mode:'live',codec:'vp8'})
        const target=client
        target.on('connection-state-change',next=>{if(active())setNetwork(next)})
        target.on('network-quality',stats=>{if(active())setQuality(Math.max(stats.uplinkNetworkQuality,stats.downlinkNetworkQuality))})
        target.on('volume-indicator',levels=>{
          if(active())setSpeaker([...levels].filter(level=>level.level>5).sort((a,b)=>b.level-a.level)[0]?.uid)
        })
        target.on('user-published',async(peer,kind)=>{
          if(kind!=='audio'&&kind!=='video')return
          try{
            await target.subscribe(peer,kind)
            if(!active())return
            if(kind==='audio')peer.audioTrack?.play()
            if(kind==='video'&&peer.videoTrack){
              const track=peer.videoTrack
              setRemote(items=>[...items.filter(item=>item.uid!==peer.uid),{uid:peer.uid,track}])
            }
          }catch{if(active())setError(t('تعذر تشغيل وسائط من أحد المشاركين.','One participant’s media could not be played.'))}
        })
        target.on('user-unpublished',(peer,kind)=>{if(active()&&kind==='video')setRemote(items=>items.filter(item=>item.uid!==peer.uid))})
        target.on('user-left',peer=>{if(active())setRemote(items=>items.filter(item=>item.uid!==peer.uid))})
        const renew=async()=>{
          if(renewing||!active())return
          renewing=true
          try{
            const token=await credentials.current(lesson.id)
            if(active())await target.renewToken(token.token)
          }catch{
            if(active()){setRequested(false);setError(t('انتهت صلاحية الاتصال. أعد محاولة الاتصال.','The connection grant expired. Connect again.'))}
          }finally{renewing=false}
        }
        target.on('token-privilege-will-expire',()=>void renew())
        target.on('token-privilege-did-expire',()=>{if(active()){setRequested(false);setError(t('انتهت صلاحية الاتصال. أعد محاولة الاتصال.','The connection grant expired. Connect again.'))}})
        await target.setClientRole(parameters.audio?'host':'audience')
        if(!active())return
        await target.join(parameters.appId,parameters.channel,parameters.token,parameters.uid)
        if(!active()){void target.leave();return}
        target.enableAudioVolumeIndicator()
        setConnection({client:target,credentials:parameters})
      }catch(error){
        if(active()){setRequested(false);setError((error as Error).message||t('تعذر الاتصال بالوسائط.','Could not connect to media.'))}
      }finally{if(active())setLoading(false)}
    }
    void start()
    return ()=>{
      generation.current++
      cleanup()
      setConnection(undefined);setRemote([]);setMicOn(false);setCameraOn(false);setLoading(false)
      if(client)void client.leave().catch(()=>{})
    }
  },[lesson.id,lesson.self?.generation,requested,allowed,speak,lesson.media])

  async function checkDevices() {
    setError('')
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:lesson.media==='video'&&speak})
      stream.getTracks().forEach(track=>track.stop())
      setSources(await navigator.mediaDevices.enumerateDevices())
    }catch{setError(t('تعذر اختبار الأجهزة. راجع إذن الميكروفون أو الكاميرا.','Device check failed. Check your microphone or camera permission.'))}
  }
  async function toggle(kind:'audio'|'video') {
    if(!connection||localAction.current||!connection.credentials[kind])return
    localAction.current=true
    const attempt=generation.current
    const ref=kind==='audio'?mic:camera
    const current=ref.current
    try{
      if(current){
        await connection.client.unpublish(current)
        current.close()
        ref.current=undefined
      }else {
        const {default:sdk}=await import('agora-rtc-sdk-ng')
        const track=kind==='audio'?await sdk.createMicrophoneAudioTrack({microphoneId:micId||undefined}):await sdk.createCameraVideoTrack({cameraId:cameraId||undefined,encoderConfig:'360p_4'})
        try {
          if(attempt!==generation.current){track.close();return}
          await connection.client.publish(track)
          if(attempt!==generation.current){track.close();return}
        } catch(error){track.close();throw error}
        if(kind==='audio')mic.current=track as IMicrophoneAudioTrack
        else camera.current=track as ICameraVideoTrack
      }
      if(attempt===generation.current)(kind==='audio'?setMicOn:setCameraOn)(!current)
    }catch{if(attempt===generation.current)setError(t('تعذر تشغيل الوسائط. راجع إذن الجهاز ثم حاول مجددًا.','Could not use the device. Check permissions and try again.'))}
    finally{localAction.current=false}
  }
  if(!data.lessonHealth?.rtcConfigured)return <p className="hint-line">{t('الاتصال الصوتي والمرئي ينتظر إعدادات Agora على الخادم.','Audio and video require Agora configuration on the server.')}</p>
  if(lesson.mediaChanging)return <p className="hint-line" role="status">{t('جارٍ تطبيق تغييرات الأذونات لدى Agora.','Applying permission changes in Agora.')}</p>
  return <section className="lesson-media">
    {show&&<div className="lesson-remote-video" ref={videoBox}/>}
    <div className="chip-row">
      <span className="count-pill"><Wifi size={15}/>{network==='RECONNECTING'?t('جارٍ استعادة الاتصال','Reconnecting'):connection?(quality>=4?t('اتصال ضعيف','Weak connection'):quality?t('اتصال مستقر','Stable connection'):t('متصل بغرفة الوسائط','Media room connected')):t('الوسائط غير متصلة','Media disconnected')}</span>
      {!connection&&allowed&&<button type="button" className="btn btn-outline compact" onClick={()=>void checkDevices()}><Headphones size={17}/>{t('اختبار الأجهزة','Test devices')}</button>}
      {!connection&&allowed&&<button type="button" className="btn btn-primary compact" disabled={loading} onClick={()=>setRequested(true)}>{loading?t('جارٍ الاتصال','Connecting'):t('الاتصال بالوسائط','Connect to media')}</button>}
      {connection&&<button type="button" className="btn btn-outline compact" onClick={()=>setRequested(false)}>{t('فصل الوسائط','Disconnect media')}</button>}
      {connection?.credentials.audio&&speak&&<button type="button" className="btn btn-outline compact" onClick={()=>void toggle('audio')} aria-pressed={micOn}>{micOn?<MicOff size={17}/>:<Mic size={17}/>} {micOn?t('كتم الميكروفون','Mute microphone'):t('تشغيل الميكروفون','Enable microphone')}</button>}
      {connection?.credentials.video&&speak&&lesson.media==='video'&&<button type="button" className="btn btn-outline compact" onClick={()=>void toggle('video')} aria-pressed={cameraOn}>{cameraOn?<VideoOff size={17}/>:<Video size={17}/>} {cameraOn?t('إيقاف الكاميرا','Disable camera'):t('تشغيل الكاميرا','Enable camera')}</button>}
    </div>
    {!connection&&sources.length>0&&<div className="field-pair">
      <label>{t('الميكروفون','Microphone')}<select value={micId} onChange={event=>setMicId(event.target.value)}><option value="">{t('الجهاز الافتراضي','System default')}</option>{sources.filter(item=>item.kind==='audioinput'&&item.deviceId).map((item,index)=><option key={item.deviceId} value={item.deviceId}>{item.label||String(index+1)}</option>)}</select></label>
      {lesson.media==='video'&&speak&&<label>{t('الكاميرا','Camera')}<select value={cameraId} onChange={event=>setCameraId(event.target.value)}><option value="">{t('الجهاز الافتراضي','System default')}</option>{sources.filter(item=>item.kind==='videoinput'&&item.deviceId).map((item,index)=><option key={item.deviceId} value={item.deviceId}>{item.label||String(index+1)}</option>)}</select></label>}
    </div>}
    {error&&<div className="error-box" role="alert">{error}</div>}
  </section>
}
