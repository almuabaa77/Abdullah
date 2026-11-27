import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video } from 'lucide-react'
import { callPeer, callState, defaultCommunication, idFor, type Chat, type ChatCall } from './domain'
import { Empty, Modal, useWorkspace } from './ui'

type Mode = ChatCall['mode']
type Peer = {id:string; mode:Mode; pc:RTCPeerConnection; local:MediaStream; published:boolean; remoteSet:boolean}
class CallNetworkError extends Error {}

async function description(pc:RTCPeerConnection,type:'offer'|'answer') {
  await pc.setLocalDescription(type==='offer'?await pc.createOffer():await pc.createAnswer())
  if(pc.iceGatheringState!=='complete')await new Promise<void>(resolve=>{
    const done=()=>{
      window.clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange',changed)
      resolve()
    }
    const changed=()=>{if(pc.iceGatheringState==='complete')done()}
    const timer=window.setTimeout(done,4500)
    pc.addEventListener('icegatheringstatechange',changed)
    changed()
  })
  const sdp=pc.localDescription?.sdp
  if(!sdp||!/^a=candidate:/m.test(sdp))throw new CallNetworkError()
  return sdp
}

function Stream({stream,video,muted=false}:{stream?:MediaStream;video:boolean;muted?:boolean}) {
  const media=useRef<HTMLMediaElement|null>(null)
  useEffect(()=>{if(media.current)media.current.srcObject=stream??null},[stream,video])
  return video?<video ref={node=>{media.current=node}} autoPlay playsInline muted={muted} controls={!muted}/>
    :<audio ref={node=>{media.current=node}} autoPlay controls/>
}

function closePeer(peer:Peer) {
  peer.pc.onconnectionstatechange=null
  peer.pc.ontrack=null
  peer.pc.close()
  peer.local.getTracks().forEach(track=>track.stop())
}

