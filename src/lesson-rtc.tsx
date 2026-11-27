import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack, ILocalVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng'
import type { LessonCredentials, LessonMedia, LessonView } from './lessons'
import { callDeviceError, useCallDevicePermissions } from './lesson-permissions'
import { configureLessonEncryption, createLiveAgoraClient } from './lesson-agora-client'
import { useWorkspace } from './ui'

type Connection = {client:IAgoraRTCClient; credentials:LessonCredentials; scope:string; resumeAudio:()=>void}
export type CallDevices = {micId:string;cameraId:string;speakerId:string}
export type CallVideoQuality='auto'|'high'|'data'
export type CallAudioProfile='recitation'|'speech'
type Remote = {uid:number|string; track:IRemoteVideoTrack}
type RtcOptions = {
  scope:string; enabled:boolean; changing?:boolean; speak:boolean; media:LessonMedia
  publisherUids?:number[]; priorityUids:number[]; getCredentials:()=>Promise<LessonCredentials>
}

export function useLessonRtc(lesson:LessonView,devices:CallDevices) {
  const {data,lessonRtc,lessonRtcPresence,refresh}=useWorkspace()
  const speak=Boolean(lesson.people.find(person=>person.id===data.user?.id)?.canPublish)
  const encrypted=Boolean(data.lessonHealth?.encryptedMode)
  const rtc=useAgoraRtc({
    scope:[lesson.id,lesson.self?.generation,speak,lesson.media,encrypted?lesson.mediaVersion:0].join(':'),
    enabled:Boolean(data.lessonHealth?.rtcConfigured&&lesson.status==='live'&&lesson.self?.status==='admitted'),
    changing:lesson.mediaChanging,speak,media:lesson.media,getCredentials:()=>lessonRtc(lesson.id),
    publisherUids:encrypted?lesson.people.flatMap(person=>person.canPublish&&person.mediaUid!==undefined?[person.mediaUid]:[]):undefined,
    priorityUids:lesson.people.flatMap(person=>person.mediaUid!==undefined&&
      (person.id===lesson.currentStudent||person.id===lesson.teacherId||person.id===lesson.substituteId)?[person.mediaUid]:[]),
  },devices)
  const presence=useRef({report:lessonRtcPresence,refresh});presence.current={report:lessonRtcPresence,refresh}
  const grant=rtc.connection?.credentials
  const connected=rtc.network==='CONNECTED'
  useEffect(()=>{
    if(!connected||!grant?.encryption)return
    let closed=false,running=false
    const report=async()=>{
      if(closed||running)return
      running=true
      try {
        if(!await presence.current.report(lesson.id,grant.uid,grant.version!)&&!closed)presence.current.refresh()
      }catch{}finally{running=false}
    }
    void report()
    const timer=window.setInterval(()=>void report(),19_000)
    window.addEventListener('online',report)
    window.addEventListener('focus',report)
    return ()=>{closed=true;window.clearInterval(timer);window.removeEventListener('online',report);window.removeEventListener('focus',report)}
  },[connected,grant,lesson.id])
  return rtc
}

