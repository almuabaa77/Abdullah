import { useEffect, useRef, useState } from 'react'
import { Activity, Bell, ClipboardList, Maximize, Minimize, Pencil, Radio, Search, Send } from 'lucide-react'
import { circleMeets, needsRecordReminder, recordReminderMessage, reminderCooldown, reminderFields, segmentLabel, statusFor, type Daily, type RecordReminder, type RecordSection, type Student } from './domain'
import { Avatar, Badge, dateLabel, Empty, matches, Modal, nameFor, useWorkspace } from './ui'
import type { RecordStreamStatus } from './live-records'

const sectionNames: Record<RecordSection,[string,string]> = {
  memorization:['الحفظ','Memorization'],review:['المراجعة','Revision'],nextMemorization:['الحفظ المجدول','Assigned memorization'],
  nextReview:['المراجعة المجدولة','Assigned revision'],attendance:['الحضور','Attendance'],points:['النقاط','Points'],note:['الملاحظة','Note'],
}
const passages = ['memorization','review','nextMemorization','nextReview'] as const
const pageSize = 25
const reminderKey = ({studentId,circleId,date,field}:RecordReminder,teacherId:string) => [studentId,circleId,date,field,teacherId].join('/')
type OrientationLock = ScreenOrientation & {lock?:(orientation:'landscape')=>Promise<void>}

