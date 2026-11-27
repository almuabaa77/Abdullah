import { useEffect, useRef, useState } from 'react'
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack, ILocalVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng'
import type { LessonCredentials, LessonMedia, LessonView } from './lessons'
import { callDeviceError, useCallDevicePermissions } from './lesson-permissions'
import { useWorkspace, type Tr } from './ui'

type SessionCredentials = Omit<LessonCredentials,'token'> & {token:string|null}
type Connection = {client:IAgoraRTCClient; credentials:SessionCredentials; scope:string; resumeAudio:()=>void}
export type CallDevices = {micId:string;cameraId:string;speakerId:string}
type Remote = {uid:number|string; track:IRemoteVideoTrack}
type RtcOptions = {
  scope:string; enabled:boolean; changing?:boolean; speak:boolean; media:LessonMedia
  test?:boolean; getCredentials:()=>Promise<SessionCredentials>
}

export function useLessonRtc(lesson:LessonView,devices:CallDevices) {
  const {data,lessonRtc}=useWorkspace()
  const speak=Boolean(lesson.manager||data.user?.role==='teacher'&&['meeting','urgent'].includes(lesson.kind)||lesson.currentStudent===data.user?.id)
  return useAgoraRtc({
    scope:[lesson.id,lesson.self?.generation,speak,lesson.media].join(':'),
    enabled:Boolean(data.lessonHealth?.rtcConfigured&&lesson.status==='live'&&lesson.self?.status==='admitted'),
    changing:lesson.mediaChanging,speak,media:lesson.media,getCredentials:()=>lessonRtc(lesson.id),
  },devices)
}

