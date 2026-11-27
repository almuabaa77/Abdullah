import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react'
import { Activity, ArrowDown, ArrowLeft, ArrowUp, AudioLines, BookOpen, CalendarDays, Check, ChevronRight, ChevronUp, Clock3, Ellipsis, Grid2X2, Hand, Home, ListOrdered, Maximize2, MessageSquare, Mic, MicOff, Minimize2, PanelRightClose, PhoneOff, Settings, ShieldCheck, Signal, Trophy, User, Users, Video, VideoOff, X } from 'lucide-react'
import { recitationAssignment, segmentLabel } from './domain'
import { CallVideo, useLessonRtc, type CallAudioProfile, type CallDevices, type CallVideoQuality } from './lesson-rtc'
import type { LessonPerson, LessonView } from './lessons'
import { CallPermissionStatus } from './lesson-permissions'
import { Brand, Modal, useWorkspace } from './ui'
import './lesson-call.css'

export type SaveLesson = (action:string,values:Record<string,unknown>)=>Promise<boolean>
type CallPanel = 'queue'|'people'|'messages'|'settings'|'assignment'
type Rtc = ReturnType<typeof useLessonRtc>
const clock=(seconds:number)=>[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(part=>String(part).padStart(2,'0')).join(':')
const secondsSince=(at:string|undefined,now:number)=>at?Math.max(0,Math.floor((now-Date.parse(at))/1000)):0
const initials=(name:string)=>name.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('')

export function CallAvatar({name}:{name:string}) {
  return <span className="call-avatar" aria-hidden="true">{initials(name)||<User size={25}/>}</span>
}
export function CallRole({role}:{role:LessonPerson['role']}) {
  const {t}=useWorkspace()
  const Icon=role==='admin'?ShieldCheck:role==='teacher'?BookOpen:User
  return <span className={'call-role call-role-'+role}><Icon size={13} aria-hidden="true"/>{role==='admin'?t('المدير','Administrator'):role==='teacher'?t('المحفّظ','Teacher'):t('طالب','Student')}</span>
}
export function useCallClock(step=1000,enabled=true) {
  const offset=useWorkspace().data.clockOffsetMs??0
  const [now,setNow]=useState(()=>Date.now()+offset)
  useEffect(()=>{
    if(!enabled)return
    const resume=()=>setNow(Date.now()+offset)
    resume()
    const timer=window.setInterval(resume,step)
    window.addEventListener('focus',resume)
    document.addEventListener('visibilitychange',resume)
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)}
  },[step,enabled,offset])
  return now
}
function LessonAssignments({lesson,studentId,showEmpty=false}:{lesson:LessonView;studentId?:string;showEmpty?:boolean}) {
  const {data,t,en}=useWorkspace()
  const assignment=studentId?recitationAssignment(data.daily,studentId,lesson.localDate,data.circles.find(circle=>circle.id===lesson.circleId)):undefined
  if(!assignment||!assignment.nextMemorization.length&&!assignment.nextReview.length)return showEmpty
    ?<p className="muted">{studentId?t('لا يوجد مقرر مسجّل لهذه الجلسة.','No assignment was recorded for this session.'):t('يظهر مقرر الطالب عند بدء دوره.','The assignment appears when a student’s turn starts.')}</p>:null
  return <div className="call-assignment"><BookOpen size={18}/><div>
    {!!assignment.nextMemorization.length&&<p><strong>{t('الحفظ','Memorization')}</strong> · {segmentLabel(assignment.nextMemorization,en)}</p>}
    {!!assignment.nextReview.length&&<p><strong>{t('المراجعة','Revision')}</strong> · {segmentLabel(assignment.nextReview,en)}</p>}
  </div></div>
}

function JoinBadge({order}:{order?:number}) {
  const {t}=useWorkspace()
  if(!order)return null
  const label=order===1?t('أول طالب انضم','First student to join'):t(`ترتيب الانضمام ${order}`,`Join order ${order}`)
  return <span className="call-join-badge" data-first={order===1} title={label} role="img" aria-label={label}>
    {order===1&&<Trophy size={13} aria-hidden="true"/>}<bdi aria-hidden="true">#{order}</bdi>
  </span>
}