function useAgoraRtc({scope,enabled,changing,speak,media,publisherUids,priorityUids,getCredentials}:RtcOptions,devices:CallDevices) {
  const {t}=useWorkspace()
  const [requested,setRequested]=useState(true)
  const {permissions,report}=useCallDevicePermissions(media==='video')
  const [connection,setConnection]=useState<Connection>()
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [quality,setQuality]=useState(0)
  const [videoQuality,setVideoQuality]=useState<CallVideoQuality>('auto')
  const [audioProfile,setAudioProfile]=useState<CallAudioProfile>('recitation')
  const [reduceUpload,setReduceUpload]=useState(false)
  const [stats,setStats]=useState<{rtt:number;send:number;receive:number}>()
  const [fallbackVideo,setFallbackVideo]=useState<(number|string)[]>([])
  const priorityKey=priorityUids.join(',')
  const playbackPolicy=useRef({videoQuality,priority:new Set(priorityUids)})
  playbackPolicy.current={videoQuality,priority:new Set(priorityUids)}
  const encoder=videoQuality==='data'||videoQuality==='auto'&&reduceUpload?'360p_4':videoQuality==='high'?'720p_2':'720p_1'
  const [network,setNetwork]=useState('')
  const [remote,setRemote]=useState<Remote[]>([])
  const [levels,setLevels]=useState<Record<string,number>>({})
  const [audioPeers,setAudioPeers]=useState<(number|string)[]>([])
  const [peerIds,setPeerIds]=useState<(number|string)[]>([])
  const [playbackBlocked,setPlaybackBlocked]=useState(false)
  const [audioOnly,setAudioOnly]=useState(false)
  const audioOnlyRef=useRef(audioOnly);audioOnlyRef.current=audioOnly
  const publisherPolicy=useRef(new Set<number>())
  publisherPolicy.current=new Set(publisherUids)
  const filterPublishers=publisherUids!==undefined
  const publisherPolicyKey=publisherUids?.join(',')
  const reconcileStreams=useRef<()=>void>(()=>{})
  const speakerRef=useRef(devices.speakerId);speakerRef.current=devices.speakerId
  const devicesRef=useRef(devices);devicesRef.current=devices
  const [localVideo,setLocalVideo]=useState<ICameraVideoTrack>()
  const currentEncoder=useRef<{track:ICameraVideoTrack;encoder:typeof encoder}|undefined>(undefined)
  const [micOn,setMicOn]=useState(false),[cameraOn,setCameraOn]=useState(false)
  const [deviceBusy,setDeviceBusy]=useState(false)
  const mic=useRef<IMicrophoneAudioTrack|undefined>(undefined),camera=useRef<ICameraVideoTrack|undefined>(undefined)
  const generation=useRef(0)
  const localAction=useRef(false)
  const publishingIntent=useRef({audio:false,video:false})
  if(!speak)publishingIntent.current={audio:false,video:false}
  else if(media!=='video')publishingIntent.current.video=false
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
        if(!parameters.token&&!parameters.encryption)throw new Error(t('تعذر التحقق من إذن دخول الجلسة.','Could not verify the session grant.'))
        const live=await createLiveAgoraClient()
        if(!active())return
        if(!live)throw new Error(t('المتصفح لا يدعم مكالمات Agora. افتح المنصة في إصدار حديث.','This browser does not support Agora calls. Open the site in a current browser.'))
        const {sdk}=live
        client=live.client
        const target=client
        if(parameters.encryption){
          configureLessonEncryption(target,parameters)
          target.on('crypt-error',()=>{if(active())setError(t('تعذر فك تشفير الوسائط. أعد الاتصال بالغرفة.','Could not decrypt the media. Reconnect to the room.'))})
        }
        target.on('connection-state-change',(next,previous)=>{
          if(!active())return
          setNetwork(next)
          if(next==='DISCONNECTED'&&(previous==='CONNECTED'||previous==='RECONNECTING')){
            setRequested(false)
            setError(t('انقطع اتصال الوسائط. أعد الاتصال من هذه الشاشة.','Media disconnected. Reconnect from this screen.'))
          }
        })
        let poorSamples=0,goodSamples=0
        target.on('network-quality',sample=>{
          if(!active())return
          setQuality(Math.max(sample.uplinkNetworkQuality,sample.downlinkNetworkQuality))
          poorSamples=sample.uplinkNetworkQuality>=4?poorSamples+1:0
          goodSamples=sample.uplinkNetworkQuality>0&&sample.uplinkNetworkQuality<=2?goodSamples+1:0
          if(poorSamples===3)setReduceUpload(true)
          if(goodSamples===5)setReduceUpload(false)
          const measured=target.getRTCStats()
          setStats({rtt:measured.RTT,send:measured.SendBitrate,receive:measured.RecvBitrate})
        })
        target.on('stream-fallback',(uid,state)=>{
          if(active())setFallbackVideo(items=>state==='fallback'?[...new Set([...items,uid])]:items.filter(item=>item!==uid))
        })
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
        const permitted=(uid:number|string,kind:'audio'|'video')=>
          (!filterPublishers||typeof uid==='number'&&publisherPolicy.current.has(uid))
          &&(kind==='audio'||media==='video'&&!audioOnlyRef.current)
        const pending=new Set<string>()
        const setStreamQuality=(peer:IAgoraRTCRemoteUser)=>{
          const {videoQuality:quality,priority}=playbackPolicy.current
          const requested=quality==='data'||quality==='auto'&&(typeof peer.uid!=='number'||!priority.has(peer.uid))?1:0
          void target.setRemoteVideoStreamType(peer.uid,requested).catch(()=>{})
        }
        const subscribe=async(peer:IAgoraRTCRemoteUser,kind:'audio'|'video')=>{
          const key=peer.uid+':'+kind
          if(!permitted(peer.uid,kind)||pending.has(key))return
          pending.add(key)
          try{
            await target.subscribe(peer,kind)
            if(!active())return
            if(!permitted(peer.uid,kind)){void target.unsubscribe(peer,kind).catch(()=>{});return}
            if(kind==='audio'&&peer.audioTrack){
              setAudioPeers(items=>[...new Set([...items,peer.uid])])
              await routeAudio(peer.audioTrack,speakerRef.current)
              if(active()&&permitted(peer.uid,kind))peer.audioTrack?.play()
            }
            if(kind==='video'&&peer.videoTrack&&!audioOnlyRef.current){
              const track=peer.videoTrack
              void target.setStreamFallbackOption(peer.uid,2).catch(()=>{})
              setStreamQuality(peer)
              setRemote(items=>[...items.filter(item=>item.uid!==peer.uid),{uid:peer.uid,track}])
            }
          }catch{if(active())setError(t('تعذر تشغيل وسائط من أحد المشاركين.','One participant’s media could not be played.'))}
          finally{pending.delete(key);refreshPeers()}
        }
        reconcileStreams.current=()=>{
          for(const peer of target.remoteUsers){
            for(const kind of ['audio','video'] as const){
              const track=kind==='audio'?peer.audioTrack:peer.videoTrack
              if(!permitted(peer.uid,kind)&&track){
                track.stop()
                void target.unsubscribe(peer,kind).catch(()=>{})
                if(kind==='audio')setAudioPeers(items=>items.filter(id=>id!==peer.uid))
                else {
                  setRemote(items=>items.filter(item=>item.uid!==peer.uid))
                  setFallbackVideo(items=>items.filter(id=>id!==peer.uid))
                }
              }else if(permitted(peer.uid,kind)&&!track&&(kind==='audio'?peer.hasAudio:peer.hasVideo))void subscribe(peer,kind)
              else if(kind==='video'&&track)setStreamQuality(peer)
            }
          }
        }
        target.on('user-published',(peer,kind)=>{
          if(kind==='audio'||kind==='video')void subscribe(peer,kind)
        })
        target.on('user-unpublished',(peer,kind)=>{
          if(!active())return
          if(kind==='video'){
            setRemote(items=>items.filter(item=>item.uid!==peer.uid))
            setFallbackVideo(items=>items.filter(id=>id!==peer.uid))
          }
          if(kind==='audio')setAudioPeers(items=>items.filter(id=>id!==peer.uid))
        })
        target.on('user-left',peer=>{
          refreshPeers()
          if(!active())return
          setRemote(items=>items.filter(item=>item.uid!==peer.uid))
          setAudioPeers(items=>items.filter(id=>id!==peer.uid))
          setFallbackVideo(items=>items.filter(id=>id!==peer.uid))
        })
        if(parameters.token){
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
        }
        await target.setClientRole(parameters.audio?'host':'audience')
        if(parameters.video){
          try{
            target.setLowStreamParameter({width:320,height:180,framerate:12,bitrate:140})
            await target.enableDualStream()
          }catch{ /* Playback can use the main stream on SDKs without dual-stream support. */ }
        }
        if(!active())return
        await target.join(parameters.appId,parameters.channel,parameters.token,parameters.uid)
        if(!active()){void target.leave().catch(()=>{});return}
        target.enableAudioVolumeIndicator()
        refreshPeers()
        setConnection({client:target,credentials:parameters,scope,resumeAudio:()=>sdk.resumeAudioContext()})
      }catch(error){
        if(active()){
          setRequested(false)
          setError((error as Error).message||t('تعذر الاتصال بالوسائط.','Could not connect to media.'))
        }
      }finally{if(active())setLoading(false)}
    }
    void start()
    return ()=>{
      generation.current++
      reconcileStreams.current=()=>{}
      cleanup()
      unbindPlayback?.()
      setConnection(undefined);setRemote([]);setAudioPeers([]);setPeerIds([]);setLevels({})
      setLocalVideo(undefined);setMicOn(false);setCameraOn(false);setLoading(false);setQuality(0);setNetwork('');setPlaybackBlocked(false)
      setFallbackVideo([]);setReduceUpload(false);setStats(undefined)
      if(client)void client.leave().catch(()=>{})
    }
  },[scope,requested,allowed,filterPublishers,media])

  useEffect(()=>{
    if(!connection)return
    for(const peer of connection.client.remoteUsers)if(peer.audioTrack)void routeAudio(peer.audioTrack,devices.speakerId)
  },[connection,devices.speakerId])

  useEffect(()=>{if(connection)reconcileStreams.current()},[connection,audioOnly,publisherPolicyKey,priorityKey,videoQuality])
  useEffect(()=>{
    if(!localVideo||currentEncoder.current?.track===localVideo&&currentEncoder.current.encoder===encoder)return
    void localVideo.setEncoderConfiguration(encoder).then(()=>{currentEncoder.current={track:localVideo,encoder}}).catch(()=>{})
  },[localVideo,encoder])

  async function toggle(kind:'audio'|'video',wanted?:boolean) {
    if(!connection||connection.scope!==scope||network!=='CONNECTED'||!speak||localAction.current||!connection.credentials[kind])return false
    const attempt=generation.current
    const ref=kind==='audio'?mic:camera
    const current=ref.current
    if(wanted===Boolean(current))return true
    setError('')
    localAction.current=true
    setDeviceBusy(true)
    try{
      if(current){
        await connection.client.unpublish(current)
        current.close()
        ref.current=undefined
      }else {
        const {default:sdk}=await import('agora-rtc-sdk-ng')
        const speech=audioProfile==='speech'
        const track=kind==='audio'?await sdk.createMicrophoneAudioTrack({
          microphoneId:devicesRef.current.micId||undefined,encoderConfig:speech?'speech_standard':'music_standard',
          AEC:true,ANS:speech,AGC:speech,
        }):await sdk.createCameraVideoTrack({cameraId:devicesRef.current.cameraId||undefined,encoderConfig:encoder})
        try {
          if(attempt!==generation.current){track.close();return}
          await connection.client.publish(track)
          if(attempt!==generation.current){track.close();return}
        } catch(error){track.close();throw error}
        report(kind,true)
        if(kind==='audio')mic.current=track as IMicrophoneAudioTrack
        else {
          camera.current=track as ICameraVideoTrack
          currentEncoder.current={track:camera.current,encoder}
        }
        track.on('track-ended',()=>{
          if(attempt!==generation.current||ref.current!==track)return
          ref.current=undefined
          publishingIntent.current[kind]=false
          void connection.client.unpublish(track).catch(()=>{}).finally(()=>track.close())
          if(kind==='audio')setMicOn(false)
          else {setCameraOn(false);setLocalVideo(undefined)}
          const ended=new DOMException('Track ended','NotFoundError')
          report(kind,false,ended)
          setError(callDeviceError(ended,kind,t))
        })
      }
      if(attempt!==generation.current)return false
      publishingIntent.current[kind]=!current
      if(kind==='audio')setMicOn(!current)
      else {setCameraOn(!current);setLocalVideo(camera.current)}
      return true
    }catch(error){
      if(attempt===generation.current){report(kind,false,error);setError(callDeviceError(error,kind,t))}
      return false
    }finally{localAction.current=false;setDeviceBusy(false)}
  }
  const canPublish=Boolean(connection&&network==='CONNECTED'&&connection.scope===scope&&speak&&connection.credentials.audio)
  const canVideo=Boolean(canPublish&&connection?.credentials.video&&media==='video'&&!audioOnly)
  const applyIntent=useRef(toggle);applyIntent.current=toggle
  useEffect(()=>{
    if(!canPublish||!connection?.credentials.encryption)return
    let current=true
    const restore=async()=>{
      if(publishingIntent.current.audio&&!mic.current)await applyIntent.current('audio',true)
      if(current&&canVideo&&publishingIntent.current.video&&!camera.current)await applyIntent.current('video',true)
    }
    void restore()
    return ()=>{current=false}
  },[connection,canPublish,canVideo])
  async function switchAudioOnly() {
    if(!audioOnly&&camera.current&&!(await toggle('video')))return
    setAudioOnly(value=>!value)
  }
  function resumeAudio(){
    connection?.resumeAudio()
    for(const peer of connection?.client.remoteUsers??[]){
      if(!filterPublishers||typeof peer.uid==='number'&&publisherPolicy.current.has(peer.uid))peer.audioTrack?.play()
    }
    setPlaybackBlocked(false)
  }
  return {connection,loading,error,quality,network,remote,levels,audioPeers,peerIds,micOn,cameraOn,deviceBusy,localVideo,permissions,
    videoQuality,setVideoQuality,audioProfile,setAudioProfile,stats,fallbackVideo,
    canPublish,canVideo,allowed,audioOnly,playbackBlocked,resumeAudio,switchAudioOnly,toggle,retry:()=>{setError('');setRequested(true)}}
}