export function useAgoraRtc({scope,enabled,changing,speak,media,test=false,getCredentials}:RtcOptions,devices:CallDevices) {
  const {t}=useWorkspace()
  const [requested,setRequested]=useState(true)
  const {permissions,report}=useCallDevicePermissions(media==='video')
  const [connection,setConnection]=useState<Connection>()
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [quality,setQuality]=useState(0)
  const [network,setNetwork]=useState('')
  const [remote,setRemote]=useState<Remote[]>([])
  const [levels,setLevels]=useState<Record<string,number>>({})
  const [audioPeers,setAudioPeers]=useState<(number|string)[]>([])
  const [peerIds,setPeerIds]=useState<(number|string)[]>([])
  const [playbackBlocked,setPlaybackBlocked]=useState(false)
  const [audioOnly,setAudioOnly]=useState(false)
  const audioOnlyRef=useRef(audioOnly);audioOnlyRef.current=audioOnly
  const speakerRef=useRef(devices.speakerId);speakerRef.current=devices.speakerId
  const devicesRef=useRef(devices);devicesRef.current=devices
  const [localVideo,setLocalVideo]=useState<ICameraVideoTrack>()
  const [micOn,setMicOn]=useState(false),[cameraOn,setCameraOn]=useState(false)
  const mic=useRef<IMicrophoneAudioTrack|undefined>(undefined),camera=useRef<ICameraVideoTrack|undefined>(undefined)
  const generation=useRef(0)
  const localAction=useRef(false)
  const credentials=useRef(getCredentials)
  credentials.current=getCredentials
  const allowed=Boolean(enabled&&(!changing||connection?.scope===scope)&&isSecureContext&&navigator.mediaDevices)
  useEffect(()=>{
    if(!requested||!allowed)return
    const attempt=++generation.current
    let client:IAgoraRTCClient|undefined
    let renewing=false
    let unbindPlayback:(()=>void)|undefined
    const active=()=>generation.current===attempt
    const cleanup=()=>{mic.current?.close();camera.current?.close();mic.current=undefined;camera.current=undefined}
    const start=async()=>{
      setLoading(true);setError('')
      try{
        const parameters=await credentials.current()
        if(!active())return
        if(!test&&!parameters.token)throw new Error(t('تعذر التحقق من إذن دخول الجلسة.','Could not verify the session grant.'))
        const {default:sdk}=await import('agora-rtc-sdk-ng')
        if(!active())return
        sdk.setLogLevel(4)
        if(!sdk.checkSystemRequirements())throw new Error(t('المتصفح لا يدعم مكالمات Agora. افتح المنصة في إصدار حديث.','This browser does not support Agora calls. Open the site in a current browser.'))
        const codecs=await sdk.getSupportedCodec().catch(()=>undefined)
        if(!active())return
        const codec=codecs?.video.includes('H264')&&!codecs.video.includes('VP8')?'h264':'vp8'
        client=sdk.createClient({mode:test?'rtc':'live',codec})
        const target=client
        target.on('connection-state-change',(next,previous)=>{
          if(!active())return
          setNetwork(next)
          if(next==='DISCONNECTED'&&(previous==='CONNECTED'||previous==='RECONNECTING')){
            setRequested(false)
            setError(t('انقطع اتصال الوسائط. أعد الاتصال من هذه الشاشة.','Media disconnected. Reconnect from this screen.'))
          }
        })
        target.on('network-quality',stats=>{if(active())setQuality(Math.max(stats.uplinkNetworkQuality,stats.downlinkNetworkQuality))})
        target.on('volume-indicator',values=>{
          if(active())setLevels(Object.fromEntries(values.map(item=>[String(item.uid),item.level])))
        })
        const refreshPeers=()=>{if(active())setPeerIds(target.remoteUsers.map(user=>user.uid))}
        const playbackBlocked=()=>{if(active())setPlaybackBlocked(true)}
        const audioContextChanged=(state:AudioContextState|'interrupted')=>{
          if(!active())return
          if(state==='interrupted')setPlaybackBlocked(true)
          if(state==='running')setPlaybackBlocked(false)
        }
        sdk.on('autoplay-failed',playbackBlocked)
        sdk.on('audio-context-state-changed',audioContextChanged)
        unbindPlayback=()=>{
          sdk.off('autoplay-failed',playbackBlocked)
          sdk.off('audio-context-state-changed',audioContextChanged)
        }
        target.on('user-joined',refreshPeers)
        target.on('user-published',async(peer,kind)=>{
          if(kind!=='audio'&&kind!=='video')return
          try{
            if(kind==='video'&&audioOnlyRef.current)return
            await target.subscribe(peer,kind)
            if(!active())return
            if(kind==='audio'&&peer.audioTrack){
              setAudioPeers(items=>[...new Set([...items,peer.uid])])
              await routeAudio(peer.audioTrack,speakerRef.current)
              if(active())peer.audioTrack?.play()
            }
            if(kind==='video'&&peer.videoTrack&&!audioOnlyRef.current){
              const track=peer.videoTrack
              setRemote(items=>[...items.filter(item=>item.uid!==peer.uid),{uid:peer.uid,track}])
            }
          }catch{if(active())setError(t('تعذر تشغيل وسائط من أحد المشاركين.','One participant’s media could not be played.'))}
          finally{refreshPeers()}
        })
        target.on('user-unpublished',(peer,kind)=>{
          if(!active())return
          if(kind==='video')setRemote(items=>items.filter(item=>item.uid!==peer.uid))
          if(kind==='audio')setAudioPeers(items=>items.filter(id=>id!==peer.uid))
        })
        target.on('user-left',peer=>{
          refreshPeers()
          if(!active())return
          setRemote(items=>items.filter(item=>item.uid!==peer.uid))
          setAudioPeers(items=>items.filter(id=>id!==peer.uid))
        })
        if(!test){
          const renew=async()=>{
            if(renewing||!active())return
            renewing=true
            try{
              const next=await credentials.current()
              if(!next.token)throw new Error()
              if(active())await target.renewToken(next.token)
            }catch{
              if(active()){setRequested(false);setError(t('انتهت صلاحية الاتصال. أعد محاولة الاتصال.','The connection grant expired. Connect again.'))}
            }finally{renewing=false}
          }
          target.on('token-privilege-will-expire',()=>void renew())
          target.on('token-privilege-did-expire',()=>{if(active()){setRequested(false);setError(t('انتهت صلاحية الاتصال. أعد محاولة الاتصال.','The connection grant expired. Connect again.'))}})
          await target.setClientRole(parameters.audio?'host':'audience')
        }
        if(!active())return
        const uid=await target.join(parameters.appId,parameters.channel,parameters.token,test?null:parameters.uid)
        if(!active()){void target.leave().catch(()=>{});return}
        target.enableAudioVolumeIndicator()
        refreshPeers()
        setConnection({client:target,credentials:{...parameters,uid:typeof uid==='number'?uid:parameters.uid},scope,resumeAudio:()=>sdk.resumeAudioContext()})
      }catch(error){
        if(active()){
          setRequested(false)
          setError(test?testConnectionError(error,t):(error as Error).message||t('تعذر الاتصال بالوسائط.','Could not connect to media.'))
        }
      }finally{if(active())setLoading(false)}
    }
    void start()
    return ()=>{
      generation.current++
      cleanup()
      unbindPlayback?.()
      setConnection(undefined);setRemote([]);setAudioPeers([]);setPeerIds([]);setLevels({})
      setLocalVideo(undefined);setMicOn(false);setCameraOn(false);setLoading(false);setQuality(0);setNetwork('');setPlaybackBlocked(false)
      if(client)void client.leave().catch(()=>{})
    }
  },[scope,requested,allowed,test])

  useEffect(()=>{
    if(!connection)return
    for(const peer of connection.client.remoteUsers)if(peer.audioTrack)void routeAudio(peer.audioTrack,devices.speakerId)
  },[connection,devices.speakerId])

  useEffect(()=>{
    if(!connection)return
    let current=true
    if(audioOnly)setRemote([])
    for(const peer of connection.client.remoteUsers){
      if(audioOnly&&peer.videoTrack)void connection.client.unsubscribe(peer,'video').catch(()=>{})
      if(!audioOnly&&peer.hasVideo&&!peer.videoTrack)void connection.client.subscribe(peer,'video').then(track=>{
        if(current)setRemote(items=>[...items.filter(item=>item.uid!==peer.uid),{uid:peer.uid,track}])
      }).catch(()=>{})
    }
    return ()=>{current=false}
  },[connection,audioOnly])

  async function toggle(kind:'audio'|'video') {
    if(!connection||localAction.current||!connection.credentials[kind])return false
    setError('')
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
        const track=kind==='audio'?await sdk.createMicrophoneAudioTrack({microphoneId:devicesRef.current.micId||undefined}):await sdk.createCameraVideoTrack({cameraId:devicesRef.current.cameraId||undefined,encoderConfig:'360p_4'})
        try {
          if(attempt!==generation.current){track.close();return}
          await connection.client.publish(track)
          if(attempt!==generation.current){track.close();return}
        } catch(error){track.close();throw error}
        report(kind,true)
        if(kind==='audio')mic.current=track as IMicrophoneAudioTrack
        else camera.current=track as ICameraVideoTrack
        track.on('track-ended',()=>{
          if(attempt!==generation.current||ref.current!==track)return
          ref.current=undefined
          void connection.client.unpublish(track).catch(()=>{}).finally(()=>track.close())
          if(kind==='audio')setMicOn(false)
          else {setCameraOn(false);setLocalVideo(undefined)}
          const ended=new DOMException('Track ended','NotFoundError')
          report(kind,false,ended)
          setError(callDeviceError(ended,kind,t))
        })
      }
      if(attempt!==generation.current)return false
      if(kind==='audio')setMicOn(!current)
      else {setCameraOn(!current);setLocalVideo(camera.current)}
      return true
    }catch(error){
      if(attempt===generation.current){report(kind,false,error);setError(callDeviceError(error,kind,t))}
      return false
    }finally{localAction.current=false}
  }
  const canPublish=Boolean(connection&&network==='CONNECTED'&&connection.scope===scope&&speak&&connection.credentials.audio)
  const canVideo=Boolean(canPublish&&connection?.credentials.video&&media==='video'&&!audioOnly)
  async function switchAudioOnly() {
    if(!audioOnly&&camera.current&&!(await toggle('video')))return
    setAudioOnly(value=>!value)
  }
  function resumeAudio(){
    connection?.resumeAudio()
    for(const peer of connection?.client.remoteUsers??[])peer.audioTrack?.play()
    setPlaybackBlocked(false)
  }
  return {connection,loading,error,quality,network,remote,levels,audioPeers,peerIds,micOn,cameraOn,localVideo,permissions,
    canPublish,canVideo,allowed,audioOnly,playbackBlocked,resumeAudio,switchAudioOnly,toggle,retry:()=>{setError('');setRequested(true)}}
}