export function useChatCalls() {
  const {data,t,post,tell}=useWorkspace()
  const userId=data.user?.id??''
  const names=new Map(data.users.map(user=>[user.id,user.name]))
  const calls=data.calls??[]
  const [activeId,setActiveId]=useState('')
  const [local,setLocal]=useState<MediaStream>()
  const [remote,setRemote]=useState<MediaStream>()
  const [connected,setConnected]=useState(false)
  const [muted,setMuted]=useState(false)
  const [busy,setBusy]=useState(false)
  const [now,setNow]=useState(Date.now)
  const ref=useRef<Peer|undefined>(undefined)
  const mounted=useRef(true)
  const working=useRef(false)
  const postRef=useRef(post)
  postRef.current=post

  const supported=isSecureContext&&typeof RTCPeerConnection!=='undefined'&&Boolean(navigator.mediaDevices?.getUserMedia)
  const incoming=calls.find(call=>call.to===userId&&callState(call,now)==='ringing')
  const current=calls.find(call=>call.id===activeId)
  const activeStatus=current?callState(current,now):undefined

  function release() {
    const peer=ref.current
    if(peer)closePeer(peer)
    ref.current=undefined
    setActiveId('');setLocal(undefined);setRemote(undefined);setConnected(false);setMuted(false)
  }

  useEffect(()=>{
    mounted.current=true
    return ()=>{
      mounted.current=false
      const peer=ref.current
      if(!peer)return
      closePeer(peer)
      ref.current=undefined
      if(peer.published&&navigator.onLine)void postRef.current('call-end',{id:peer.id}).catch(()=>{})
    }
  },[])
  const ticking=Boolean(activeId||incoming)
  useEffect(()=>{
    if(!ticking)return
    const timer=window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[ticking])

  useEffect(()=>{
    const peer=ref.current
    if(!peer||!current)return
    if(activeStatus!=='ringing'&&activeStatus!=='accepted') {
      release()
      if(activeStatus==='missed'||activeStatus==='declined')tell(activeStatus==='missed'?t('لم يتم الرد على المكالمة','No answer'):t('رُفضت المكالمة','Call declined'))
      return
    }
    if(current.from===userId&&activeStatus==='accepted'&&current.answer&&!peer.remoteSet) {
      peer.remoteSet=true
      void peer.pc.setRemoteDescription({type:'answer',sdp:current.answer}).catch(()=>{
        if(ref.current!==peer)return
        void postRef.current('call-end',{id:peer.id}).catch(()=>{})
        release()
        tell(t('تعذر إنشاء الاتصال','Could not connect the call'),true)
      })
    }
  },[current,activeStatus,userId])

  useEffect(()=>{
    if(activeStatus!=='accepted'||connected)return
    const peer=ref.current
    const timer=window.setTimeout(()=>{
      if(!peer||ref.current!==peer)return
      void postRef.current('call-end',{id:peer.id}).catch(()=>{})
      release()
      tell(t('تعذر الاتصال على هذه الشبكة','The call could not connect on this network'),true)
    },22000)
    return ()=>window.clearTimeout(timer)
  },[activeStatus,connected])

  async function openPeer(id:string,mode:Mode) {
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==='video'})
    if(!mounted.current){stream.getTracks().forEach(track=>track.stop());throw new Error('Call view closed')}
    let pc:RTCPeerConnection
    try {pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]})}
    catch(error){stream.getTracks().forEach(track=>track.stop());throw error}
    const peer:Peer={id,mode,pc,local:stream,published:false,remoteSet:false}
    ref.current=peer
    setActiveId(id)
    setLocal(stream)
    pc.ontrack=event=>{if(ref.current===peer)setRemote(event.streams[0]??new MediaStream([event.track]))}
    pc.onconnectionstatechange=()=>{
      if(ref.current!==peer)return
      setConnected(pc.connectionState==='connected')
      if(pc.connectionState==='failed') {
        if(peer.published)void postRef.current('call-end',{id}).catch(()=>{})
        release()
        tell(t('تعذر الاتصال على هذه الشبكة','The call could not connect on this network'),true)
      }
    }
    stream.getTracks().forEach(track=>pc.addTrack(track,stream))
    return peer
  }

  async function withPeer(id:string,mode:Mode,setup:(peer:Peer)=>Promise<void>) {
    if(working.current||ref.current||!supported||!navigator.onLine)return
    working.current=true
    setBusy(true)
    try {
      const peer=await openPeer(id,mode)
      await setup(peer)
      peer.published=true
      if(!mounted.current||ref.current!==peer)void postRef.current('call-end',{id}).catch(()=>{})
    } catch(error) {
      if(!mounted.current)return
      release()
      const denied=error instanceof DOMException&&(error.name==='NotAllowedError'||error.name==='SecurityError')
      tell(error instanceof CallNetworkError?t('لم يجد المتصفح مسارًا مباشرًا للمكالمة على هذه الشبكة.','The browser could not find a direct route for the call on this network.')
        :denied?t('اسمح باستخدام الميكروفون والكاميرا المطلوبة من إعدادات الجهاز.','Allow the required microphone or camera in device settings.')
        :error instanceof DOMException?t('تعذر تجهيز الاتصال أو الوصول إلى جهاز الصوت والصورة.','Could not prepare the call or access your media device.')
        :(error as Error).message,true)
    } finally {
      working.current=false
      if(mounted.current)setBusy(false)
    }
  }

  function start(chat:Chat,mode:Mode) {
    if(!data.rules.chat||!(data.rules.communication??defaultCommunication)[mode]||!callPeer(chat,userId)||incoming)return
    const id=idFor()
    void withPeer(id,mode,async peer=>{
      const offer=await description(peer.pc,'offer')
      if(ref.current!==peer)return
      await postRef.current('call-start',{id:chat.id,mode,offer},id)
    })
  }
  function answer(call:ChatCall) {
    if(!call.offer)return
    void withPeer(call.id,call.mode,async peer=>{
      await peer.pc.setRemoteDescription({type:'offer',sdp:call.offer})
      peer.remoteSet=true
      const answer=await description(peer.pc,'answer')
      if(ref.current!==peer)return
      await postRef.current('call-answer',{id:call.id,answer})
    })
  }
  function end(id:string) {
    if(busy)return
    release()
    void postRef.current('call-end',{id}).catch(error=>tell((error as Error).message,true))
  }
  const name = (call:ChatCall) => names.get(call.from===userId?call.to:call.from)
    ??data.chats.find(chat=>chat.id===call.chatId)?.title??t('عضو الحلقة','Circle member')
  const inCall=Boolean(activeId)
  const dialog=inCall?<Modal title={current?name(current):t('جارٍ تجهيز المكالمة','Preparing call')} close={()=>{if(!busy)end(activeId)}} appearance="call-dialog">
    <div className="modal-body call-media">
      <p role="status">{connected?t('متصل','Connected'):activeStatus==='ringing'?t('بانتظار الرد','Ringing'):t('جارٍ الاتصال','Connecting')}</p>
      {ref.current?.mode==='video'&&local&&<Stream stream={local} video muted/>}
      {remote&&<Stream stream={remote} video={ref.current?.mode==='video'}/>}
    </div>
    <div className="modal-foot">
      <button className="btn btn-outline" type="button" aria-pressed={muted} onClick={()=>{
        local?.getAudioTracks().forEach(track=>{track.enabled=muted})
        setMuted(!muted)
      }}>{muted?<MicOff size={17}/>:<Mic size={17}/>} {muted?t('تشغيل الميكروفون','Unmute'):t('كتم الصوت','Mute')}</button>
      <button className="btn btn-outline danger" type="button" disabled={busy} onClick={()=>end(activeId)}><PhoneOff size={17}/>{t('إنهاء المكالمة','End call')}</button>
    </div>
  </Modal>:incoming?<Modal title={t('مكالمة واردة','Incoming call')} close={()=>end(incoming.id)}>
    <div className="modal-body"><strong>{name(incoming)}</strong><p>{incoming.mode==='video'?t('مكالمة مرئية','Video call'):t('مكالمة صوتية','Voice call')}</p></div>
    <div className="modal-foot">
      <button className="btn btn-outline" type="button" onClick={()=>end(incoming.id)}><PhoneOff size={17}/>{t('رفض','Decline')}</button>
      <button className="btn btn-primary" type="button" disabled={!supported||busy} onClick={()=>answer(incoming)}><Phone size={17}/>{t('رد على المكالمة','Answer')}</button>
    </div>
  </Modal>:null

  return {supported,busy:busy||inCall,start,dialog,calls,now,name,end}
}