function ParticipantTile({person,rtc,self,current,dominant=false,zoomed,toggleZoom}:{
  person:LessonPerson;rtc:Rtc;self:boolean;current:boolean;dominant?:boolean;zoomed:boolean;toggleZoom:()=>void
}) {
  const {t}=useWorkspace()
  const press=useRef<{id:number;x:number;y:number;time:number}|undefined>(undefined)
  const lastTap=useRef<{x:number;y:number;time:number}|undefined>(undefined)
  const lastTouchAt=useRef(-Infinity)
  const uid=person.mediaUid
  const fallback=!self&&uid!==undefined&&rtc.fallbackVideo.includes(uid)
  const track=self?rtc.localVideo:uid===undefined||fallback?undefined:rtc.remote.find(item=>item.uid===uid)?.track
  const mic=self?rtc.micOn:uid!==undefined&&rtc.audioPeers.includes(uid)
  const level=rtc.levels[String(self?rtc.connection?.credentials.uid:uid)]??0
  const Microphone=mic?Mic:MicOff
  const ZoomIcon=zoomed?Minimize2:Maximize2
  const micLabel=mic?t('الميكروفون يعمل','Microphone on'):t('الميكروفون مكتوم','Microphone muted')
  const zoomLabel=zoomed?t('الرجوع إلى البطاقات','Return to participant tiles')
    :t(`تكبير بطاقة ${person.name}`,`Enlarge ${person.name}’s tile`)
  const isControl=(target:EventTarget|null)=>target instanceof Element&&Boolean(target.closest('button'))
  function startTap(event:PointerEvent) {
    if(event.pointerType==='mouse'||!event.isPrimary||isControl(event.target))return
    press.current={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}
  }
  function finishTap(event:PointerEvent) {
    if(event.pointerType==='mouse'||!event.isPrimary)return
    const start=press.current
    press.current=undefined
    const time=performance.now(),x=event.clientX,y=event.clientY
    lastTouchAt.current=time
    if(!start||start.id!==event.pointerId||time-start.time>300||Math.hypot(x-start.x,y-start.y)>18){
      lastTap.current=undefined
      return
    }
    const previous=lastTap.current
    if(previous&&time-previous.time<350&&Math.hypot(x-previous.x,y-previous.y)<30){
      lastTap.current=undefined
      toggleZoom()
    }else lastTap.current={time,x,y}
  }
  return <article className={'call-tile call-tile-'+person.role+(current?' call-tile-current':'')+(track?' has-video':'')+
    (dominant?' call-tile-primary':'')+(zoomed?' call-tile-zoomed':'')} aria-label={person.name}
    onDoubleClick={event=>{if(!isControl(event.target)&&performance.now()-lastTouchAt.current>450)toggleZoom()}}
    onPointerDown={startTap} onPointerUp={finishTap}
    onPointerCancel={()=>{press.current=undefined;lastTap.current=undefined}}>
    <div className="call-video-frame">
      {track?<CallVideo track={track} local={self} waiting={<><CallAvatar name={person.name}/><small>{t('جارٍ تشغيل الفيديو…','Starting video…')}</small></>}/>
        :<div className="call-tile-placeholder"><CallAvatar name={person.name}/></div>}
      <div className="call-tile-top">
        <div>{current&&<span className="call-now"><AudioLines size={15}/>{t('يسمّع الآن','Reciting now')}</span>}
          <JoinBadge order={person.joinOrder}/></div>
        <button className="call-tile-zoom" type="button" title={zoomLabel} aria-label={zoomLabel} onClick={toggleZoom}><ZoomIcon size={18}/></button>
      </div>
      {fallback&&<span className="call-audio-fallback"><Signal size={13}/>{t('صوت فقط لاتصال ضعيف','Audio over a weak connection')}</span>}
    </div>
    <div className="call-tile-footer">
      <div className="call-tile-name"><strong dir="auto">{person.name}{self&&<small> · {t('أنت','You')}</small>}</strong><CallRole role={person.role}/>
        {person.role==='admin'&&!mic&&<small className="call-monitor">{t('متابع','Observing')}</small>}
      </div>
      <div className="call-tile-audio">
        {mic&&level>5&&<span className="call-volume" role="meter" aria-label={t('مستوى الصوت','Volume')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
          {[.45,.75,1,.66,.43].map((scale,index)=><i key={index} style={{height:3+scale*level*.15}}/>)}</span>}
        <span className={'call-mic-state'+(mic?' on':'')} title={micLabel} aria-label={micLabel}><Microphone size={16}/></span>
      </div>
    </div>
  </article>
}

function CallAction({icon,children,pressed,disabled,onClick,danger=false,desktop=false}:{icon:ReactNode;children:string;pressed?:boolean;disabled?:boolean;onClick:()=>void;danger?:boolean;desktop?:boolean}) {
  return <button type="button" className={'call-action'+(danger?' call-end':'')+(desktop?' call-desktop-action':'')} aria-label={children} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{icon}<span>{children}</span></button>
}

function CallQuality({rtc,video}:{rtc:Rtc;video:boolean}) {
  const {t}=useWorkspace()
  return <section className="call-quality-panel" aria-label={t('جودة الصوت والفيديو','Sound and video quality')}>
    <h3><Activity size={16}/>{t('جودة الاتصال','Connection quality')}</h3>
    {rtc.stats&&rtc.network==='CONNECTED'&&<dl className="call-quality-metrics">
      <div><dt>{t('الاستجابة','Latency')}</dt><dd>{rtc.stats.rtt>0?<><bdi>{rtc.stats.rtt}</bdi> {t('مللي ثانية','ms')}</>:'—'}</dd></div>
      <div><dt>{t('الإرسال','Upload')}</dt><dd><bdi>{Math.round(rtc.stats.send/1000)}</bdi> {t('ك.بت/ث','kbps')}</dd></div>
      <div><dt>{t('الاستقبال','Download')}</dt><dd><bdi>{Math.round(rtc.stats.receive/1000)}</bdi> {t('ك.بت/ث','kbps')}</dd></div>
    </dl>}
    <label>{t('نمط الميكروفون','Microphone profile')}
      <select aria-label={t('نمط الميكروفون','Microphone profile')} value={rtc.audioProfile} onChange={event=>rtc.setAudioProfile(event.target.value as CallAudioProfile)}>
        <option value="recitation">{t('التسميع · صوت طبيعي','Recitation · natural voice')}</option>
        <option value="speech">{t('المحادثة · تخفيف الضوضاء','Conversation · noise reduction')}</option>
      </select>
    </label>
    {rtc.micOn&&<p className="muted">{t('يُطبّق النمط عند تشغيل الميكروفون مرة أخرى.','The profile applies the next time you turn on the microphone.')}</p>}
    {video&&<label>{t('جودة الفيديو','Video quality')}
      <select aria-label={t('جودة الفيديو','Video quality')} value={rtc.videoQuality} onChange={event=>rtc.setVideoQuality(event.target.value as CallVideoQuality)}>
        <option value="auto">{t('تلقائية · توازن الجودة والسرعة','Auto · balanced quality')}</option>
        <option value="high">{t('عالية · حتى 720p','High · up to 720p')}</option>
        <option value="data">{t('توفير البيانات','Data saver')}</option>
      </select>
    </label>}
  </section>
}

export function LessonDeviceOptions({devices,setDevices,sources}:{devices:CallDevices;setDevices:(devices:CallDevices)=>void;sources:MediaDeviceInfo[]}) {
  const {t}=useWorkspace()
  const variants=[
    {key:'micId',kind:'audioinput',label:t('الميكروفون','Microphone')},
    {key:'cameraId',kind:'videoinput',label:t('الكاميرا','Camera')},
    {key:'speakerId',kind:'audiooutput',label:t('السماعة','Speaker')},
  ] as const
  return <div className="call-devices">{variants.filter(item=>sources.some(device=>device.kind===item.kind&&device.deviceId)).map(({key,kind,label})=>
    <label key={key}>{label}<select value={devices[key]} onChange={event=>setDevices({...devices,[key]:event.target.value})}>
      <option value="">{t('الجهاز الافتراضي','System default')}</option>
      {sources.filter(device=>device.kind===kind&&device.deviceId&&device.deviceId!=='default').map((device,index)=><option value={device.deviceId} key={device.deviceId}>{device.label||label+' '+(index+1)}</option>)}
    </select></label>)}</div>
}

export function LessonCall({lesson,save,busy,devices,setDevices,close,error}:{lesson:LessonView;save:SaveLesson;busy:boolean;devices:CallDevices;setDevices:(value:CallDevices)=>void;close:()=>void;error:string}) {
  const {data,en,t,open,go}=useWorkspace()
  const now=useCallClock()
  const [panel,setPanel]=useState<CallPanel>('queue')
  const [peek,setPeek]=useState<'queue'|'people'>('queue')
  const [sheet,setSheet]=useState(false)
  const [smallLayout,setSmallLayout]=useState(()=>window.matchMedia('(max-width: 970px)').matches)
  const [showSide,setShowSide]=useState(true)
  const [menu,setMenu]=useState(false)
  const [grid,setGrid]=useState(false)
  const [page,setPage]=useState(0)
  const [enlarged,setEnlarged]=useState<string>()
  const rtc=useLessonRtc(lesson,devices,enlarged)
  const [confirm,setConfirm]=useState<{kind:'end'|'delete';revision:number}>()
  const [message,setMessage]=useState('')
  const [sources,setSources]=useState<MediaDeviceInfo[]>([])
  const feed=useRef<HTMLDivElement>(null)
  const layout=useRef<HTMLDivElement>(null)
  const stage=useRef<HTMLElement>(null)
  const beforeZoom=useRef(0)
  const panelControl=useRef<HTMLDivElement>(null)
  const panelTrigger=useRef<HTMLElement|null>(null)
  const actor=(action:string,extra:Record<string,unknown>={})=>save(action,{id:lesson.id,...extra})
  const showPanel=(next:CallPanel)=>{
    if(!sheet&&document.activeElement instanceof HTMLElement)panelTrigger.current=document.activeElement
    setPanel(next);setSheet(true);setShowSide(true);setMenu(false)
    if(next==='settings')void navigator.mediaDevices?.enumerateDevices().then(setSources).catch(()=>{})
  }
  const priority={admin:0,teacher:1,student:2}
  const admitted=lesson.people.filter(person=>person.seat?.status==='admitted')
    .sort((a,b)=>priority[a.role]-priority[b.role]||(a.joinOrder??Infinity)-(b.joinOrder??Infinity))
  const zoomed=admitted.find(person=>person.id===enlarged)?.id
  useEffect(()=>{if(enlarged&&!zoomed)setEnlarged(undefined)},[enlarged,zoomed])
  function toggleZoom(id:string) {
    if(id===zoomed){
      setEnlarged(undefined)
      requestAnimationFrame(()=>{if(stage.current)stage.current.scrollTop=beforeZoom.current})
    }else{
      beforeZoom.current=stage.current?.scrollTop??0
      setEnlarged(id)
      if(stage.current)stage.current.scrollTop=0
    }
  }
  const waiting=lesson.manager?lesson.people.filter(person=>person.seat?.status==='waiting'):[]
  const queue=lesson.order.flatMap(id=>{
    const person=lesson.people.find(member=>member.id===id)
    return person?.role==='student'&&(person.seat?.status==='admitted'||lesson.finishedTurns?.includes(id)||person.seat?.periods.length)?[person]:[]
  })
  const current=admitted.find(person=>person.id===lesson.currentStudent)
  const currentRecord=lesson.manager?data.students.find(student=>student.id===current?.studentId):undefined
  const assignedStudent=lesson.manager?current?.studentId:data.user?.studentId
  const following=queue.filter(person=>person.seat?.status==='admitted'&&person.id!==current?.id&&!lesson.finishedTurns?.includes(person.id))
  const next=following[0]
  const displayedQueue=[...(current?[current]:[]),...queue.filter(person=>person.id!==current?.id)]
  const host=admitted.find(person=>person.id===lesson.teacherId)??admitted.find(person=>person.id===lesson.substituteId)??admitted.find(person=>person.role==='teacher')
  const lead=current??host??admitted.find(person=>person.id===data.user?.id)??admitted[0]
  const companion=admitted.length===2?admitted.find(person=>person.id!==lead?.id):undefined
  const hero=[lead,companion??host].filter((person,index,members):person is LessonPerson=>Boolean(person&&members.findIndex(member=>member?.id===person.id)===index))
  const audience=admitted.filter(person=>!hero.some(member=>member.id===person.id))
  const pageSize=grid?8:4
  const collection=grid?[...hero,...audience]:audience
  const pages=Math.max(1,Math.ceil(collection.length/pageSize))
  const shownPage=Math.min(page,pages-1)
  const shownTiles=collection.filter((person,index)=>person.id===zoomed||Math.floor(index/pageSize)===shownPage)
  const mediaActive=rtc.network==='CONNECTED'
  const knownPeers=new Set(admitted.map(person=>person.mediaUid))
  const connected=mediaActive?Math.max(lesson.connected,rtc.peerIds.filter(uid=>typeof uid==='number'&&knownPeers.has(uid)).length+1):lesson.connected
  const remaining=Math.max(0,Math.ceil((Date.parse(lesson.endsAt)-now)/1000))
  const endingSoon=remaining<=300
  const [lastAnnouncement,setLastAnnouncement]=useState('')
  useEffect(()=>{
    if(remaining>300){setLastAnnouncement('');return}
    if(remaining<=60)setLastAnnouncement(t('تبقّت دقيقة أو أقل على انتهاء الجلسة.','One minute or less remains in the session.'))
    else setLastAnnouncement(t('اقترب موعد انتهاء الجلسة.','The session is ending soon.'))
  },[endingSoon,remaining<=60,t])
  const offlineHost=Boolean(lesson.teacherId&&lesson.actualStart&&(now-Date.parse(lesson.actualStart)>55_000)&&!admitted.some(person=>
    (person.id===lesson.teacherId||person.id===lesson.substituteId)&&
    (mediaActive&&(person.id===data.user?.id||rtc.peerIds.includes(person.mediaUid??-1))||person.seat?.lastSeen&&now-Date.parse(person.seat.lastSeen)<55_000)))
  const modalSheet=sheet&&smallLayout
  const closeSheet=()=>{
    setSheet(false)
    if(modalSheet)requestAnimationFrame(()=>panelTrigger.current?.focus())
  }
  useEffect(()=>{
    if(panel==='messages'&&feed.current)feed.current.scrollTop=feed.current.scrollHeight
  },[panel,lesson.messages?.at(-1)?.id])
  useEffect(()=>{
    if(modalSheet)panelControl.current?.focus()
  },[modalSheet])
  useEffect(()=>{
    const small=window.matchMedia('(max-width: 970px)')
    const change=()=>{setSmallLayout(small.matches);setSheet(false)}
    small.addEventListener('change',change)
    return ()=>small.removeEventListener('change',change)
  },[])
  useEffect(()=>{
    const viewport=window.visualViewport
    if(!viewport)return
    const resize=()=>{
      if(viewport.scale<=1.05)layout.current?.style.setProperty('--call-visible-height',viewport.height+'px')
      else layout.current?.style.removeProperty('--call-visible-height')
    }
    resize()
    viewport.addEventListener('resize',resize)
    return ()=>viewport.removeEventListener('resize',resize)
  },[])
  async function send(event:FormEvent) {
    event.preventDefault()
    if(message.trim()&&await actor('lesson-message',{text:message}))setMessage('')
  }
  async function leave(home=false) {
    if(!busy&&await actor('lesson-leave')){
      close()
      if(home&&data.user?.role!=='admin')go('home')
    }
  }
  async function finish() {
    if(busy||!confirm)return
    if(confirm.kind==='delete'){
      if(await actor('lesson-delete',{revision:confirm.revision,confirmed:true}))close()
    }else if(await actor('lesson-end'))setConfirm(undefined)
  }
  async function answerMic(accept:boolean) {
    if(accept&&!rtc.micOn&&!(await rtc.toggle('audio')))return
    await actor('lesson-mic-answer')
  }
  const tabs:{id:CallPanel;label:string;icon:typeof Users}[]=[
    {id:'queue',label:t('دور التسميع','Recitation queue'),icon:ListOrdered},
    {id:'people',label:t('المشاركون','Participants'),icon:Users},
    {id:'messages',label:t('المحادثة','Chat'),icon:MessageSquare},
  ]
  const renderTile=(person:LessonPerson,dominant=false)=><ParticipantTile key={person.id} person={person} rtc={rtc} self={person.id===data.user?.id} current={person.id===current?.id} dominant={dominant} zoomed={person.id===zoomed} toggleZoom={()=>toggleZoom(person.id)}/>
  return <Modal title={lesson.title} appearance="call-shell" fullScreen close={()=>modalSheet?closeSheet():menu?setMenu(false):zoomed?toggleZoom(zoomed):void leave()}>
    <div ref={layout} className={'call-layout'+(!showSide?' call-side-collapsed':'')}>
      <nav className={'call-nav'+(menu?' call-nav-open':'')} aria-label={t('التنقل داخل المكالمة','Call navigation')}>
        <Brand/>
        {data.user?.role!=='admin'&&<button type="button" onClick={()=>void leave(true)} disabled={busy}><Home size={20}/>{t('الرئيسية','Home')}</button>}
        <button type="button" onClick={()=>void leave()} disabled={busy}><CalendarDays size={20}/>{t('المواعيد','Schedule')}</button>
        <button type="button" onClick={()=>showPanel('people')}><Users size={20}/>{t('المشاركون','Participants')}</button>
        <button type="button" aria-current="page" className="call-nav-selected" onClick={()=>{setMenu(false);closeSheet()}}><Video size={21}/>{t('المكالمة','Call')}</button>
        <button type="button" className="call-nav-mobile" onClick={()=>showPanel('messages')}><MessageSquare size={20}/>{t('المحادثة','Chat')}</button>
        <button type="button" onClick={()=>showPanel('assignment')}><BookOpen size={20}/>{t('المقرر','Assignment')}</button>
        <button type="button" onClick={()=>showPanel('settings')}><Settings size={20}/>{t('الإعدادات','Settings')}</button>
      </nav>
      <header className="call-head" inert={modalSheet}>
        <button type="button" className="call-small-button call-mobile-menu" aria-expanded={menu} aria-label={t('قائمة المكالمة','Call menu')} onClick={()=>setMenu(value=>!value)}><ChevronRight size={20}/></button>
        <h1>{lesson.title}</h1>
        <span className="call-live"><i/>{t('مباشر','Live')}</span>
        <button type="button" className="call-small-button call-mobile-people" aria-label={t('المشاركون','Participants')} onClick={()=>showPanel('people')}><Users size={21}/></button>
        <div className="call-meta">
          <span title={t('الوقت المنقضي','Elapsed time')}><Clock3 size={16}/><bdi>{clock(secondsSince(lesson.actualStart,now))}</bdi></span>
          <span className={endingSoon?'call-weak':''} title={t('الوقت المتبقي','Time remaining')} role="timer">
            {t('المتبقي','Remaining')} <bdi>{clock(remaining)}</bdi></span>
          <span>{lesson.media==='video'&&!rtc.audioOnly?<Video size={17}/>:<Mic size={16}/>} {lesson.media==='video'&&!rtc.audioOnly?t('صوت وفيديو','Audio and video'):t('صوت فقط','Audio only')}</span>
          <span className={(rtc.quality>=4||rtc.network==='RECONNECTING')?'call-weak':''}><Signal size={17}/>
            {rtc.network==='RECONNECTING'?t('جارٍ إعادة الاتصال','Reconnecting'):!mediaActive?t('الوسائط غير متصلة','Media offline'):rtc.quality>=4?t('اتصال ضعيف','Weak connection'):rtc.quality===1?t('اتصال ممتاز','Excellent connection'):rtc.quality?t('اتصال مستقر','Stable connection'):t('متصل','Connected')}</span>
          <button type="button" className="call-meta-people" onClick={()=>showPanel('people')}><Users size={17}/>{connected} {t('متصل','connected')}</button>
          {waiting.length>0&&<button className="call-wait-count" type="button" onClick={()=>showPanel('queue')}>{waiting.length} {t('بانتظار القبول','waiting')}</button>}
        </div>
      </header>
      <main ref={stage} className="call-stage" data-zoomed={Boolean(zoomed)} aria-label={t('مساحة التسميع','Recitation stage')} inert={modalSheet}>
        <span className="sr-only" role="status">{lastAnnouncement}</span>
        {endingSoon&&lesson.manager&&<div className="call-feedback">
          <p>{t('اقترب موعد انتهاء الجلسة.','The session is ending soon.')}</p>
          <button type="button" disabled={busy} onClick={()=>void actor('lesson-extend',{minutes:15})}>{t('تمديد 15 دقيقة','Extend by 15 minutes')}</button>
        </div>}
        {(!rtc.allowed||rtc.loading||rtc.error||error||rtc.playbackBlocked||offlineHost&&Boolean(data.lessonHealth?.rtcConfigured))&&<div className="call-feedback" aria-live="polite">
          {!data.lessonHealth?.rtcConfigured&&<p>{t('الصوت والفيديو في انتظار تفعيل Agora.','Audio and video require Agora activation.')}</p>}
          {lesson.mediaChanging&&data.lessonHealth?.rtcConfigured&&<p>{t('جارٍ تطبيق أذونات الوسائط.','Updating media permissions.')}</p>}
          {!rtc.allowed&&data.lessonHealth?.rtcConfigured&&!lesson.mediaChanging&&<p>{t('افتح المكالمة في متصفح يدعم الوسائط عبر اتصال آمن.','Open the call in a browser that supports media over a secure connection.')}</p>}
          {rtc.loading&&<p>{t('جارٍ الدخول إلى الوسائط…','Connecting to media…')}</p>}
          {rtc.error&&<p>{rtc.error}{rtc.allowed&&!rtc.connection&&<button type="button" onClick={rtc.retry}>{t('إعادة المحاولة','Retry')}</button>}</p>}
          {rtc.playbackBlocked&&<button type="button" onClick={rtc.resumeAudio}>{t('تشغيل صوت المكالمة','Enable call audio')}</button>}
          {offlineHost&&data.lessonHealth?.rtcConfigured&&<p>{t('المحفّظ غير متصل بالوسائط حاليًا.','The teacher is currently disconnected from media.')}</p>}
          {error&&<p role="alert">{error}</p>}
        </div>}
        {lesson.self?.micRequested&&<div className="call-mic-request">
          <p>{t('طلب المحفّظ تشغيل الميكروفون لدورك.','The teacher asked you to enable your microphone.')}</p>
          <button className="btn btn-primary compact" type="button" disabled={!rtc.canPublish||rtc.deviceBusy||busy} onClick={()=>void answerMic(true)}>{t('تشغيل الميكروفون','Enable microphone')}</button>
          <button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void answerMic(false)}>{t('ليس الآن','Not now')}</button>
        </div>}
        <div className={'call-mosaic'+(grid?' is-grid':'')+(zoomed?' is-zoomed':'')}>
          {!grid&&<div className={'call-hero'+(hero.length===1?' call-hero-single':'')}>{hero.map((person,index)=>renderTile(person,index===0))}</div>}
          <LessonAssignments lesson={lesson} studentId={assignedStudent}/>
          {collection.length>0&&<div className={'call-tiles'+(grid?' call-tiles-grid':'')}>{shownTiles.map(person=>renderTile(person))}</div>}
          {!grid&&next&&<button type="button" className="call-next" onClick={()=>showPanel('queue')}><ChevronRight size={17}/><strong>{t('التالي','Next')}</strong><span>{next.name}</span></button>}
          {!grid&&<section className="call-peek" aria-label={t('نظرة سريعة على المكالمة','Call at a glance')}>
            <div className="call-peek-grip"/>
            <div className="call-peek-tabs">
              <button type="button" aria-pressed={peek==='people'} onClick={()=>setPeek('people')}><Users size={16}/>{t('المشاركون','Participants')} ({admitted.length})</button>
              <button type="button" aria-pressed={peek==='queue'} onClick={()=>setPeek('queue')}><ListOrdered size={16}/>{t('دور التسميع','Recitation queue')}</button>
            </div>
            <ul className="call-peek-list">
              {(peek==='queue'?displayedQueue:admitted).slice(0,2).map(person=><li key={person.id} className={peek==='queue'&&person.id===current?.id?'current':''}>
                <CallAvatar name={person.name}/><strong>{person.name}</strong>
                {peek==='people'?<><CallRole role={person.role}/><JoinBadge order={person.joinOrder}/></>:person.id===current?.id
                  ?<><span>{t('الآن','Now')}</span><bdi>{clock(secondsSince(lesson.turnStartedAt,now)).slice(3)}</bdi></>
                  :person.id===next?.id&&<span>{t('التالي','Next')}</span>}
              </li>)}
              {peek==='queue'&&!displayedQueue.length&&<li>{t('بانتظار دخول الطلاب','Waiting for students')}</li>}
            </ul>
            <div className="call-peek-actions">
              <button type="button" onClick={()=>showPanel(peek)}><ChevronUp size={16}/>{t('عرض التفاصيل','View details')}</button>
              <button type="button" onClick={()=>showPanel('messages')}><MessageSquare size={16}/>{t('المحادثة','Chat')}</button>
            </div>
          </section>}
        </div>
        {pages>1&&!zoomed&&<div className="call-pagination">
          <button type="button" className="btn btn-outline compact" disabled={shownPage===0} onClick={()=>setPage(shownPage-1)}>{t('السابق','Previous')}</button>
          <span><bdi>{shownPage+1} / {pages}</bdi></span>
          <button type="button" className="btn btn-outline compact" disabled={shownPage+1===pages} onClick={()=>setPage(shownPage+1)}>{t('التالي','Next')}</button>
        </div>}
      </main>
      {modalSheet&&<button type="button" tabIndex={-1} className="call-sheet-shade" aria-label={t('إغلاق اللوحة','Close panel')} onClick={closeSheet}/>}
      <aside ref={panelControl} tabIndex={-1} aria-label={t('لوحة المكالمة','Call panel')} className={'call-side'+(sheet?' call-side-open':'')}>
        <div className="call-side-tabs">
          {tabs.map(({id,label,icon:Icon})=><button key={id} type="button" aria-pressed={panel===id} onClick={()=>setPanel(id)}><Icon size={17}/>{label}</button>)}
          <button type="button" className="call-small-button call-collapse" onClick={()=>setShowSide(false)} aria-label={t('طي لوحة المكالمة','Collapse panel')}><PanelRightClose size={17}/></button>
          <button type="button" className="call-small-button call-sheet-close" aria-label={t('إغلاق اللوحة','Close panel')} onClick={closeSheet}><X size={19}/></button>
        </div>
        {panel==='queue'&&<div className="call-panel-body">
          <h2>{t('دور التسميع','Recitation queue')}</h2>
          {current&&<div className="call-queue-actions"><bdi>{clock(secondsSince(lesson.turnStartedAt,now))}</bdi><small>{t('وقت الدور الحالي','Current turn elapsed')}</small></div>}
          {lesson.manager&&<div className="call-queue-actions">
            {next&&<button type="button" className="btn btn-primary compact" disabled={busy} onClick={()=>void actor('lesson-turn',{userId:next.id})}>{t('استدعاء التالي','Call next')}</button>}
            {current&&<><button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>void actor('lesson-turn')}>{t('إنهاء الدور','Finish turn')}</button>
              <button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>void actor('lesson-turn',{defer:true})}>{t('تأجيل الدور','Defer turn')}</button></>}
            {currentRecord&&lesson.localDate<=data.date&&<button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>
              open(currentRecord,data.daily.some(record=>record.studentId===currentRecord.id&&record.date===lesson.localDate)?'edit':'recite',{date:lesson.localDate})}>{t('سجل التسميع','Recitation record')}</button>}
          </div>}
          {!queue.length&&<p className="muted">{t('لا يوجد طلاب في الدور بعد.','No students in the queue yet.')}</p>}
          <ul className="call-roster">{displayedQueue.map(person=>{
            const isCurrent=person.id===current?.id
            const finished=lesson.finishedTurns?.includes(person.id)
            const recorded=finished&&data.daily.some(record=>record.studentId===(person.studentId??(person.id===data.user?.id?data.user.studentId:undefined))&&record.date===lesson.localDate&&(record.memorization.length||record.review.length))
            const disconnected=person.seat?.status!=='admitted'||person.seat.periods.length>0&&!person.seat.lastSeen
            const status=isCurrent?t('يسمّع الآن','Reciting now'):recorded?t('أتم التسميع','Recitation recorded'):finished?t('انتهى الدور','Turn completed'):disconnected?t('انقطع الاتصال','Disconnected'):person.id===next?.id?t('التالي','Next'):t('بانتظار الدور','Waiting for turn')
            const rank=following.findIndex(item=>item.id===person.id)
            return <li className={isCurrent?'current':''} key={person.id}>
              <CallAvatar name={person.name}/><div className="call-roster-name"><strong>{person.name}</strong><small>{status}{person.seat?.hand&&' · '+t('رفع يده','Hand raised')}</small></div>
              {lesson.manager&&person.seat?.status==='admitted'&&<div className="call-row-controls">
                {isCurrent?<button type="button" className="call-small-button" disabled={busy} title={t('طلب تشغيل الميكروفون','Request microphone')} aria-label={t('طلب تشغيل الميكروفون','Request microphone')} onClick={()=>void actor('lesson-mic-request',{userId:person.id})}><Mic size={17}/></button>:<>
                  <button type="button" className="call-small-button" disabled={busy} title={t('إعطاء الدور','Give turn')} aria-label={t('إعطاء الدور','Give turn')+' · '+person.name} onClick={()=>void actor('lesson-turn',{userId:person.id})}><Mic size={17}/></button>
                  {rank>=0&&<><button type="button" className="call-small-button" title={t('تقديم الدور','Move earlier')} aria-label={t('تقديم الدور','Move earlier')+' · '+person.name} disabled={busy||rank===0} onClick={()=>void actor('lesson-order',{userId:person.id,direction:'earlier'})}><ArrowUp size={15}/></button>
                    <button type="button" className="call-small-button" title={t('تأخير الدور','Move later')} aria-label={t('تأخير الدور','Move later')+' · '+person.name} disabled={busy||rank===following.length-1} onClick={()=>void actor('lesson-order',{userId:person.id,direction:'later'})}><ArrowDown size={15}/></button></>}
                </>}
              </div>}
            </li>
          })}</ul>
          {lesson.manager&&<section className="call-waiting">
            <h3><Users size={17}/>{t('بانتظار القبول','Waiting for admission')} <span>{waiting.length}</span></h3>
            {!waiting.length&&<p className="muted">{t('لا توجد طلبات انضمام حالياً.','No join requests right now.')}</p>}
            <ul className="call-roster">{waiting.map(person=><li key={person.id}>
              <CallAvatar name={person.name}/><div className="call-roster-name"><strong>{person.name}</strong><small>{new Intl.DateTimeFormat(en?'en':'ar-SA',{timeStyle:'short',timeZone:lesson.zone}).format(new Date(person.seat!.at))}</small></div>
              <div className="call-row-controls">
                <button type="button" className="call-small-button call-accept" disabled={busy} onClick={()=>void actor('lesson-admit',{userId:person.id})} aria-label={t('قبول','Admit')+' · '+person.name}><Check size={19}/></button>
                <button type="button" className="call-small-button call-reject" disabled={busy} onClick={()=>void actor('lesson-decline',{userId:person.id})} aria-label={t('رفض','Decline')+' · '+person.name}><X size={19}/></button>
              </div>
            </li>)}</ul>
          </section>}
        </div>}
        {panel==='people'&&<div className="call-panel-body"><h2>{t('المشاركون','Participants')} <span>{admitted.length}</span></h2>
          <ul className="call-roster">{admitted.map(person=><li key={person.id}>
            <CallAvatar name={person.name}/><div className="call-roster-name"><strong>{person.name}</strong><CallRole role={person.role}/></div><JoinBadge order={person.joinOrder}/>
            {lesson.manager&&person.role==='student'&&<button className="call-small-button call-reject" type="button" disabled={busy} aria-label={t('استبعاد','Remove')+' · '+person.name} onClick={()=>{if(window.confirm(t('استبعاد هذا المشارك من الجلسة؟','Remove this participant from the session?')))void actor('lesson-remove',{userId:person.id})}}><X size={17}/></button>}
          </li>)}</ul>
        </div>}
        {panel==='messages'&&<div className="call-chat">
          <div ref={feed} className="call-chat-messages" role="log" aria-label={t('رسائل الجلسة','Session messages')}>
            {!lesson.messages?.length&&<p className="muted">{t('لا توجد رسائل بعد.','No messages yet.')}</p>}
            {lesson.messages?.map(item=><div key={item.id} className={'call-message'+(item.from===data.user?.id?' own':'')}>
              <strong>{lesson.people.find(person=>person.id===item.from)?.name??t('مشارك','Participant')}</strong><p dir="auto">{item.text}</p></div>)}
          </div>
          <form className="call-compose" onSubmit={send}>
            <input aria-label={t('رسالة للجلسة','Session message')} placeholder={t('اكتب رسالة…','Write a message…')} value={message} maxLength={1000} onChange={event=>setMessage(event.target.value)} />
            <button className="btn btn-primary compact" disabled={busy||!message.trim()}>{t('إرسال','Send')}</button>
          </form>
        </div>}
        {panel==='settings'&&<div className="call-panel-body call-settings">
          <h2>{t('إعدادات المكالمة','Call settings')}</h2>
          <div className="call-view" role="group" aria-label={t('طريقة العرض','Layout')}>
            <button type="button" aria-pressed={!grid} onClick={()=>{setGrid(false);setPage(0);closeSheet()}}><Maximize2 size={15}/>{t('التركيز','Focus')}</button>
            <button type="button" aria-pressed={grid} onClick={()=>{setGrid(true);setPage(0);closeSheet()}}><Grid2X2 size={15}/>{t('الشبكة','Grid')}</button>
          </div>
          <CallPermissionStatus permissions={rtc.permissions} videoAllowed={lesson.media==='video'}/>
          <CallQuality rtc={rtc} video={lesson.media==='video'}/>
          <LessonDeviceOptions devices={devices} setDevices={setDevices} sources={sources}/>
          {lesson.media==='video'&&<button type="button" className="btn btn-outline compact" disabled={rtc.deviceBusy} onClick={()=>void rtc.switchAudioOnly()}>
            {rtc.audioOnly?t('استعادة الفيديو','Restore video'):t('التبديل إلى الصوت لتقليل استهلاك الشبكة','Use audio to save bandwidth')}</button>}
          {!rtc.connection&&rtc.allowed&&<button type="button" className="btn btn-outline compact" disabled={rtc.loading} onClick={rtc.retry}>{t('إعادة الاتصال بالوسائط','Reconnect media')}</button>}
          {lesson.manager&&<>
            {data.user?.role==='admin'&&<label>{t('سياسة الوسائط','Media policy')}<select value={lesson.media} disabled={busy} onChange={event=>void actor('lesson-media',{media:event.target.value})}>
              <option value="audio">{t('صوت فقط','Audio only')}</option><option value="video">{t('صوت وفيديو','Audio and video')}</option>
            </select></label>}
            <button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void actor('lesson-extend',{minutes:15})}>{t('تمديد 15 دقيقة','Extend by 15 minutes')}</button>
            {!confirm?<div className="chip-row">
              <button type="button" className="btn btn-outline compact lesson-danger" disabled={busy} onClick={()=>setConfirm({kind:'end',revision:lesson.revision})}>{t('إنهاء للجميع','End for everyone')}</button>
              <button type="button" className="btn btn-outline compact lesson-danger" disabled={busy} onClick={()=>setConfirm({kind:'delete',revision:lesson.revision})}>{t('إنهاء وحذف الموعد','End and delete schedule')}</button>
            </div>:<div className="call-confirm" role="group" aria-label={confirm.kind==='delete'?t('تأكيد حذف الموعد','Confirm schedule deletion'):t('تأكيد إنهاء الجلسة','Confirm session end')}>
              <p>{confirm.kind==='delete'?t('ستنتهي المكالمة للجميع، ويُحذف الموعد والملخص والرسائل نهائيًا.','Everyone will disconnect, and the schedule, summary, and messages will be permanently deleted.'):t('سينقطع الاتصال عن جميع المشاركين ويظهر ملخص الجلسة.','Everyone will disconnect and see the session summary.')}</p>
              <button className="btn lesson-delete-submit compact" type="button" disabled={busy} onClick={()=>void finish()}>{confirm.kind==='delete'?t('تأكيد الحذف','Confirm deletion'):t('تأكيد الإنهاء','Confirm end')}</button>
              <button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>setConfirm(undefined)}>{t('تراجع','Cancel')}</button>
            </div>}
          </>}
        </div>}
        {panel==='assignment'&&<div className="call-panel-body">
          <h2>{t('المقرر','Assignment')}</h2>
          <LessonAssignments lesson={lesson} studentId={assignedStudent} showEmpty/>
        </div>}
      </aside>
      <footer className="call-controls" inert={modalSheet}>
        <CallAction pressed={rtc.micOn} disabled={!rtc.canPublish||rtc.deviceBusy} icon={rtc.micOn?<Mic/>:<MicOff/>} onClick={()=>void rtc.toggle('audio')}>{t('الميكروفون','Microphone')}</CallAction>
        {lesson.media==='video'&&<CallAction pressed={rtc.cameraOn} disabled={!rtc.canVideo||rtc.deviceBusy} icon={rtc.cameraOn?<Video/>:<VideoOff/>} onClick={()=>void rtc.toggle('video')}>{t('الكاميرا','Camera')}</CallAction>}
        {data.user?.role==='student'&&<CallAction pressed={Boolean(lesson.self?.hand)} disabled={busy} icon={<Hand/>} onClick={()=>void actor('lesson-hand',{raised:!lesson.self?.hand})}>{lesson.self?.hand?t('خفض اليد','Lower hand'):t('رفع اليد','Raise hand')}</CallAction>}
        <CallAction desktop icon={<Users/>} onClick={()=>showPanel('people')}>{t('المشاركون','Participants')}</CallAction>
        <CallAction desktop icon={<MessageSquare/>} onClick={()=>showPanel('messages')}>{t('المحادثة','Chat')}</CallAction>
        <CallAction desktop icon={<Ellipsis/>} onClick={()=>showPanel('settings')}>{t('المزيد','More')}</CallAction>
        <CallAction danger disabled={busy} icon={<PhoneOff/>} onClick={()=>void leave()}>{t('مغادرة','Leave')}</CallAction>
      </footer>
    </div>
  </Modal>
}

export function LessonBack({close}:{close:()=>void}){
  const {t}=useWorkspace()
  return <button className="btn btn-outline" type="button" onClick={close}><ArrowLeft size={16}/>{t('العودة إلى المواعيد','Back to schedule')}</button>
}
