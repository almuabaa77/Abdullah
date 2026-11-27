import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, CalendarDays, ChevronLeft, ChevronRight, Clock3, Hand, Mic, Plus, Users, Video } from 'lucide-react'
import { dateKey, dayOffset, recitationAssignment, segmentLabel } from './domain'
import { LessonRtc } from './lesson-rtc'
import type { LessonKind, LessonView } from './lessons'
import { Badge, Empty, Modal, RoleName, dateLabel, useWorkspace } from './ui'
import './lesson-center.css'

type PlanContext = {chatId?:string;circleId?:string;studentId?:string}
type Editor = {lesson?:LessonView; context?:PlanContext}
function planContext():PlanContext|undefined {
  try {return JSON.parse(sessionStorage.getItem('halaqat-plan-lesson')||'null')??undefined}
  catch {return undefined}
}
const active=(lesson:LessonView)=>lesson.status==='live'||lesson.status==='scheduled'
const lessonKey=(lesson:LessonView)=>dateKey(new Date(lesson.startsAt))
const connected=(at?:string)=>Boolean(at&&Date.now()-Date.parse(at)<55_000)
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

function LessonEditor({editor,save,busy,close}:{editor:Editor;save:(action:string,payload:Record<string,unknown>)=>Promise<boolean>;busy:boolean;close:()=>void}) {
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
        <label>{t('ملاحظات المنظّم','Organizer notes')}<textarea name="notes" maxLength={400} defaultValue={lesson?.notes}/></label>
      </div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('حفظ الموعد','Save session')}</button></div>
    </form>
  </Modal>
}