function testConnectionError(error:unknown,t:Tr) {
  const failure=error as {code?:string;message?:string}
  const detail=(failure.code??'')+' '+(failure.message??'')
  if(/invalid vendor key|invalid app\s*id|cannot find appid|can not find appid/i.test(detail))return t('لم يتعرّف Agora على معرّف المشروع. راجع App ID وحالة المشروع في Agora Console.','Agora did not recognize this App ID. Check the ID and project status in Agora Console.')
  if(/invalid.?token|token.*(?:required|missing|empty)|dynamic.use.static.key|no.token/i.test(detail))return t('رفض Agora الانضمام بالمعرّف فقط. اختر مشروع اختبار يسمح بـ App ID Only في Agora Console.','Agora rejected App ID-only joining. Use a test project that allows App ID Only in Agora Console.')
  return failure.code?t('تعذر اتصال اختبار Agora','Could not connect to Agora')+' ('+failure.code+')':
    failure.message||t('تعذر اتصال اختبار Agora. أعد المحاولة.','Could not connect to Agora. Try again.')
}

async function routeAudio(track:IRemoteAudioTrack,device:string) {
  if(typeof HTMLMediaElement!=='undefined'&&'setSinkId' in HTMLMediaElement.prototype){
    await track.setPlaybackDevice(device||'default').catch(()=>{})
  }
}

export function CallVideo({track,local=false}:{track:IRemoteVideoTrack|ILocalVideoTrack;local?:boolean}) {
  const box=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(!box.current)return
    track.play(box.current,{fit:'cover',mirror:local})
    return ()=>track.stop()
  },[track,local])
  return <div ref={box} className="call-tile-video" aria-hidden="true"/>
}