export function AdminLive({status,online}:{status:RecordStreamStatus;online:boolean}) {
  const {data,t,en,open,post,tell} = useWorkspace()
  const [selectedDate,setDate] = useState('')
  const [circleId,setCircleId] = useState('')
  const [query,setQuery] = useState('')
  const [limit,setLimit] = useState(pageSize)
  const [panel,setPanel] = useState<'records'|'reminders'|'activity'>('records')
  const [filter,setFilter] = useState<string>('all')
  const [expanded,setExpanded] = useState(false)
  const [reminder,setReminder] = useState<RecordReminder>()
  const [sending,setSending] = useState(false)
  const [sendError,setSendError] = useState('')
  const [clock,setClock] = useState(Date.now)
  const pendingSend = useRef(false)
  const nativeFullscreen = useRef(false)
  const expandButton = useRef<HTMLButtonElement>(null)
  const date=selectedDate||data.date
  const records = new Map(data.daily.filter(record=>record.date===date).map(record=>[record.studentId,record]))
  const students = data.students.filter(student=>(student.active||records.has(student.id)) && (!circleId||student.circleId===circleId) && matches(student,query))
  const accounts = new Map(data.users.map(user=>[user.id,user]))
  const circles = new Map(data.circles.map(circle=>[circle.id,circle]))
  const studentsById = new Map(students.map(student=>[student.id,student]))
  const events = (data.recordEvents ?? []).filter(event=>event.date===date && (!circleId||event.circleId===circleId) && studentsById.has(event.studentId)).slice(0,20)
  const rows = students.map(student=>({student,record:records.get(student.id)}))
    .sort((a,b)=>nameFor(a.student,en).localeCompare(nameFor(b.student,en),en?'en':'ar'))
  const summaries = [
    ['all',rows.length,t('الطلاب','Students')],
    ['recorded',rows.filter(row=>row.record).length,t('سجلات مدخلة','Records entered')],
    ['pending',rows.filter(row=>!row.record).length,t('بانتظار التسجيل','Awaiting entry')],
    ['absent',rows.filter(row=>row.record?.attendance==='absent').length,t('غياب','Absent')],
  ] as const
  const visibleRows=rows.filter(row=>filter==='all'||filter==='recorded'&&row.record||filter==='pending'&&!row.record||filter==='absent'&&row.record?.attendance==='absent')
  const timeFormat = new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-nu-latn',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Riyadh'})
  const label = (kind:RecordSection) => kind==='memorization'?t('الحفظ الجديد','New memorization'):t(...sectionNames[kind])
  const connectionLabel = !online?t('دون اتصال','Offline')
    :status==='live'?t('متصل بالتحديث المباشر','Live updates connected')
    :status==='connecting'?t('جارٍ الاتصال','Connecting'):t('تحديث دوري','Periodic updates')

  const latest = new Map<string,string>()
  for(const sent of data.recordReminders ?? []) {
    const key=reminderKey(sent,sent.teacherId)
    if(!latest.has(key))latest.set(key,sent.time)
  }
  function availableReminder(student:Student,record:Daily|undefined,field:RecordReminder['field']):RecordReminder|undefined {
    const circle=circles.get(student.circleId)
    if(!student.active||!circle||!circleMeets(date,circle)||!needsRecordReminder(record,field))return undefined
    return {studentId:student.id,circleId:circle.id,date,field}
  }
  function teacherFor(target:RecordReminder) {
    const teacher=accounts.get(circles.get(target.circleId)?.teacherId ?? '')
    return teacher?.role==='teacher'&&teacher.status==='active'&&!teacher.duplicateOf?teacher:undefined
  }
  const alerts=panel==='reminders'?visibleRows.flatMap(({student,record})=>
    reminderFields.flatMap(field=>{
      const target=availableReminder(student,record,field)
      return target?[{student,record,target}]:[]
    })):[]

  async function toggleExpanded() {
    if(expanded) {
      setExpanded(false)
      if(nativeFullscreen.current&&document.fullscreenElement)await document.exitFullscreen().catch(()=>{})
      return
    }
    setExpanded(true)
    if(!document.fullscreenEnabled||document.fullscreenElement)return
    try {
      await document.documentElement.requestFullscreen()
      nativeFullscreen.current=true
      if(matchMedia('(pointer: coarse)').matches) {
        await (screen.orientation as OrientationLock | undefined)?.lock?.('landscape')
      }
    } catch { /* The table still fills the viewport and scrolls on browsers without these APIs. */ }
  }
  useEffect(()=>{
    if(!expanded)return
    function onFullscreenChange() {
      if(nativeFullscreen.current&&!document.fullscreenElement){
        nativeFullscreen.current=false
        setExpanded(false)
      }
    }
    function onEscape(event:KeyboardEvent) {
      if(event.key==='Escape'&&!nativeFullscreen.current&&!document.querySelector('.modal-backdrop')){
        setExpanded(false)
        expandButton.current?.focus()
      }
    }
    document.addEventListener('fullscreenchange',onFullscreenChange)
    document.addEventListener('keydown',onEscape)
    return ()=>{
      document.removeEventListener('fullscreenchange',onFullscreenChange)
      document.removeEventListener('keydown',onEscape)
      if(nativeFullscreen.current&&document.fullscreenElement)void document.exitFullscreen().catch(()=>{})
      nativeFullscreen.current=false
    }
  },[expanded])

  const targetStudent=reminder?studentsById.get(reminder.studentId):undefined
  const targetRecord=reminder?data.daily.find(item=>item.studentId===reminder.studentId&&item.date===reminder.date):undefined
  const recipient=reminder?teacherFor(reminder):undefined
  const previous=reminder&&recipient?latest.get(reminderKey(reminder,recipient.id)):undefined
  const sentRecently=Boolean(previous&&clock-Date.parse(previous)<reminderCooldown)
  useEffect(()=>{
    if(!previous)return
    const remaining=Math.max(0,Date.parse(previous)+reminderCooldown-Date.now())
    const timer=window.setTimeout(()=>setClock(Date.now()),remaining+20)
    return ()=>window.clearTimeout(timer)
  },[previous])
  const targetStillPending=Boolean(reminder&&needsRecordReminder(targetRecord,reminder.field))
  const message=reminder&&targetStudent?recordReminderMessage(nameFor(targetStudent,en),reminder.field,targetRecord?.attendance==='absent'):undefined

  function showReminder(target:RecordReminder) {
    setSendError('')
    setClock(Date.now())
    setReminder(target)
  }
  async function sendReminder() {
    if(!reminder||!recipient||!targetStillPending||sentRecently||pendingSend.current||!online)return
    pendingSend.current=true
    setSending(true)
    setSendError('')
    try {
      await post('record-reminder',reminder)
      setReminder(undefined)
      tell(t('أُرسل التنبيه إلى المحفّظ','Reminder sent to the teacher'))
    } catch(error) {
      setSendError((error as Error).message)
    } finally {
      pendingSend.current=false
      setSending(false)
    }
  }
  function reminderControl(target:RecordReminder,student:Student,labelText:string,empty=false) {
    const teacher=teacherFor(target)
    const sent=teacher&&latest.get(reminderKey(target,teacher.id))
    return <button className={'live-reminder-control'+(empty?' live-empty-cell':'')} type="button" aria-haspopup="dialog"
      aria-label={t(`تنبيه ${nameFor(student,en)} · ${label(target.field)}`,`Remind about ${nameFor(student,en)} · ${label(target.field)}`)}
      onClick={()=>showReminder(target)}>
      <span>{labelText}</span><Bell size={14} className={sent?'reminder-sent':undefined}/>
    </button>
  }

  return <div className={'live-register'+(expanded?' live-register-expanded':'')}>
    <header className="live-register-head">
      <div><h2>{t('المتابعة المباشرة','Live monitoring')}</h2>
        <span className={'live-status'+(status==='live'&&online?' connected':'')} role="status"><Radio size={15}/>{connectionLabel}</span></div>
      <button ref={expandButton} className="btn btn-outline compact" type="button" aria-pressed={expanded} onClick={()=>void toggleExpanded()}>
        {expanded?<Minimize size={17}/>:<Maximize size={17}/>}
        {expanded?t('خروج من ملء الشاشة','Exit full screen'):t('عرض ملء الشاشة','Full screen')}
      </button>
    </header>
    <div className="live-register-toolbar">
      <label className="circle-picker"><select aria-label={t('تصفية الحلقات','Filter circles')} value={circleId} onChange={event=>{setCircleId(event.target.value);setLimit(pageSize)}}><option value="">{t('جميع الحلقات','All circles')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></label>
      <label className="circle-picker"><input type="date" aria-label={t('تاريخ السجل','Record date')} max={data.date} value={date} onChange={event=>{if(event.target.value){setDate(event.target.value===data.date?'':event.target.value);setLimit(pageSize)}}}/></label>
      {selectedDate&&<button className="btn btn-outline compact" type="button" onClick={()=>{setDate('');setLimit(pageSize)}}>{t('اليوم','Today')}</button>}
      <label className="search"><Search size={16}/><input type="search" aria-label={t('ابحث عن طالب','Search students')} placeholder={t('ابحث عن طالب','Search students')} value={query} onChange={event=>{setQuery(event.target.value);setLimit(pageSize)}}/></label>
    </div>
    <div className="admin-live-metrics" aria-label={t('ملخص السجلات','Record summary')}>
      {summaries.map(([id,count,title])=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>{setFilter(id);setPanel('records');setLimit(pageSize)}}>
        <strong>{count}</strong><span>{title}</span>
      </button>)}
    </div>
    <div className="seg-toggle admin-live-switch" role="group" aria-label={t('عرض المتابعة','Monitoring view')}>
      {([
        ['records',ClipboardList,t('الجدول','Register')],
        ['reminders',Bell,t('التنبيهات','Reminders')],
        ['activity',Activity,t('آخر النشاط','Activity')],
      ] as const).map(([id,Icon,title])=><button type="button" key={id} className={panel===id?'selected':''} aria-pressed={panel===id} onClick={()=>{setPanel(id);setLimit(pageSize);if(id==='reminders')setFilter('all')}}><Icon size={16}/>{title}</button>)}
    </div>

    {panel==='records'&&<section className="live-pane" aria-label={t('سجلات الطلاب','Student records')}>
      <p className="live-scroll-hint">{t('مرّر الجدول أفقيًا أو أدر هاتفك لعرض المزيد من الأعمدة.','Swipe across the table or rotate your phone to see more columns.')}</p>
      <div className="live-table-scroll" tabIndex={0} role="region" aria-label={t('جدول المتابعة قابل للتمرير','Scrollable monitoring table')}>
        <table className="live-table">
          <thead><tr>
            <th scope="col">{t('الطالب','Student')}</th><th scope="col">{t('التاريخ','Date')}</th>
            {passages.map(kind=><th scope="col" key={kind}>{label(kind)}</th>)}
            <th scope="col">{t('موعد الجدولة','Assignment date')}</th><th scope="col">{label('attendance')}</th>
            <th scope="col">{label('points')}</th><th scope="col">{t('الإنجاز','Progress')}</th>
          </tr></thead>
          <tbody>{visibleRows.slice(0,limit).map(({student,record})=>{
            const attendance=record?.attendance ?? 'pending'
            const progress=statusFor(record)
            const attendanceTarget=availableReminder(student,record,'attendance')
            const scheduled=record&&(record.nextMemorization.length||record.nextReview.length)?record.nextDate:''
            const circle=circles.get(student.circleId)
            return <tr key={student.id}>
              <th scope="row">
                <div className="live-student"><Avatar student={student}/><div><strong>{nameFor(student,en)}</strong><small>{circle?.name}</small></div>
                  {(record||circleMeets(date,circle))&&<button className="live-edit" type="button" aria-label={t(`فتح سجل ${nameFor(student,en)}`,`Open ${nameFor(student,en)}’s record`)} onClick={()=>open(student,record?'edit':'recite',{date})}><Pencil size={15}/></button>}
                </div>
              </th>
              <td><time dateTime={date}>{dateLabel(date,en)}</time></td>
              {passages.map(kind=>{
                const detail=segmentLabel(record?.[kind] ?? [],en)
                const target=kind==='memorization'||kind==='review'?availableReminder(student,record,kind):undefined
                return <td key={kind} className={!detail?'live-value-empty':undefined}>{target?reminderControl(target,student,'—',true):detail||'—'}</td>
              })}
              <td className={!scheduled?'live-value-empty':undefined}>{scheduled?<time dateTime={scheduled}>{dateLabel(scheduled,en)}</time>:'—'}</td>
              <td className="live-attendance" data-attendance={attendance}>
                {attendanceTarget?<div className="live-attendance-action"><Badge status={attendance}/>{reminderControl(attendanceTarget,student,t('تنبيه','Remind'))}</div>:<Badge status={attendance}/>}
              </td>
              <td className="live-points">{record?.points ?? 0}</td>
              <td><Badge status={progress}/></td>
            </tr>
          })}</tbody>
        </table>
        {!visibleRows.length&&<Empty title={t('لا توجد سجلات مطابقة','No matching records')}/>}
      </div>
      {visibleRows.length>limit&&<div className="live-more"><button className="btn btn-outline compact" type="button" onClick={()=>setLimit(limit+pageSize)}>{t('عرض طلاب إضافيين','Show more students')}</button></div>}
    </section>}

    {panel==='reminders'&&<section className="live-pane live-list-pane" aria-label={t('الخانات التي تحتاج متابعة','Fields requiring follow-up')}>
      <ul className="live-alerts">
        {alerts.slice(0,limit).map(({student,record,target})=>{
          const teacher=teacherFor(target)
          const sent=teacher&&latest.get(reminderKey(target,teacher.id))
          return <li key={student.id+'/'+target.field}>
            <div><strong>{nameFor(student,en)}</strong><small>{circles.get(student.circleId)?.name} · {dateLabel(date,en)}</small></div>
            <div><strong>{label(target.field)}</strong><small>{target.field==='attendance'&&record?.attendance==='absent'?t('مُسجّل غائبًا','Marked absent'):t('لم يسجل بعد','Not yet recorded')}</small></div>
            <div><small>{sent?t('آخر تنبيه','Last reminder')+' · '+timeFormat.format(new Date(sent)):teacher?.name ?? t('لا يوجد محفّظ نشط','No active teacher')}</small>{reminderControl(target,student,sent?t('عرض التنبيه','View reminder'):t('إرسال تنبيه','Send reminder'))}</div>
          </li>
        })}
      </ul>
      {!alerts.length&&<Empty title={t('لا توجد خانات تحتاج إلى تنبيه حسب التصفية الحالية','No fields need reminders under the current filters')}/>}
      {alerts.length>limit&&<div className="live-more"><button className="btn btn-outline compact" type="button" onClick={()=>setLimit(limit+pageSize)}>{t('عرض تنبيهات إضافية','Show more reminders')}</button></div>}
    </section>}

    {panel==='activity'&&<section className="live-pane live-list-pane" aria-label={t('آخر العمليات','Recent activity')}>
      {events.length ? <ol className="live-activity">{events.map(event=><li key={event.id}>
        <strong>{nameFor(studentsById.get(event.studentId)!,en)}</strong>
        <small>{accounts.get(event.actorId)?.name ?? t('حساب سابق','Former account')} · <time dateTime={event.time}>{timeFormat.format(new Date(event.time))}</time></small>
        <div className="chip-row">{event.changes.map(kind=><span className="count-pill" key={kind}>{t(...sectionNames[kind])}</span>)}</div>
      </li>)}</ol> : <Empty title={t('لا توجد عمليات حديثة لهذا التاريخ','No recent activity on this date')}/>}
    </section>}

    {reminder&&message&&<Modal title={t('إرسال تنبيه للمحفّظ','Send a reminder to the teacher')} close={()=>{if(!sending)setReminder(undefined)}}>
      <div className="modal-body live-reminder-preview">
        <strong>{label(reminder.field)} · {dateLabel(reminder.date,en,true)}</strong>
        <p>{recipient?t('إلى','To')+' · '+recipient.name:t('عيّن محفّظًا نشطًا لهذه الحلقة لإرسال التنبيه.','Assign an active teacher to this circle to send a reminder.')}</p>
        <blockquote>{t(message.ar,message.en)}</blockquote>
        {previous&&<small>{t('آخر تنبيه','Last reminder')} · <time dateTime={previous}>{timeFormat.format(new Date(previous))}</time></small>}
        {!targetStillPending&&<p role="status">{t('حُدّثت الخانة ولم تعد بحاجة إلى تنبيه.','The field was updated and no longer needs a reminder.')}</p>}
        {sentRecently&&<p role="status">{t('يمكن إعادة التنبيه بعد خمس دقائق من آخر إرسال.','You can resend five minutes after the last reminder.')}</p>}
        {sendError&&<div className="error-box" role="alert">{sendError}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn btn-outline" type="button" disabled={sending} onClick={()=>setReminder(undefined)}>{t('إغلاق','Close')}</button>
        <button className="btn btn-primary" type="button" disabled={sending||!recipient||!targetStillPending||sentRecently||!online} onClick={()=>void sendReminder()}><Send size={16}/>{sending?t('جارٍ الإرسال…','Sending…'):t('إرسال التنبيه','Send reminder')}</button>
      </div>
    </Modal>}
  </div>
}
