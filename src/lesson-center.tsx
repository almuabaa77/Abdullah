import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, CalendarDays, ChevronLeft, ChevronRight, Clock3, Headphones, Mic, Plus, Radio, Search, Users, Video, VideoOff } from 'lucide-react'
import { dateKey, dayOffset, hasCompletedRecitation, segmentLabel } from './domain'
import { CallAvatar, CallRole, LessonBack, LessonCall, LessonDeviceOptions, useCallClock, type SaveLesson } from './lesson-call'
import type { CallDevices } from './lesson-rtc'
import { lessonClosed, lessonInAgenda, type LessonKind, type LessonView } from './lessons'
import { Badge, Empty, Modal, dateLabel, normal, useWorkspace } from './ui'
import './lesson-center.css'

type PlanContext = {chatId?:string;circleId?:string;studentId?:string}
type Editor = {lesson?:LessonView; context?:PlanContext}
function planContext():PlanContext|undefined {
  try {return JSON.parse(sessionStorage.getItem('halaqat-plan-lesson')||'null')??undefined}
  catch {return undefined}
}
const lessonKey=(lesson:LessonView)=>lesson.localDate
const initialDevices:CallDevices={micId:'',cameraId:'',speakerId:''}
const statusName=(lesson:LessonView,t:(ar:string,en:string)=>string,now:number)=>lesson.status==='cancelled'||lesson.status==='scheduled'&&lessonClosed(lesson,now)?t('ملغاة','Cancelled'):lessonClosed(lesson,now)?t('انتهت','Ended'):lesson.status==='live'?t('جارية','Live'):t('مجدولة','Scheduled')
const duration=(from:string,to:string)=>Math.max(0,Math.round((Date.parse(to)-Date.parse(from))/60_000))
function formatted(stamp:string,zone:string,en:boolean,date=true) {
  return new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-ca-gregory-nu-latn',{dateStyle:date?'medium':undefined,timeStyle:'short',timeZone:zone}).format(new Date(stamp))
}
function localInput(stamp:string,zone:string) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(stamp))
}
function defaultClock() {
  const now=new Date()
  return {date:dateKey(now),start:localInput(now.toISOString(),'Asia/Riyadh'),end:localInput(new Date(+now+2*3600000).toISOString(),'Asia/Riyadh')}
}