function LessonRoom({lesson,save,busy}:{lesson:LessonView;save:(action:string,payload:Record<string,unknown>)=>Promise<boolean>;busy:boolean}) {
  const {data,t,en,open}=useWorkspace()
  const [roomTab,setRoomTab]=useState<'people'|'messages'>('people')
  const [message,setMessage]=useState('')
  const actor=(action:string,extra:Record<string,unknown>={})=>void save(action,{id:lesson.id,...extra})
  const people=[...lesson.people].sort((a,b)=>{
    const index=(id:string)=>{const i=lesson.order.indexOf(id);return i<0?-1:i}
    return index(a.id)-index(b.id)
  })
  const queue=people.filter(person=>person.role==='student'&&person.seat?.status==='admitted')
  const next=queue.find(person=>lesson.order.indexOf(person.id)>lesson.order.indexOf(lesson.currentStudent??''))
  const self=lesson.self?.status
  const admin=data.user?.role==='admin'
  const ended=!active(lesson)
  const stage=lesson.status==='live'?t('غرفة الجلسة مفتوحة','Session room is open'):lesson.status==='scheduled'?t('مجدولة','Scheduled'):lesson.status==='cancelled'?t('ملغاة','Cancelled'):t('مكتملة','Completed')
  const current=lesson.people.find(person=>person.id===lesson.currentStudent)
  const selectedStudentId=lesson.manager?current?.studentId:data.user?.studentId
  const assigned=selectedStudentId&&recitationAssignment(data.daily,selectedStudentId,lessonKey(lesson),data.circles.find(circle=>circle.id===lesson.circleId))
  const send=async (event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(message.trim()&&await save('lesson-message',{id:lesson.id,text:message}))setMessage('')
  }

  return <div className="lesson-room">
    <div className="split-line"><div><strong>{stage}</strong><p>{formatted(lesson.startsAt,lesson.zone,en)} · {lesson.zone}</p>
      {lesson.actualStart&&<p>{t('الوقت المنقضي','Elapsed time')} · {duration(lesson.actualStart,lesson.actualEnd??new Date().toISOString())} {t('دقيقة','min')}</p>}</div>
      <span className="count-pill"><Users size={16}/>{lesson.connected} / 24</span></div>
    {lesson.notes&&<p className="lesson-notes">{lesson.notes}</p>}
    {!ended&&<>
      <div className="chip-row">
        {self!=='admitted'&&self!=='waiting'&&self!=='declined'&&self!=='removed'&&
          <button type="button" className="btn btn-primary compact" onClick={()=>actor('lesson-join')} disabled={busy}>
            {lesson.manager?t('فتح غرفة الجلسة أو الدخول','Open or enter the room'):t('طلب الانضمام','Request to join')}</button>}
        {self==='waiting'&&<span className="hint-line" role="status">{t('طلبك ينتظر موافقة المحفّظ.','Waiting for the teacher to admit you.')}</span>}
        {(self==='declined'||self==='removed')&&<span className="error-box" role="status">{t('طلب الدخول مغلق لهذه الجلسة.','Your request is closed for this session.')}</span>}
        {(self==='admitted'||self==='waiting')&&<button type="button" className="btn btn-outline compact" onClick={()=>actor('lesson-leave')} disabled={busy}>{t('مغادرة الغرفة','Leave room')}</button>}
        {self==='admitted'&&data.user?.role==='student'&&<button type="button" className="btn btn-outline compact" aria-pressed={Boolean(lesson.self?.hand)} disabled={busy}
          onClick={()=>actor('lesson-hand',{raised:!lesson.self?.hand})}><Hand size={16}/>{lesson.self?.hand?t('خفض اليد','Lower hand'):t('رفع اليد','Raise hand')}</button>}
      </div>
      {lesson.manager&&lesson.status==='live'&&<div className="chip-row">
        {next&&<button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>actor('lesson-turn',{userId:next.id})}>{t('الدور التالي','Next in queue')} · {next.name}</button>}
        {current&&<button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>actor('lesson-turn')}>{t('إغلاق الدور','End turn')}</button>}
        {admin&&<label className="lesson-media-policy">{t('الوسائط','Media')}<select value={lesson.media} disabled={busy} onChange={event=>actor('lesson-media',{media:event.target.value})}>
          <option value="audio">{t('صوت فقط','Audio only')}</option><option value="video">{t('صوت وفيديو','Audio and video')}</option></select></label>}
        <button type="button" className="btn btn-outline compact" disabled={busy} onClick={()=>actor('lesson-extend',{minutes:15})}>{t('تمديد 15 دقيقة','Extend by 15 minutes')}</button>
        <button type="button" className="btn btn-outline compact lesson-danger" disabled={busy}
          onClick={()=>{if(window.confirm(t('إنهاء الجلسة لجميع المشاركين؟','End the session for everyone?')))actor('lesson-end')}}>{t('إنهاء للجميع','End for everyone')}</button>
      </div>}
      {self==='admitted'&&<LessonRtc lesson={lesson}/>}
      {current&&<p className="hint-line"><Mic size={16}/>{t('الدور الحالي','Current turn')} · {current.name}</p>}
      {assigned&&<div className="lesson-media">
        {assigned.nextMemorization.length>0&&<p>{t('الحفظ المطلوب','Assigned memorization')} · {segmentLabel(assigned.nextMemorization,en)}</p>}
        {assigned.nextReview.length>0&&<p>{t('المراجعة المطلوبة','Assigned revision')} · {segmentLabel(assigned.nextReview,en)}</p>}
      </div>}
    </>}
    {(lesson.manager||self==='admitted')&&<div className="seg-toggle" aria-label={t('أقسام الجلسة','Session panels')}>
      <button type="button" aria-pressed={roomTab==='people'} className={roomTab==='people'?'selected':''} onClick={()=>setRoomTab('people')}>{t('المشاركون','Participants')}</button>
      <button type="button" aria-pressed={roomTab==='messages'} className={roomTab==='messages'?'selected':''} onClick={()=>setRoomTab('messages')}>{t('رسائل الجلسة','Session messages')}</button>
    </div>}
    {roomTab==='messages'&&(lesson.manager||self==='admitted')&&<section className="lesson-media">
      <div className="lesson-room-messages" role="log">
        {(lesson.messages??[]).map(item=><p key={item.id}><strong>{lesson.people.find(person=>person.id===item.from)?.name??t('مشارك','Participant')}</strong><span dir="auto">{item.text}</span></p>)}
        {!lesson.messages?.length&&<p>{t('لا توجد رسائل في الجلسة','No messages in this session')}</p>}
      </div>
      {!ended&&self==='admitted'&&<form className="compose-form" onSubmit={send}>
        <input aria-label={t('رسالة للجلسة','Session message')} value={message} maxLength={1000} onChange={event=>setMessage(event.target.value)}/>
        <button className="btn btn-primary compact" disabled={busy||!message.trim()}>{t('إرسال الرسالة','Send message')}</button>
      </form>}
    </section>}
    {roomTab==='people'&&(lesson.manager||self==='admitted')&&<section className="lesson-people">
      <h3>{ended?t('ملخص الجلسة','Session summary'):lesson.manager?t('الدور والمشاركون','Queue and participants'):t('المشاركون','Participants')}</h3>
      {people.map(person=>{
        const status=person.seat?.status
        const student=data.students.find(item=>item.id===person.studentId)
        const record=student&&data.daily.find(item=>item.studentId===student.id&&item.date===lessonKey(lesson))
        const hasRecord=Boolean(record&&(record.review.length||record.memorization.length))
        const first=person.seat?.periods[0]?.from
        const late=Boolean(first&&Date.parse(first)>Date.parse(lesson.startsAt)+60_000)
        const total=person.seat?.periods.reduce((sum,period)=>sum+duration(period.from,period.to??person.seat?.lastSeen??period.from),0)??0
        return <div className="entity-row lesson-person" key={person.id}>
          <div><strong>{person.name}</strong><p><RoleName role={person.role}/>{person.seat?.hand&&' · '+t('طلب التحدث','Asked to speak')}</p>
            {lesson.manager&&person.role==='student'&&<p>{total} {t('دقيقة اتصال','media min')} · {late?t('متأخر','Late')+' · ':ended&&!first?t('لم يتصل','No media attendance')+' · ':''}{hasRecord?t('تسميع مسجّل','Recitation recorded'):t('بانتظار التسميع','Awaiting recitation')}</p>}</div>
          <div className="chip-row">
            {connected(person.seat?.lastSeen)?<Badge status="present" label={t('متصل بالوسائط','Media connected')}/>:status==='waiting'?<Badge status="pending" label={t('في الانتظار','Waiting')}/>:status==='admitted'?<Badge status="active" label={t('مقبول','Admitted')}/>:null}
            {lesson.manager&&status==='waiting'&&!ended&&<>
              <button type="button" className="btn btn-primary compact" onClick={()=>actor('lesson-admit',{userId:person.id})} disabled={busy}>{t('قبول','Admit')}</button>
              <button type="button" className="btn btn-outline compact" onClick={()=>actor('lesson-decline',{userId:person.id})} disabled={busy}>{t('رفض','Decline')}</button>
            </>}
            {lesson.manager&&status==='admitted'&&person.role==='student'&&!ended&&<>
              <button type="button" className="btn btn-outline compact" onClick={()=>actor('lesson-turn',{userId:person.id})} disabled={busy||lesson.currentStudent===person.id}>{t('إعطاء الدور','Give turn')}</button>
              <button type="button" className="btn btn-outline compact lesson-danger" disabled={busy} onClick={()=>actor('lesson-remove',{userId:person.id})}>{t('استبعاد','Remove')}</button>
            </>}
            {lesson.manager&&student&&lessonKey(lesson)<=data.date&&<button type="button" className="btn btn-outline compact" onClick={()=>open(student,record?'edit':'recite',{date:lessonKey(lesson)})}>{t('سجل التسميع','Recitation record')}</button>}
          </div>
        </div>
      })}
    </section>}
  </div>
}

