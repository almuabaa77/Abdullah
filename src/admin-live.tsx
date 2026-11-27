import { useState } from 'react'
import { Activity, ClipboardList, Pencil, Radio, Search } from 'lucide-react'
import { segmentLabel, type RecordSection } from './domain'
import { Avatar, Badge, dateLabel, Empty, matches, nameFor, useWorkspace } from './ui'
import type { RecordStreamStatus } from './live-records'

const sectionNames: Record<RecordSection,[string,string]> = {
  memorization:['الحفظ','Memorization'],review:['المراجعة','Revision'],nextMemorization:['الحفظ المجدول','Assigned memorization'],
  nextReview:['المراجعة المجدولة','Assigned revision'],attendance:['الحضور','Attendance'],points:['النقاط','Points'],note:['الملاحظة','Note'],
}

export function AdminLive({status,online}:{status:RecordStreamStatus;online:boolean}) {
  const {data,t,en,open} = useWorkspace()
  const [selectedDate,setDate] = useState('')
  const [circleId,setCircleId] = useState('')
  const [query,setQuery] = useState('')
  const [limit,setLimit] = useState(20)
  const [panel,setPanel] = useState<'records'|'activity'>('records')
  const [filter,setFilter] = useState<string>('all')
  const date=selectedDate||data.date
  const records = new Map(data.daily.filter(record=>record.date===date).map(record=>[record.studentId,record]))
  const students = data.students.filter(student=>(student.active||records.has(student.id)) && (!circleId||student.circleId===circleId) && matches(student,query))
  const names = new Map(data.users.map(user=>[user.id,user.name]))
  const circles = new Map(data.circles.map(circle=>[circle.id,circle.name]))
  const studentsById = new Map(students.map(student=>[student.id,student]))
  const events = (data.recordEvents ?? []).filter(event=>event.date===date && (!circleId||event.circleId===circleId) && studentsById.has(event.studentId)).slice(0,20)
  const rows = students.map(student=>({student,record:records.get(student.id)}))
    .sort((a,b)=>(b.record?.updatedAt ?? '').localeCompare(a.record?.updatedAt ?? ''))
  const summaries = [
    ['all',rows.length,t('الطلاب','Students')],
    ['recorded',rows.filter(row=>row.record).length,t('سجلّات مسجلة','Recorded')],
    ['pending',rows.filter(row=>!row.record).length,t('بانتظار التسجيل','Awaiting entry')],
    ['absent',rows.filter(row=>row.record?.attendance==='absent').length,t('غياب','Absent')],
  ] as const
  const visibleRows=rows.filter(row=>filter==='all'||filter==='recorded'&&row.record||filter==='pending'&&!row.record||filter==='absent'&&row.record?.attendance==='absent')
  const timeFormat = new Intl.DateTimeFormat(en?'en-GB':'ar-SA',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Asia/Riyadh'})
  const label = (kind:RecordSection) => t(...sectionNames[kind])
  const connectionLabel = !online?t('دون اتصال','Offline')
    :status==='live'?t('متصل بالتحديث المباشر','Live updates connected')
    :status==='connecting'?t('جارٍ الاتصال','Connecting'):t('تحديث دوري','Periodic updates')

  return <div className="live-register">
    <div className="live-register-toolbar">
      <span className={'live-status'+(status==='live'&&online?' connected':'')} role="status"><Radio size={16}/>{connectionLabel}</span>
      <label className="circle-picker"><input type="date" aria-label={t('تاريخ السجل','Record date')} max={data.date} value={date} onChange={event=>{if(event.target.value){setDate(event.target.value===data.date?'':event.target.value);setLimit(20)}}}/></label>
      {selectedDate&&<button className="btn btn-outline compact" type="button" onClick={()=>{setDate('');setLimit(20)}}>{t('اليوم','Today')}</button>}
      <label className="circle-picker"><select aria-label={t('تصفية الحلقات','Filter circles')} value={circleId} onChange={event=>{setCircleId(event.target.value);setLimit(20)}}><option value="">{t('جميع الحلقات','All circles')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></label>
      <label className="search"><Search size={16}/><input type="search" aria-label={t('ابحث عن طالب','Search students')} placeholder={t('ابحث عن طالب','Search students')} value={query} onChange={event=>{setQuery(event.target.value);setLimit(20)}}/></label>
    </div>
    <div className="admin-live-metrics" aria-label={t('ملخص السجلات','Record summary')}>
      {summaries.map(([id,count,title])=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>{setFilter(id);setPanel('records');setLimit(20)}}>
        <strong>{count}</strong><span>{title}</span>
      </button>)}
    </div>
    <div className="seg-toggle admin-live-switch" aria-label={t('عرض المتابعة','Monitoring view')}>
      <button type="button" className={panel==='records'?'selected':''} aria-pressed={panel==='records'} onClick={()=>setPanel('records')}><ClipboardList size={16}/>{t('السجلات','Records')}</button>
      <button type="button" className={panel==='activity'?'selected':''} aria-pressed={panel==='activity'} onClick={()=>setPanel('activity')}><Activity size={16}/>{t('آخر النشاط','Activity')}</button>
    </div>
    <div className="live-register-layout" data-panel={panel}>
      <section className="live-records-panel" aria-labelledby="live-records-heading">
        <h3 id="live-records-heading">{t('سجلات الطلاب','Student records')} <span className="count-pill">{visibleRows.length}</span></h3>
        <div className="live-rows">
          {visibleRows.slice(0,limit).map(({student,record})=><article className="live-record" key={student.id}>
            <header><div className="admin-live-row-title"><Avatar student={student}/><div><strong>{nameFor(student,en)}</strong><small>{circles.get(student.circleId)}</small></div></div>
              <button className="btn btn-outline compact" type="button" onClick={()=>open(student,record?'edit':'recite',{date})}><Pencil size={15}/>{record?t('تعديل السجل','Edit record'):t('إضافة سجل','Add record')}</button>
            </header>
            <dl>
              {(['memorization','review','nextMemorization','nextReview'] as const).map(kind=><div key={kind}><dt>{label(kind)}</dt><dd>{segmentLabel(record?.[kind] ?? [],en)||'—'}</dd></div>)}
              <div><dt>{label('attendance')}</dt><dd><Badge status={record?.attendance ?? 'pending'}/></dd></div>
              <div><dt>{label('points')}</dt><dd>{record?.points ?? 0}</dd></div>
            </dl>
            <footer>{(record?.nextMemorization.length||record?.nextReview.length)?<span>{t('موعد الجدولة','Assignment date')} · {dateLabel(record.nextDate,en)}</span>:null}{record?.updatedAt&&<time dateTime={record.updatedAt}>{t('آخر تحديث','Updated')} · {timeFormat.format(new Date(record.updatedAt))}</time>}</footer>
          </article>)}
          {!visibleRows.length&&<Empty title={t('لا توجد سجلات مطابقة','No matching records')}/>}
          {visibleRows.length>limit&&<button className="btn btn-outline" type="button" onClick={()=>setLimit(limit+20)}>{t('عرض طلاب إضافيين','Show more students')}</button>}
        </div>
      </section>
      <section className="live-activity-panel" aria-labelledby="live-activity-heading">
        <h3 id="live-activity-heading"><Activity size={17}/>{t('آخر العمليات','Recent activity')}</h3>
        {events.length ? <ol className="live-activity">{events.map(event=><li key={event.id}>
          <strong>{nameFor(studentsById.get(event.studentId)!,en)}</strong>
          <small>{names.get(event.actorId) ?? t('حساب سابق','Former account')} · <time dateTime={event.time}>{timeFormat.format(new Date(event.time))}</time></small>
          <div className="chip-row">{event.changes.map(kind=><span className="count-pill" key={kind}>{label(kind)}</span>)}</div>
        </li>)}</ol> : <Empty title={t('لا توجد عمليات حديثة لهذا التاريخ','No recent activity on this date')}/>}
      </section>
    </div>
  </div>
}