async function routeAudio(track:IRemoteAudioTrack,device:string) {
  if(typeof HTMLMediaElement!=='undefined'&&'setSinkId' in HTMLMediaElement.prototype){
    await track.setPlaybackDevice(device||'default').catch(()=>{})
  }
}

export function CallVideo({track,local=false,waiting}:{track:IRemoteVideoTrack|ILocalVideoTrack;local?:boolean;waiting:ReactNode}) {
  const box=useRef<HTMLDivElement>(null)
  const [visibleTrack,setVisibleTrack]=useState<IRemoteVideoTrack|ILocalVideoTrack>()
  useEffect(()=>{
    const node=box.current
    if(!node)return
    const onFrame=()=>{
      const video=node.querySelector('video')
      if(video&&video.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA)setVisibleTrack(track)
    }
    node.addEventListener('loadeddata',onFrame,true)
    node.addEventListener('playing',onFrame,true)
    track.play(node,{fit:'cover',mirror:local})
    onFrame()
    return ()=>{
      node.removeEventListener('loadeddata',onFrame,true)
      node.removeEventListener('playing',onFrame,true)
      track.stop()
    }
  },[track,local])
  return <div className="call-tile-video" aria-hidden="true">
    <div ref={box} className="call-video-player"/>
    {visibleTrack!==track&&<div className="call-video-wait">{waiting}</div>}
  </div>
}