function LessonEditor({editor,save,busy,close,error}:{editor:Editor;save:SaveLesson;busy:boolean;close:()=>void;error:string}) {
  const {data,t,en}=useWorkspace()
  const {lesson,context}=editor
  const admin=data.user?.role==='admin'
  const [kind,setKind]=useState<LessonKind>(lesson?.kind??(context?.studentId&&!context.circleId?'private':'circle'))
  const [circleId,setCircleId]=useState(lesson?.circleId??context?.circleId??data.students.find(student=>student.id===context?.studentId)?.circleId??data.circles[0]?.id??'')
  const [repeat,setRepeat]=useState('none')
  const [range,setRange]=useState('one')
  const now=defaultClock()
  const [meetingDate,setMeetingDate]=useState(lesson?.localDate??data.date)
  const circle=kind==='circle'||kind==='private'
  const staff=data.users.filter(user=>['admin','teacher'].includes(user.role)&&user.status==='active'&&!user.duplicateOf)
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields=new FormData(event.currentTarget)
    const values={...Object.fromEntries(fields),id:lesson?.id,chatId:lesson?.chatId??context?.chatId,repeat,range,
      invitees:fields.getAll('invitees'),reminders:fields.getAll('reminders'),weekdays:fields.getAll('weekdays'),
      except:String(fields.get('except')??'').split(/[\s,،]+/).filter(Boolean)}
    if(await save('lesson-save',values))close()
  }
  return <Modal title={lesson?t('تعديل موعد الجلسة','Edit session'):t('جدولة جلسة','Schedule a session')} close={()=>{if(!busy)close()}} wide appearance="lesson-editor">
    <form onSubmit={submit}>
      <div className="modal-body">
        <div className="field-pair">
          <label>{t('نوع الجلسة','Session type')}<select name="kind" value={kind} onChange={event=>setKind(event.target.value as LessonKind)}>
            <option value="circle">{t('تسميع حلقة','Circle recitation')}</option><option value="private">{t('تسميع خاص','Private recitation')}</option>
            {admin&&<><option value="meeting">{t('اجتماع إداري','Staff meeting')}</option><option value="urgent">{t('لقاء عاجل','Urgent meeting')}</option></>}
          </select></label>
          <label>{t('العنوان','Title')}<input name="title" maxLength={100} defaultValue={lesson?.title} placeholder={circle?data.circles.find(item=>item.id===circleId)?.name:undefined}/></label>
        </div>
        {circle&&<div className="field-pair">
          <label>{t('الحلقة','Circle')}<select name="circleId" value={circleId} onChange={event=>setCircleId(event.target.value)} required>
            <option value="">{t('اختر الحلقة','Select circle')}</option>{data.circles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {kind==='private'&&<label>{t('الطالب','Student')}<select key={circleId} name="studentId" defaultValue={lesson?.studentId??context?.studentId??''} required>
            <option value="">{t('اختر الطالب','Select student')}</option>{data.students.filter(student=>student.active&&student.circleId===circleId).map(student=><option key={student.id} value={student.id}>{student.name}</option>)}</select></label>}
        </div>}
        {admin&&<div className="field-pair">
          <label>{t('المحفّظ أو المنظّم','Teacher or host')}<select name="teacherId" defaultValue={lesson?.teacherId??''}>
            <option value="">{t('حسب الحلقة أو منشئ الموعد','Circle teacher or organizer')}</option>{staff.map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label>{t('المحفّظ البديل','Alternate teacher')}<select name="substituteId" defaultValue={lesson?.substituteId??''}>
            <option value="">{t('بدون بديل','No alternate')}</option>{staff.filter(user=>user.role==='teacher').map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        </div>}
        {!circle&&<fieldset className="lesson-checks"><legend>{t('المدعوون','Invitees')}</legend>
          {data.users.filter(user=>user.status==='active'&&(user.role==='teacher'||kind==='urgent'&&user.role==='student')).map(user=><label className="check-line" key={user.id}>
            <input type="checkbox" name="invitees" value={user.id} defaultChecked={Boolean(lesson?.people.some(person=>person.id===user.id&&person.id!==lesson.teacherId&&person.id!==lesson.substituteId))}/>{user.name}</label>)}
        </fieldset>}
        <div className="lesson-fields-grid">
          <label>{t('التاريخ','Date')}<input name="date" type="date" value={meetingDate} onChange={event=>setMeetingDate(event.target.value)} required/></label>
          <label>{t('البداية','Start')}<input name="start" type="time" defaultValue={lesson?localInput(lesson.startsAt,lesson.zone):now.start} required/></label>
          <label>{t('النهاية','End')}<input name="end" type="time" defaultValue={lesson?localInput(lesson.endsAt,lesson.zone):now.end} required/></label>
          <label>{t('المنطقة الزمنية','Time zone')}<input name="zone" defaultValue={lesson?.zone??'Asia/Riyadh'} maxLength={64} required dir="ltr"/></label>
          <label>{t('الوسائط','Media')}<select name="media" defaultValue={lesson?.media??'audio'}>
            <option value="audio">{t('صوت فقط','Audio only')}</option>{(admin||lesson?.media==='video')&&<option value="video">{t('صوت وفيديو','Audio and video')}</option>}</select></label>
          <label>{t('نافذة الدخول بالدقائق','Early entry in minutes')}<select name="roomMinutes" defaultValue={lesson?.roomMinutes??10}>
            {[0,5,10,15,30].map(minutes=><option key={minutes} value={minutes}>{minutes}</option>)}</select></label>
        </div>
        <fieldset className="lesson-checks"><legend>{t('التذكير','Reminders')}</legend>
          {[30,5,0].map(minutes=><label className="check-line" key={minutes}><input type="checkbox" name="reminders" value={minutes} defaultChecked={lesson?lesson.reminders.includes(minutes):true}/>
            {minutes?t(`قبل ${minutes} دقيقة`,`${minutes} minutes before`):t('عند البدء','At start')}</label>)}</fieldset>
        {lesson?.seriesId&&<label>{t('تطبيق التعديل على','Apply changes to')}<select value={range} onChange={event=>setRange(event.target.value)}>
          <option value="one">{t('هذا الموعد فقط','This session only')}</option><option value="future">{t('هذا الموعد وما بعده','This and later sessions')}</option><option value="all">{t('السلسلة القادمة كاملة','Entire upcoming series')}</option>
        </select></label>}
        {(!lesson||!lesson.seriesId||range!=='one')&&<label>{t('التكرار','Repeat')}<select value={repeat} onChange={event=>setRepeat(event.target.value)}>
          <option value="none">{lesson?.seriesId?t('احتفظ بالتكرار الحالي','Keep current recurrence'):t('مرة واحدة','Once')}</option><option value="daily">{t('يوميًا','Daily')}</option><option value="weekly">{t('أيام محددة أسبوعيًا','Selected weekdays')}</option></select></label>}
        {repeat!=='none'&&(!lesson?.seriesId||range!=='one')&&<>
          <label>{t('نهاية التكرار','Repeat until')}<input type="date" name="through" min={meetingDate} required/></label>
          {repeat==='weekly'&&<fieldset className="lesson-checks"><legend>{t('أيام التكرار','Weekdays')}</legend>
            {(en?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']).map((name,index)=><label className="check-line" key={name}><input type="checkbox" name="weekdays" value={index}/>{name}</label>)}
          </fieldset>}
          <label>{t('تواريخ الاستثناء','Excluded dates')}<input name="except" placeholder="YYYY-MM-DD"/></label>
        </>}
        {error&&<p className="error-box" role="alert">{error}</p>}
        <label>{t('ملاحظات المنظّم','Organizer notes')}<textarea name="notes" maxLength={400} defaultValue={lesson?.notes}/></label>
      </div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('حفظ الموعد','Save session')}</button></div>
    </form>
  </Modal>
}

function Prejoin({lesson,devices,setDevices,save,busy,now}:{lesson:LessonView;devices:CallDevices;setDevices:(value:CallDevices)=>void;save:SaveLesson;busy:boolean;now:number}) {
  const {data,t,en}=useWorkspace()
  const video=useRef<HTMLVideoElement>(null)
  const running=useRef<MediaStream|undefined>(undefined)
  const analyser=useRef<AudioContext|undefined>(undefined)
  const request=useRef(0)
  const [checking,setChecking]=useState(false)
  const [preview,setPreview]=useState(false)
  const [sources,setSources]=useState<MediaDeviceInfo[]>([])
  const [issue,setIssue]=useState('')
  const [audioLevel,setAudioLevel]=useState(0)
  const canCamera=lesson.media==='video'
  const seat=lesson.self?.status
  const canRequest=now>=Date.parse(lesson.startsAt)-lesson.roomMinutes*60_000
  const host=lesson.people.find(person=>person.id===lesson.teacherId)?.name
  const group=data.circles.find(circle=>circle.id===lesson.circleId)?.name
  function cleanDevices(){
    running.current?.getTracks().forEach(track=>track.stop())
    running.current=undefined
    if(video.current)video.current.srcObject=null
    if(analyser.current)void analyser.current.close().catch(()=>{})
    analyser.current=undefined
  }
  useEffect(()=>{
    void navigator.mediaDevices?.enumerateDevices().then(setSources).catch(()=>{})
    return ()=>{request.current++;cleanDevices()}
  },[])
  useEffect(()=>{
    if(seat!=='waiting'&&seat!=='admitted')return
    request.current++;cleanDevices();setPreview(false);setChecking(false);setAudioLevel(0)
  },[seat])
  async function testDevice(kind:'audio'|'video') {
    const id=++request.current
    cleanDevices();setChecking(true);setPreview(false);setIssue('');setAudioLevel(0)
    try {
      if(!navigator.mediaDevices)throw new Error('Unsupported')
      const stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:devices.micId?{deviceId:{exact:devices.micId}}:true}:
        {video:devices.cameraId?{deviceId:{exact:devices.cameraId}}:true})
      if(id!==request.current){stream.getTracks().forEach(track=>track.stop());return}
      running.current=stream
      if(kind==='video'&&video.current){video.current.srcObject=stream;setPreview(true)}
      if(kind==='audio'&&window.AudioContext){
        const audio=analyser.current=new AudioContext()
        const meter=audio.createAnalyser()
        meter.fftSize=128
        audio.createMediaStreamSource(stream).connect(meter)
        const values=new Uint8Array(meter.fftSize)
        const started=performance.now()
        const read=()=>{
          if(id!==request.current)return
          const elapsed=performance.now()-started
          if(elapsed>=5000){cleanDevices();setChecking(false);setAudioLevel(0);return}
          meter.getByteTimeDomainData(values)
          setAudioLevel(Math.min(100,Math.round(Math.max(...values.map(value=>Math.abs(value-128)))*2.7)))
          requestAnimationFrame(read)
        }
        read()
      }else {if(kind==='audio')cleanDevices();setChecking(false)}
      const devicesAvailable=await navigator.mediaDevices.enumerateDevices()
      if(id===request.current)setSources(devicesAvailable)
    }catch(error){
      if(id!==request.current)return
      cleanDevices();setChecking(false)
      setIssue(error instanceof DOMException&&error.name==='NotAllowedError'
        ?t('إذن الجهاز مرفوض. اسمح باستخدامه من إعدادات المتصفح ثم جرّب مجددًا.','Device access was denied. Allow it in your browser settings and try again.')
        :t('تعذر العثور على الجهاز أو تشغيله. افحص توصيله ثم أعد المحاولة.','Could not use the device. Check that it is connected and try again.'))
    }
  }
  async function testSpeaker(){
    let audio:AudioContext|undefined
    try{
      setIssue('')
      audio=new AudioContext()
      if(devices.speakerId&&'setSinkId' in audio)await (audio as AudioContext&{setSinkId:(id:string)=>Promise<void>}).setSinkId(devices.speakerId)
      await audio.resume()
      const tone=audio.createOscillator()
      const volume=audio.createGain()
      volume.gain.setValueAtTime(.13,audio.currentTime)
      volume.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.55)
      tone.frequency.value=550;tone.connect(volume);volume.connect(audio.destination)
      tone.onended=()=>{void audio?.close()}
      tone.start();tone.stop(audio.currentTime+.55)
    }catch{void audio?.close();setIssue(t('تعذر اختبار السماعة. تحقّق من مخرج الصوت.','Speaker test failed. Check your audio output.'))}
  }
  async function join(){
    request.current++;cleanDevices();setPreview(false);setChecking(false);setAudioLevel(0)
    await save('lesson-join',{id:lesson.id})
  }
  const awaiting=seat==='waiting'||seat==='admitted'
  const rejected=seat==='declined'||seat==='removed'
  return <div className="lesson-prejoin">
    <div className="lesson-prejoin-intro">
      <CallAvatar name={data.user?.name??''}/><div><h3>{data.user?.name}</h3><p>{[group,host].filter(Boolean).join(' · ')}</p>
        <small>{formatted(lesson.startsAt,lesson.zone,en)} · {formatted(lesson.endsAt,lesson.zone,en,false)}</small></div>
      <Badge status={lesson.status==='live'?'present':'pending'} label={statusName(lesson,t,now)}/>
    </div>
    {lesson.notes&&<p className="lesson-notes">{lesson.notes}</p>}
    {awaiting?<div className="lesson-wait-state" role="status">
      <span className="stat-icon tint-green"><Clock3 size={22}/></span>
      <strong>{seat==='waiting'?t('تم إرسال طلب الانضمام، بانتظار موافقة المحفّظ.','Join request sent. Waiting for the teacher to admit you.'):t('تم قبولك. ستبدأ المكالمة عند دخول المحفّظ.','Admitted. The call starts when the teacher joins.')}</strong>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void save('lesson-leave',{id:lesson.id})}>{t('إلغاء الطلب','Cancel request')}</button>
    </div>:rejected?<p className="error-box" role="status">{seat==='removed'?t('أُخرجت من الجلسة. يمكنك العودة إلى المواعيد.','You were removed. You can return to the schedule.'):t('لم يُقبل طلب الانضمام لهذه الجلسة.','The join request was declined.')}</p>:<>
      <div className="lesson-prejoin-preview">
        <video className={preview?'':'off'} muted autoPlay playsInline ref={video} aria-label={t('معاينة الكاميرا','Camera preview')}/>
        {!preview&&<><VideoOff size={25}/><span>{canCamera?t('الكاميرا مغلقة','Camera off'):t('هذه الجلسة صوتية','This session is audio only')}</span></>}
      </div>
      <div className="chip-row">
        <button type="button" className="btn btn-outline compact" disabled={checking||busy} onClick={()=>void testDevice('audio')}><Mic size={16}/>{t('اختبار الميكروفون','Test microphone')}</button>
        <button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>void testSpeaker()}><Headphones size={16}/>{t('اختبار السماعة','Test speaker')}</button>
        {canCamera&&<button type="button" className="btn btn-outline compact" disabled={checking||busy} onClick={()=>{
          if(preview){request.current++;cleanDevices();setPreview(false)}
          else void testDevice('video')
        }}><Video size={16}/>{preview?t('إيقاف المعاينة','Stop preview'):t('معاينة الكاميرا','Preview camera')}</button>}
      </div>
      {checking&&<progress max={100} value={audioLevel} aria-label={t('مستوى الميكروفون','Microphone level')}/>}
      <LessonDeviceOptions devices={devices} setDevices={value=>{request.current++;cleanDevices();setPreview(false);setChecking(false);setDevices(value)}} sources={canCamera?sources:sources.filter(device=>device.kind!=='videoinput')}/>
      {issue&&<p className="error-box" role="alert">{issue}</p>}
      {!canRequest&&<p className="hint-line">{t('لم تُفتح غرفة الانتظار بعد.','The waiting room is not open yet.')} · {formatted(new Date(Date.parse(lesson.startsAt)-lesson.roomMinutes*60_000).toISOString(),lesson.zone,en,false)}</p>}
      <button type="button" className="btn btn-primary lesson-join" disabled={!canRequest||busy} onClick={()=>void join()}>
        {lesson.manager?t('دخول الجلسة','Enter session'):t('طلب الانضمام','Request to join')}
      </button>
    </>}
    {lesson.manager&&<details className="lesson-invitees"><summary>{t('المدعوون','Invitees')} · {lesson.inviteCount}</summary>
      <ul>{lesson.people.filter(person=>person.role!=='admin').map(person=><li key={person.id}>{person.name}<CallRole role={person.role}/></li>)}</ul></details>}
  </div>
}