export function LessonCenter({management=false}:{management?:boolean}={}) {
  const {data,t,en,post,tell,refresh}=useWorkspace()
  const [date,setDate]=useState(data.date||dateKey())
  const [period,setPeriod]=useState<'day'|'week'|'month'>('day')
  const [circle,setCircle]=useState('')
  const [teacher,setTeacher]=useState('')
  const [filter,setFilter]=useState('')
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
    if(!focused||!active(focused))return
    const timer=window.setInterval(()=>{if(!document.hidden)reload.current()},2500)
    return ()=>window.clearInterval(timer)
  },[focused?.id,focused?.status])
  useEffect(()=>setLimit(25),[date,period,circle,teacher,filter])
  const weekdaysStart=dayOffset(date,-new Date(date+'T12:00:00Z').getUTCDay())
  const start=period==='week'?weekdaysStart:period==='month'?date.slice(0,7)+'-01':date
  const end=period==='week'?dayOffset(start,6):period==='month'?new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).toISOString().slice(0,10):date
  const list=all.filter(lesson=>lessonKey(lesson)>=start&&lessonKey(lesson)<=end&&(!circle||lesson.circleId===circle)&&(!teacher||lesson.teacherId===teacher)&&(!filter||lesson.status===filter))
  const live=all.filter(lesson=>lesson.status==='live')
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
      <div className="section-title"><div><h1>{t('جلسات التسميع','Recitation sessions')}</h1></div>
        {canPlan&&<button type="button" className="btn btn-primary" onClick={()=>{setError('');setEditor({})}}><Plus size={18}/>{t('جدولة جلسة','Schedule a session')}</button>}
      </div>
      {!data.lessonHealth?.rtcConfigured&&<p className="hint-line">{t('الجدولة وغرفة الانتظار متاحتان. تفعيل الصوت والفيديو ينتظر إعدادات Agora.','Scheduling and the waiting room are available. Media requires Agora configuration.')}</p>}
      {management&&<div className="lesson-ops">
        <label className="check-line"><input type="checkbox" checked={Boolean(data.lessonTeacherScheduling)} disabled={busy} onChange={event=>void save('lesson-settings',{enabled:event.target.checked})}/>{t('السماح للمحفّظ بجدولة حلقته','Allow teachers to schedule their circles')}</label>
        {data.lessonHealth?.lastRun&&<small>{t('آخر فحص للمهام','Last schedule check')} · {formatted(data.lessonHealth.lastRun,'Asia/Riyadh',en)}</small>}
        {data.lessonHealth?.lastError&&<p className="error-text">{data.lessonHealth.lastError}</p>}
        {!!data.lessonHealth?.scheduleConflicts&&<p className="error-text">{data.lessonHealth.scheduleConflicts} {t('مواعيد متكررة متعارضة تحتاج إلى مراجعة.','conflicting recurring sessions need review.')}</p>}
      </div>}
      {live.length>0&&<section className="lesson-live-list"><h2>{t('الجلسات الجارية','Live sessions')}</h2><div className="chip-row">
        {live.slice(0,10).map(lesson=><button className="btn btn-outline compact" type="button" key={lesson.id} onClick={()=>setSelected(lesson.id)}>
          {lesson.title} · {lesson.connected} {t('متصل','connected')}{management&&` / ${lesson.waiting} ${t('ينتظر','waiting')}`}</button>)}
      </div></section>}
      <div className="lesson-filters">
        <div className="seg-toggle">{(['day','week','month'] as const).map(value=><button className={period===value?'selected':''} type="button" key={value}
          aria-pressed={period===value} onClick={()=>setPeriod(value)}>{({day:t('يوم','Day'),week:t('أسبوع','Week'),month:t('شهر','Month')})[value]}</button>)}</div>
        <button className="btn btn-outline compact" type="button" onClick={()=>{setDate(data.date);setPeriod('day')}}>{t('اليوم','Today')}</button>
        <button className="btn btn-outline compact" type="button" onClick={()=>{setDate(dayOffset(data.date,1));setPeriod('day')}}>{t('غدًا','Tomorrow')}</button>
        <button className="icon-button lesson-prev" type="button" aria-label={t('اليوم السابق','Previous day')} onClick={()=>setDate(dayOffset(date,-1))}><ChevronLeft size={17}/></button>
        <label className="circle-picker"><input type="date" aria-label={t('تاريخ التقويم','Calendar date')} value={date} onChange={event=>{if(event.target.value)setDate(event.target.value)}}/></label>
        <button className="icon-button lesson-prev" type="button" aria-label={t('اليوم التالي','Next day')} onClick={()=>setDate(dayOffset(date,1))}><ChevronRight size={17}/></button>
        {data.circles.length>1&&<select aria-label={t('الحلقة','Circle')} value={circle} onChange={event=>setCircle(event.target.value)}><option value="">{t('كل الحلقات','All circles')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select>}
        {management&&<select aria-label={t('المحفّظ','Teacher')} value={teacher} onChange={event=>setTeacher(event.target.value)}><option value="">{t('كل المحفّظين','All teachers')}</option>{data.users.filter(user=>user.role==='teacher').map(user=><option key={user.id} value={user.id}>{user.name}</option>)}</select>}
        <select aria-label={t('حالة الجلسة','Session status')} value={filter} onChange={event=>setFilter(event.target.value)}><option value="">{t('كل الحالات','All statuses')}</option>
          {(['scheduled','live','completed','cancelled'] as const).map(status=><option key={status} value={status}>{({scheduled:t('مجدولة','Scheduled'),live:t('جارية','Live'),completed:t('مكتملة','Completed'),cancelled:t('ملغاة','Cancelled')})[status]}</option>)}</select>
      </div>
      <p className="muted">{dateLabel(start,en)}{period!=='day'&&' – '+dateLabel(end,en)} · Asia/Riyadh</p>
      <div className="lesson-agenda">{list.slice(0,limit).map(lesson=><article className="record-tile" key={lesson.id}>
        <span className="stat-icon tint-green">{lesson.media==='video'?<Video size={20}/>:<Mic size={20}/>}</span>
        <div><strong>{lesson.title}</strong><p>{formatted(lesson.startsAt,lesson.zone,en)} · {lesson.zone}</p>
          <small><Clock3 size={14}/>{duration(lesson.startsAt,lesson.endsAt)} {t('دقيقة','min')} · {lesson.people.find(person=>person.id===lesson.teacherId)?.name??t('المحفّظ','Teacher')}</small></div>
        <button type="button" className="btn btn-outline compact" onClick={()=>{setError('');setSelected(lesson.id)}}>{t('فتح التفاصيل','Open details')}</button>
      </article>)}</div>
      {!list.length&&<Empty title={t('لا توجد جلسات في الفترة المحددة','No sessions in this period')}/>}
      {limit<list.length&&<button type="button" className="btn btn-outline" onClick={()=>setLimit(value=>value+25)}>{t('عرض المزيد','Show more')}</button>}
    </section>
    {focused&&<Modal title={focused.title} close={()=>{setSelected('');setError('')}} wide appearance="lesson-room-dialog">
      <div className="modal-body">
        <LessonRoom key={focused.id} lesson={focused} save={save} busy={busy}/>
        {focused.manager&&<div className="chip-row">
          {focused.status==='scheduled'&&canPlan&&<button type="button" className="btn btn-outline compact" onClick={()=>{setEditor({lesson:focused});setSelected('')}}>{t('تعديل الموعد','Edit schedule')}</button>}
          {focused.status==='scheduled'&&<button type="button" className="btn btn-outline compact lesson-danger" disabled={busy}
            onClick={()=>{if(window.confirm(t('إلغاء هذا الموعد؟','Cancel this session?')))void save('lesson-cancel',{id:focused.id})}}>{t('إلغاء الموعد','Cancel session')}</button>}
          <button type="button" className="btn btn-outline compact" onClick={exportAttendance}><ArrowDownToLine size={17}/>{t('تصدير الحضور','Export attendance')}</button>
        </div>}
        {error&&<div className="error-box" role="alert">{error}</div>}
      </div>
    </Modal>}
    {editor&&canPlan&&<LessonEditor editor={editor} save={save} busy={busy} close={()=>{setEditor(undefined);setError('')}}/>}
    {error&&editor&&!focused&&<div className="error-box" role="alert">{error}</div>}
  </div>
}
