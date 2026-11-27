import { useEffect, useRef, useState } from 'react'
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack, ILocalVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng'
import type { LessonCredentials, LessonView } from './lessons'
import { useWorkspace } from './ui'

type Connection = {client:IAgoraRTCClient; credentials:LessonCredentials}
export type CallDevices = {micId:string;cameraId:string;speakerId:string}
type Remote = {uid:number|string; track:IRemoteVideoTrack}
const mediaError=(error:unknown)=>['NotAllowedError','NotFoundError','NotReadableError','PERMISSION_DENIED','DEVICE_NOT_FOUND'].includes(String((error as {code?:string})?.code??(error as {name?:string})?.name))

export function useLessonRtc(lesson:LessonView,devices:CallDevices) {
  const {data,lessonRtc,t}=useWorkspace()
  const [requested,setRequested]=useState(true)
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
  const credentials=useRef(lessonRtc)
  credentials.current=lessonRtc
  const allowed=Boolean(data.lessonHealth?.rtcConfigured&&lesson.status==='live'&&lesson.self?.status==='admitted'
    &&!lesson.mediaChanging&&isSecureContext&&navigator.mediaDevices)
  const publishing=lesson.manager||data.user?.role==='teacher'&&['meeting','urgent'].includes(lesson.kind)||lesson.currentStudent===data.user?.id
  const speak=Boolean(publishing)
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
        const parameters=await credentials.current(lesson.id)
        if(!active())return
        const {default:sdk}=await import('agora-rtc-sdk-ng')
        if(!active())return
        sdk.setLogLevel(4)
        client=sdk.createClient({mode:'live',codec:'vp8'})
        const target=client
        target.on('connection-state-change',next=>{if(active())setNetwork(next)})
        target.on('network-quality',stats=>{if(active())setQuality(Math.max(stats.uplinkNetworkQuality,stats.downlinkNetworkQuality))})
        target.on('volume-indicator',values=>{
          if(active())setLevels(Object.fromEntries(values.map(item=>[String(item.uid),item.level])))
        })
        const refreshPeers=()=>{if(active())setPeerIds(target.remoteUsers.map(user=>user.uid))}
        const playbackBlocked=()=>{if(active())setPlaybackBlocked(true)}
        sdk.on('autoplay-failed',playbackBlocked)
        unbindPlayback=()=>sdk.off('autoplay-failed',playbackBlocked)
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
        refreshPeers()
        setConnection({client:target,credentials:parameters})
      }catch(error){
        if(active()){setRequested(false);setError((error as Error).message||t('تعذر الاتصال بالوسائط.','Could not connect to media.'))}
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
  },[lesson.id,lesson.self?.generation,requested,allowed,speak,lesson.media])

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
        if(kind==='audio')mic.current=track as IMicrophoneAudioTrack
        else camera.current=track as ICameraVideoTrack
      }
      if(attempt!==generation.current)return false
      if(kind==='audio')setMicOn(!current)
      else {setCameraOn(!current);setLocalVideo(camera.current)}
      return true
    }catch(error){
      if(attempt===generation.current)setError(mediaError(error)
        ?t('تحقّق من توصيل الجهاز وإذن استخدامه في المتصفح.','Check that your device is plugged in and allowed in the browser.')
        :t('تعذر تشغيل الوسائط. حاول مرة أخرى.','Could not use the device. Try again.'))
      return false
    }finally{localAction.current=false}
  }
  const canPublish=Boolean(connection&&speak&&connection.credentials.audio)
  const canVideo=Boolean(canPublish&&connection?.credentials.video&&lesson.media==='video'&&!audioOnly)
  async function switchAudioOnly() {
    if(!audioOnly&&camera.current&&!(await toggle('video')))return
    setAudioOnly(value=>!value)
  }
  function resumeAudio(){
    for(const peer of connection?.client.remoteUsers??[])peer.audioTrack?.play()
    setPlaybackBlocked(false)
  }
  return {connection,loading,error,quality,network,remote,levels,audioPeers,peerIds,micOn,cameraOn,localVideo,
    canPublish,canVideo,allowed,audioOnly,playbackBlocked,resumeAudio,switchAudioOnly,toggle,retry:()=>{setError('');setRequested(true)}}
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