function LessonSummary({lesson,close}:{lesson:LessonView;close:()=>void}) {
  const {data,t,en,go,open}=useWorkspace()
  const cancelled=lesson.status==='cancelled'||!lesson.actualStart
  const elapsed=lesson.actualStart?duration(lesson.actualStart,lesson.actualEnd??lesson.endsAt):0
  const people=lesson.manager?lesson.people.filter(person=>person.role==='student'):lesson.people.filter(person=>person.id===data.user?.id)
  return <section className="lesson-summary">
    <div className="lesson-summary-head"><span className="stat-icon tint-green"><Clock3 size={22}/></span><div>
      <h3>{cancelled?t('أُغلق الموعد','Session closed'):t('انتهت الجلسة','Session ended')}</h3>
      {!cancelled&&<p>{t('مدة الجلسة','Session duration')} · {elapsed} {t('دقيقة','min')}</p>}
    </div></div>
    {people.map(person=>{
      const studentId=person.studentId??(person.id===data.user?.id?data.user.studentId:undefined)
      const record=studentId?data.daily.find(item=>item.studentId===studentId&&item.date===lesson.localDate):undefined
      const student=lesson.manager&&data.students.find(item=>item.id===studentId)
      const mediaMinutes=person.seat?.periods.reduce((total,period)=>total+duration(period.from,period.to??period.from),0)??0
      const recited=hasCompletedRecitation(record)
      const recitation=recited?t('تسميع مكتمل','Recitation completed'):record?.memorization.length||record?.review.length?t('تسميع مسجّل','Recitation recorded'):t('لم يسجل تسميع','No recitation recorded')
      return <article key={person.id} className="lesson-summary-person">
        <div className="split-line"><div><strong>{person.name}</strong><p>{person.seat?.periods.length?t('مدة اتصال الوسائط','Media attendance')+' · '+mediaMinutes+' '+t('دقيقة','min'):t('لا يوجد اتصال وسائط مسجّل','No recorded media connection')}</p></div>
          <div className="chip-row"><Badge status={recited?'complete':'pending'} label={recitation}/>{record&&<Badge status={record.attendance}/>}</div></div>
        {record&&(record.nextMemorization.length>0||record.nextReview.length>0)&&<div className="call-assignment">
          <CalendarDays size={17}/><div><strong>{t('المقرر القادم','Next assignment')}{record.nextDate&&' · '+dateLabel(record.nextDate,en)}</strong>
            {!!record.nextMemorization.length&&<p>{t('الحفظ','Memorization')} · {segmentLabel(record.nextMemorization,en)}</p>}
            {!!record.nextReview.length&&<p>{t('المراجعة','Revision')} · {segmentLabel(record.nextReview,en)}</p>}
          </div></div>}
        {student&&lesson.localDate<=data.date&&<button className="btn btn-outline compact" type="button" onClick={()=>open(student,record?'edit':'recite',{date:lesson.localDate})}>{t('سجل التسميع','Recitation record')}</button>}
      </article>
    })}
    <div className="chip-row"><LessonBack close={close}/>{lesson.chatId&&data.user?.role!=='admin'&&<button type="button" className="btn btn-outline" onClick={()=>{close();go('chat')}}>{t('العودة للمحادثات','Back to conversations')}</button>}</div>
  </section>
}