export function ChatCallList({calls,now,name,supported,openChats,end}:{calls:ChatCall[];now:number;name:(call:ChatCall)=>string;supported:boolean;openChats:()=>void;end:(id:string)=>void}) {
  const {en,t,data}=useWorkspace()
  const date=new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-ca-gregory',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'})
  const statuses={
    ringing:t('بانتظار الرد','Ringing'),accepted:t('جارية','In progress'),declined:t('مرفوضة','Declined'),ended:t('انتهت','Ended'),missed:t('فائتة','Missed'),
  }
  return <div className="messenger-tab-content">
    <h2>{t('سجل المكالمات','Call history')}</h2>
    {!supported&&<p className="hint-line">{t('الاتصال الصوتي والمرئي غير متاح في هذا المتصفح.','Audio and video calls are unavailable in this browser.')}</p>}
    {calls.map(call=><div className="messenger-contact" key={call.id}>
      <span className="stat-icon tint-green">{call.mode==='video'?<Video size={18}/>:<Phone size={18}/>}</span>
      <div><strong>{name(call)}</strong><p>{call.from===data.user?.id?t('صادرة','Outgoing'):t('واردة','Incoming')} · {date.format(new Date(call.startedAt))}</p></div>
      <span className="badge">{statuses[callState(call,now)]}</span>
      {(callState(call,now)==='accepted'||call.from===data.user?.id&&callState(call,now)==='ringing')&&<button type="button" className="icon-button danger" aria-label={t('إنهاء المكالمة','End call')} onClick={()=>end(call.id)}><PhoneOff size={18}/></button>}
    </div>)}
    {!calls.length&&<Empty title={t('لا توجد مكالمات بعد','No calls yet')}
      body={t('ابدأ مكالمة من محادثة فردية متاحة.','Start a call from an eligible direct conversation.')}
      action={<button type="button" className="btn btn-outline compact" onClick={openChats}>{t('عرض المحادثات','View conversations')}</button>}/>}
  </div>
}