export function LessonCenter({management=false}:{management?:boolean}={}) {
  const {data,t,en,post,tell,refresh}=useWorkspace()
  const [date,setDate]=useState(data.date||dateKey())
  const [period,setPeriod]=useState<'day'|'week'|'month'>('day')
  const [circle,setCircle]=useState('')
  const [teacher,setTeacher]=useState('')
  const [filter,setFilter]=useState('')
  const [query,setQuery]=useState('')
  const [historyMode,setHistoryMode]=useState(false)
  const [devices,setDevices]=useState<CallDevices>(initialDevices)
  const now=useCallClock()
  const [selected,setSelected]=useState(()=>sessionStorage.getItem('halaqat-open-lesson')??new URLSearchParams(location.search).get('lesson')??'')
  const [editor,setEditor]=useState<Editor|undefined>(()=>{const context=planContext();return context?{context}:undefined})
  const [busy,setBusy]=useState(false)
  const working=useRef(false)
  const reload=useRef(refresh);reload.current=refresh
  const [limit,setLimit]=useState(25)
  const [error,setError]=useState('')
  const all=data.lessons??[]
  const focused=all.find(lesson=>lesson.id===selected)
  const canPlan=management||data.user?.role==='teacher'&&data.lessonTeacherScheduling
  useEffect(()=>{
    sessionStorage.removeItem('halaqat-open-lesson')
    sessionStorage.removeItem('halaqat-plan-lesson')
    const receive=()=>{const id=sessionStorage.getItem('halaqat-open-lesson');if(id)setSelected(id);sessionStorage.removeItem('halaqat-open-lesson')}
    window.addEventListener('halaqat-open-lesson',receive)
    return ()=>window.removeEventListener('halaqat-open-lesson',receive)
  },[])
  useEffect(()=>{
    if(!focused||lessonClosed(focused))return
    const timer=window.setInterval(()=>{if(!document.hidden)reload.current()},2500)
    return ()=>window.clearInterval(timer)
  },[focused?.id,focused?.status])
  useEffect(()=>setLimit(25),[date,period,circle,teacher,filter,query,historyMode])
  const weekdaysStart=dayOffset(date,-new Date(date+'T12:00:00Z').getUTCDay())
  const start=period==='week'?weekdaysStart:period==='month'?date.slice(0,7)+'-01':date
  const end=period==='week'?dayOffset(start,6):period==='month'?new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).toISOString().slice(0,10):date
  const nameFor=(lesson:LessonView)=>lesson.people.find(person=>person.id===lesson.teacherId)?.name??data.users.find(person=>person.id===lesson.teacherId)?.name??t('المحفّظ','Teacher')
  const circleFor=(lesson:LessonView)=>data.circles.find(item=>item.id===lesson.circleId)?.name
  const matches=(lesson:LessonView)=> (!circle||lesson.circleId===circle)&&(!teacher||lesson.teacherId===teacher)
    &&(!query||normal([lesson.title,circleFor(lesson),nameFor(lesson)].filter(Boolean).join(' ')).includes(normal(query)))
  const list=all.filter(lesson=>{
    const closed=lessonClosed(lesson,now)
    const status=closed?lesson.status==='cancelled'||!lesson.actualStart?'cancelled':'completed':lesson.status
    return matches(lesson)&&(!filter||status===filter)&&(historyMode?closed:lessonInAgenda(lesson,now)&&lessonKey(lesson)>=start&&lessonKey(lesson)<=end)
  })
  if(historyMode)list.sort((a,b)=>b.endsAt.localeCompare(a.endsAt))
  const live=all.filter(lesson=>lesson.status==='live'&&!lessonClosed(lesson,now)&&matches(lesson))
  const close=()=>{setSelected('');setError('')}
  const select=(id:string)=>{setError('');setSelected(id);setDevices(initialDevices)}
  async function save(action:string,values:Record<string,unknown>) {
    if(working.current)return false
    working.current=true;setBusy(true);setError('')
    try{await post(action,values);return true}
    catch(error){const message=(error as Error).message;setError(message);tell(message,true);return false}
    finally{working.current=false;setBusy(false)}
  }
  function exportAttendance() {
    if(!focused?.manager)return
    void import('./export').then(({exportWorkbook})=>exportWorkbook([
      [focused.title,focused.zone],
      [t('المشارك','Participant'),t('من','From'),t('إلى','To'),t('المدة بالدقائق','Minutes')],
      ...focused.people.flatMap(person=>person.seat?.periods.map(period=>[
        person.name,formatted(period.from,focused.zone,en),period.to?formatted(period.to,focused.zone,en):'',
        duration(period.from,period.to??person.seat?.lastSeen??period.from),
      ])??[]),
    ],'halaqat-session-'+focused.localDate,!en)).catch(error=>tell((error as Error).message,true))
  }
  return <div className="lesson-center page-stack">
    <section className="panel section-panel lesson-calendar">
      <div className="section-title"><div><h1>{t('المكالمات وجلسات التسميع','Calls and recitation')}</h1></div>
        {canPlan&&<button type="button" className="btn btn-primary" onClick={()=>{setError('');setEditor({})}}><Plus size={18}/>{t('جدولة مكالمة','Schedule a call')}</button>}
      </div>
      {!data.lessonHealth?.rtcConfigured&&<p className="hint-line">{t('الجدولة وغرفة الانتظار متاحتان. تفعيل الصوت والفيديو ينتظر إعدادات Agora.','Scheduling and the waiting room are available. Media requires Agora configuration.')}</p>}
      {management&&<div className="lesson-ops">
        <label className="check-line"><input type="checkbox" checked={Boolean(data.lessonTeacherScheduling)} disabled={busy} onChange={event=>void save('lesson-settings',{enabled:event.target.checked})}/>{t('السماح للمحفّظ بجدولة حلقته','Allow teachers to schedule their circles')}</label>
        {data.lessonHealth?.lastRun&&<small>{t('آخر فحص للمهام','Last schedule check')} · {formatted(data.lessonHealth.lastRun,'Asia/Riyadh',en)}</small>}
        {data.lessonHealth?.lastError&&<p className="error-text">{data.lessonHealth.lastError}</p>}
        {!!data.lessonHealth?.scheduleConflicts&&<p className="error-text">{data.lessonHealth.scheduleConflicts} {t('مواعيد متكررة متعارضة تحتاج إلى مراجعة.','conflicting recurring sessions need review.')}</p>}
      </div>}
      {!historyMode&&live.length>0&&<section className="lesson-live-list"><h2>{t('الجلسات الجارية','Live sessions')}</h2><div className="lesson-live-grid">
        {live.slice(0,12).map(lesson=><article key={lesson.id} className="lesson-live-card">
          <div className="lesson-live-title"><span className="stat-icon tint-green"><Radio size={19}/></span><div><strong>{lesson.title}</strong><p>{nameFor(lesson)}</p></div><Badge status="present" label={t('مباشر','Live')}/></div>
          <div className="lesson-card-meta"><span><Users size={15}/>{lesson.connected} {t('متصل بالوسائط','connected')}</span>{lesson.manager&&<span>{lesson.waiting} {t('بانتظار القبول','waiting')}</span>}<span><Clock3 size={15}/>{lesson.actualStart?duration(lesson.actualStart,new Date(now).toISOString()):0} {t('دقيقة','min')}</span>
            {!data.lessonHealth?.rtcConfigured&&<span>{t('الوسائط بانتظار التفعيل','Media setup pending')}</span>}</div>
          <button className="btn btn-outline compact" type="button" onClick={()=>select(lesson.id)}>{lesson.self?.status==='admitted'?t('العودة للمكالمة','Return to call'):lesson.manager?t('دخول الجلسة','Enter session'):t('طلب الانضمام','Request to join')}</button>
        </article>)}
      </div></section>}
      <div className="lesson-catalog">
        <div className="seg-toggle" aria-label={t('قوائم المكالمات','Call lists')}>
          <button type="button" className={!historyMode?'selected':''} aria-pressed={!historyMode} onClick={()=>{setHistoryMode(false);setFilter('')}}>{t('المواعيد','Schedule')}</button>
          <button type="button" className={historyMode?'selected':''} aria-pressed={historyMode} onClick={()=>{setHistoryMode(true);setFilter('')}}>{t('سجل المكالمات','Call history')}</button>
        </div>
        <label className="lesson-search"><Search size={17}/><input type="search" aria-label={t('البحث في الجلسات','Search sessions')} value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('ابحث بعنوان الموعد أو الحلقة أو المحفّظ','Search title, circle, or teacher')}/></label>
      </div>
      <div className="lesson-filters">
        {!historyMode&&<><div className="seg-toggle">{(['day','week','month'] as const).map(value=><button className={period===value?'selected':''} type="button" key={value}
          aria-pressed={period===value} onClick={()=>setPeriod(value)}>{({day:t('يوم','Day'),week:t('أسبوع','Week'),month:t('شهر','Month')})[value]}</button>)}</div>
        <button className="btn btn-outline compact" type="button" onClick={()=>{setDate(data.date);setPeriod('day')}}>{t('اليوم','Today')}</button>
        <button className="btn btn-outline compact" type="button" onClick={()=>{setDate(dayOffset(data.date,1));setPeriod('day')}}>{t('غدًا','Tomorrow')}</button>
        <button className="icon-button lesson-prev" type="button" aria-label={t('اليوم السابق','Previous day')} onClick={()=>setDate(dayOffset(date,-1))}><ChevronLeft size={17}/></button>
        <label className="circle-picker"><input type="date" aria-label={t('تاريخ التقويم','Calendar date')} value={date} onChange={event=>{if(event.target.value)setDate(event.target.value)}}/></label>
        <button className="icon-button lesson-prev" type="button" aria-label={t('اليوم التالي','Next day')} onClick={()=>setDate(dayOffset(date,1))}><ChevronRight size={17}/></button></>}
        {data.circles.length>1&&<select aria-label={t('الحلقة','Circle')} value={circle} onChange={event=>setCircle(event.target.value)}><option value="">{t('كل الحلقات','All circles')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select>}
        {management&&<select aria-label={t('المحفّظ','Teacher')} value={teacher} onChange={event=>setTeacher(event.target.value)}><option value="">{t('كل المحفّظين','All teachers')}</option>{data.users.filter(user=>user.role==='teacher').map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select>}
        <select aria-label={t('حالة الجلسة','Session status')} value={filter} onChange={event=>setFilter(event.target.value)}><option value="">{t('كل الحالات','All statuses')}</option>
          {(['scheduled','live','completed','cancelled'] as const).map(status=><option key={status} value={status}>{({scheduled:t('مجدولة','Scheduled'),live:t('جارية','Live'),completed:t('مكتملة','Completed'),cancelled:t('ملغاة','Cancelled')})[status]}</option>)}</select>
      </div>
      {!historyMode&&<p className="muted">{dateLabel(start,en)}{period!=='day'&&' – '+dateLabel(end,en)} · Asia/Riyadh</p>}
      <div className="lesson-agenda">{list.slice(0,limit).map(lesson=><article className="record-tile" key={lesson.id}>
        <span className="stat-icon tint-green">{lesson.media==='video'?<Video size={20}/>:<Mic size={20}/>}</span>
        <div><strong>{lesson.title}</strong><p>{[circleFor(lesson),nameFor(lesson)].filter(Boolean).join(' · ')}</p>
          <small><CalendarDays size={14}/>{formatted(lesson.startsAt,lesson.zone,en)} – {formatted(lesson.endsAt,lesson.zone,en,false)} · {lesson.zone}</small>
          <small><Users size={14}/>{lesson.inviteCount} {t('مدعو','invited')} · {lesson.media==='video'?t('صوت وفيديو','Audio and video'):t('صوت فقط','Audio only')}</small>
        </div>
        <Badge status={lesson.status==='live'&&!lessonClosed(lesson,now)?'present':'pending'} label={statusName(lesson,t,now)}/>
        <button type="button" className="btn btn-outline compact" onClick={()=>select(lesson.id)}>{lessonClosed(lesson,now)?t('عرض الملخص','View summary'):t('عرض التفاصيل','View details')}</button>
      </article>)}</div>
      {!list.length&&<Empty title={historyMode?t('لا توجد مكالمات منتهية مطابقة','No matching past calls'):t('لا توجد مواعيد مطابقة في هذه الفترة','No matching sessions in this period')}/>}
      {limit<list.length&&<button type="button" className="btn btn-outline" onClick={()=>setLimit(value=>value+25)}>{t('عرض المزيد','Show more')}</button>}
    </section>
    {focused&&(!lessonClosed(focused,now)&&focused.status==='live'&&focused.self?.status==='admitted'
      ?<LessonCall key={focused.id} lesson={focused} save={save} busy={busy} devices={devices} setDevices={setDevices} close={close} error={error}/>
      :<Modal title={focused.title} close={close} wide appearance="lesson-room-dialog">
        <div className="modal-body">
          {lessonClosed(focused,now)?<LessonSummary lesson={focused} close={close}/>:<Prejoin key={focused.id} lesson={focused} devices={devices} setDevices={setDevices} save={save} busy={busy} now={now}/>}
          {focused.manager&&<div className="chip-row">
            {focused.status==='scheduled'&&!lessonClosed(focused,now)&&canPlan&&<button type="button" className="btn btn-outline compact" onClick={()=>{setEditor({lesson:focused});close()}}>{t('تعديل الموعد','Edit schedule')}</button>}
            {focused.status==='scheduled'&&!lessonClosed(focused,now)&&<button type="button" className="btn btn-outline compact lesson-danger" disabled={busy}
              onClick={()=>{if(window.confirm(t('إلغاء هذا الموعد؟','Cancel this session?')))void save('lesson-cancel',{id:focused.id})}}>{t('إلغاء الموعد','Cancel session')}</button>}
            <button type="button" className="btn btn-outline compact" onClick={exportAttendance}><ArrowDownToLine size={17}/>{t('تصدير الحضور','Export attendance')}</button>
          </div>}
          {error&&<div className="error-box" role="alert">{error}</div>}
        </div>
      </Modal>)}
    {editor&&canPlan&&<LessonEditor editor={editor} save={save} busy={busy} error={error} close={()=>{setEditor(undefined);setError('')}}/>}
  </div>
}
