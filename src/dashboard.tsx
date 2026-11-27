import { useMemo, useState } from 'react'
import { Award, BookOpen, CalendarDays, Check, ChevronDown, CircleCheck, Clock3, Ellipsis, ListFilter, Plus, Search, Sparkles, UserCheck, Users } from 'lucide-react'
import { balanceFor, circleMeets, isRecitationDue, recitationStatus, segmentLabel, statusFor, surahs, type RecitationStatus } from './domain'
import { RecitationBadge } from './recitation-roster'
import { Avatar, Badge, Empty, StudentIndicators, dateLabel, matches, nameFor, useWorkspace } from './ui'

type RosterFilter = 'all' | 'due' | 'present' | 'incomplete' | RecitationStatus
const recitationOrder: Record<RecitationStatus,number> = {awaiting:0,partial:1,complete:2,absent:3,leave:4}

export function Dashboard({rosterOnly,circleId,selectCircle}:{rosterOnly:boolean;circleId:string;selectCircle:(id:string)=>void}) {
  const {data,t,en,go,open} = useWorkspace()
  const [query,setQuery] = useState('')
  const [filter,setFilter] = useState<RosterFilter>('all')
  const [overflow,setOverflow] = useState('')
  const [limit,setLimit] = useState(24)
  const circle = data.circles.find(c=>c.id===circleId) || data.circles[0]
  const meeting = Boolean(circle && circleMeets(data.date,circle))
  const records = useMemo(()=>new Map(data.daily.filter(record=>record.date===data.date).map(record=>[record.studentId,record])),[data.daily,data.date])
  const requests=data.circleEnrollments?.filter(request=>request.circleId===circle?.id) ?? []
  const students = data.students.filter(student=>student.active && student.circleId===circle?.id)
  const roster = students.map(student=>({student,record:records.get(student.id),status:recitationStatus(records.get(student.id))}))
  const complete = roster.filter(({record})=>statusFor(record)==='complete').length
  const present = roster.filter(({record})=>record?.attendance==='present').length
  const absent = roster.filter(({record})=>record?.attendance==='absent').length
  const recited = roster.filter(({status})=>status==='complete').length
  const due = meeting ? roster.filter(({record})=>isRecitationDue(record)).length : 0
  const progress = students.length ? Math.round(complete/students.length*100) : 0
  const visible = rosterOnly?roster.filter(({student,record,status})=>matches(student,query) && (
    filter==='all' || filter==='present'&&record?.attendance==='present' ||
    filter==='incomplete'&&statusFor(record)!=='complete' || filter==='due'&&meeting&&isRecitationDue(record) || status===filter
  )).sort((a,b)=>recitationOrder[a.status]-recitationOrder[b.status]):[]
  const changeFilter = (value:RosterFilter) => {setFilter(value);setOverflow('');setLimit(24)}
  function viewStudents(value:RosterFilter) {
    setQuery('')
    changeFilter(value)
    go('students')
  }
  const metrics = [
    ['all',Users,t('الطلاب النشطون','Active students'),students.length,'green'],
    ['present',UserCheck,t('حاضرون','Present'),present,'blue'],
    ['complete',CircleCheck,t('أتمّوا التسميع','Recited'),recited,'green'],
    ['due',Clock3,t('بانتظار التسميع','To recite'),due,'gold'],
  ] as const
  const name = data.sample && en ? 'Abdulrahman' : data.user?.name
  const canRecord = meeting&&students.length>0
  return <div className={'teacher-dashboard page-stack'+(rosterOnly?' teacher-roster-page':'')}>
    <section className="panel teacher-overview teacher-today">
      <div className="teacher-heading">
        <div>
          <p className="teacher-date"><CalendarDays size={15}/>{dateLabel(data.date,en,true)}</p>
          <h1>{rosterOnly?t('طلاب الحلقة','Circle students'):t('حلقة اليوم','Today’s circle')}</h1>
          {name&&<p className="muted">{name}</p>}
        </div>
        <label className="circle-picker"><BookOpen size={16}/><select aria-label={t('الحلقة','Circle')} value={circle?.id||''} onChange={event=>{selectCircle(event.target.value);setQuery('');changeFilter('all')}}>
          {!data.circles.length&&<option value="">{t('لا توجد حلقات','No circles')}</option>}
          {data.circles.map(item=><option key={item.id} value={item.id}>{data.sample && en ? 'Imam Asim Circle' : item.name} · {data.students.filter(student=>student.active&&student.circleId===item.id).length}</option>)}
        </select><ChevronDown size={15}/></label>
      </div>
      <div className="teacher-actions">
        <button className="btn btn-primary" disabled={!canRecord} onClick={()=>open(undefined,'recite',undefined,circle?.id)}><Plus size={17}/>{t('تسجيل تسميع','Record recitation')}</button>
        <button className="btn btn-outline" disabled={!canRecord} onClick={()=>open(undefined,'attendance',undefined,circle?.id)}><UserCheck size={17}/>{t('تسجيل الحضور','Record attendance')}</button>
      </div>
    </section>
    {!rosterOnly&&<>
    <div className="teacher-metrics" aria-label={t('تصفية الطلاب بحسب مؤشرات اليوم','Filter students by today’s activity')}>
      {metrics.map(([value,Icon,label,count,color])=><button className="panel teacher-metric" type="button" key={value} onClick={()=>viewStudents(value)}>
        <span className={'stat-icon tint-'+color}><Icon size={19}/></span><span><strong>{count}</strong><small>{label}</small></span>
      </button>)}
    </div>
    {circle&&<section className="panel teacher-progress">
      <div><strong>{t('إنجاز اليوم','Daily completion')}</strong><span>{t(`${complete} من ${students.length} أكملوا جميع المهام`,`${complete} of ${students.length} completed all tasks`)}</span></div>
      <progress value={progress} max={100} aria-label={t('إنجاز اليوم','Daily completion')}/>
      <span className="count-pill"><bdi>{progress}%</bdi></span>
      {absent>0&&<button className="text-button" onClick={()=>viewStudents('absent')}>{t(`${absent} غائب`,`${absent} absent`)}</button>}
    </section>}
    {requests.length>0&&<section className="panel section-panel teacher-enrollments">
      <div className="section-title"><h2>{t('طلبات تسجيل الحلقة','Circle enrollment requests')} <span className="count-pill">{requests.length}</span></h2></div>
      <ul>{requests.map(request=><li key={request.id}><strong>{request.name}</strong><Badge status="pending" label={t('بانتظار اعتماد الإدارة','Awaiting administration approval')}/></li>)}</ul>
    </section>}
    </>}
    {rosterOnly&&<section className="panel roster">
      <div className="section-title">
        <h2>{t('قائمة الطلاب','Student list')} <span className="count-pill" aria-live="polite">{visible.length} / {students.length}</span></h2>
      </div>
      {circle&&!meeting&&<div className="hint-line"><CalendarDays size={15}/>{t('اليوم إجازة للحلقة','The circle is off today')}</div>}
      <div className="toolbar teacher-roster-tools">
        <label className="search"><Search size={17}/><input type="search" value={query} onChange={event=>{setQuery(event.target.value);setLimit(24)}} placeholder={t('ابحث باسم الطالب','Search by student name')} aria-label={t('ابحث عن طالب','Search students')}/></label>
        <label className="circle-picker filter-picker"><ListFilter size={17}/><select value={filter} onChange={event=>changeFilter(event.target.value as RosterFilter)} aria-label={t('تصفية الطلاب','Filter students')}>
          <option value="all">{t('كل الحالات','All statuses')}</option><option value="present">{t('الحاضرون','Present')}</option><option value="incomplete">{t('غير المكتملين','Incomplete')}</option>
          <option value="due">{t('بانتظار التسميع','To recite')}</option><option value="complete">{t('أتمّوا التسميع','Recited')}</option><option value="partial">{t('تسميع جزئي','Partial')}</option>
          <option value="awaiting">{t('لم يسمّع بعد','Awaiting recitation')}</option><option value="absent">{t('غائب','Absent')}</option><option value="leave">{t('مستأذن','On leave')}</option>
        </select><ChevronDown size={14}/></label>
      </div>
      <div className="roster-list">{visible.slice(0,limit).map(({student,record,status})=><article className={'student-row row-'+status} key={student.id}>
        <div className="student-top">
          <button className="student-name" disabled={!meeting} onClick={()=>open(student)}><Avatar student={student}/><span>{nameFor(student,en)}{status==='complete'&&<CircleCheck size={15} className="complete-mark"/>}</span></button>
          <div className="student-right"><RecitationBadge record={record}/>{meeting&&<div className="relative">
            <button className="icon-button mini" aria-label={t('خيارات الطالب','Student actions')} aria-expanded={overflow===student.id} onClick={()=>setOverflow(overflow===student.id?'':student.id)}><Ellipsis size={18}/></button>
            {overflow===student.id&&<div className="popover small-pop">{([['recite',t('تسجيل التسميع','Record recitation')],['attendance',t('تعديل الحضور','Edit attendance')],['schedule',t('تعديل الجدولة','Edit schedule')],['points',t('تعديل النقاط','Adjust points')]] as const).map(([mode,label])=><button type="button" key={mode} onClick={()=>{setOverflow('');open(student,mode)}}>{label}</button>)}</div>}
          </div>}</div>
        </div>
        <StudentIndicators record={record}/>
      </article>)}
      {visible.length>limit&&<button type="button" className="btn btn-outline teacher-roster-more" onClick={()=>setLimit(n=>n+24)}>
        {t('عرض طلاب إضافيين','Show more students')}
      </button>}
      {!visible.length&&<Empty title={!students.length?t('لا يوجد طلاب في الحلقة','No students in this circle'):t('لا توجد نتائج مطابقة','No matching students')} action={students.length>0&&<button className="btn btn-outline compact" onClick={()=>{setQuery('');changeFilter('all')}}>{t('عرض جميع الطلاب','Show all students')}</button>}/>}
      </div>
    </section>}
  </div>
}
export function StudentHome() {
  const {data,t,en,go} = useWorkspace()
  const [child,setChild] = useState('')
  const parent = data.user?.role === 'parent'
  const student = data.students.find(s=>s.id===child) || data.students[0]
  if (!student) return <section className="panel"><Empty title={parent?t('مرحبًا بك في منصة حلقات الخير','Welcome to Al-Khair Quran Circles'):t('حساب الطالب غير مرتبط','Student account is not linked')} body={parent?t('أضف طالبًا لمتابعة حفظه وحضوره وإنجازاته.','Add a student to follow their Quran progress.'):undefined} action={parent&&<button className="btn btn-primary" onClick={()=>go('more')}><Plus size={17}/>{t('إضافة طالب','Add a student')}</button>}/></section>
  const daily = data.daily.filter(d=>d.studentId===student.id).sort((a,b)=>b.date.localeCompare(a.date))
  const today = daily.find(d=>d.date===data.date)
  const last = daily.find(d=>d.date<=data.date && (d.nextMemorization.length || d.nextReview.length))
  const balance = balanceFor(student,data)
  const assigned = daily.find(d=>d.date<data.date && d.nextDate===data.date && (d.nextMemorization.length || d.nextReview.length))
  const memorized = new Set(daily.filter(d=>d.memorizationStatus==='complete').flatMap(d=>d.memorization.flatMap(s=>Array.from({length:s.to-s.from+1},(_,i)=>s.surah+':'+(s.from+i)))))
  const totalVerses = surahs.reduce((sum,s)=>sum+s.count,0)
  const attendanceCount = daily.filter(d=>d.attendance==='present').length
  const badges = [
    {earned:memorized.size>0,label:t('بداية الحفظ','First recitation')},
    {earned:attendanceCount>=7,label:t('مواظبة 7 أيام','7 days attended')},
    {earned:memorized.size>=100,label:t('حفظ 100 آية','100 verses memorized')},
  ].filter(b=>b.earned)
  return <div className="page-stack">
    <section className="hero learner-hero"><div className="hero-image"/><div className="hero-content">
      <div className="hero-date"><CalendarDays size={15}/>{dateLabel(data.date,en,true)}</div><h1>{parent?t('متابعة الأبناء','Family dashboard'):t(`أهلًا بك، ${nameFor(student,en).split(' ')[0]}`,`Welcome, ${nameFor(student,en).split(' ')[0]}`)}</h1><p>{t('خطوة جديدة في رحلة حفظ القرآن الكريم.','A new step in your Quran memorization journey.')}</p>
    </div></section>
    {parent && <div className="chip-row">{data.students.map(s=><button className={'btn '+(s.id===student.id?'btn-primary':'btn-outline')} key={s.id} onClick={()=>setChild(s.id)}><Avatar student={s} size="avatar-mini"/>{nameFor(s,en)}</button>)}</div>}
    <div className="summary-grid">
      <section className="panel summary-panel"><span className="stat-icon tint-gold"><Check size={20}/></span><h2>{t('إنجازات اليوم','Today’s achievements')}</h2><Badge status={statusFor(today)}/><StudentIndicators record={today}/></section>
      <section className="panel summary-panel"><span className="stat-icon tint-green"><BookOpen size={20}/></span><h2>{t('الجدولة القادمة','Upcoming assignment')}</h2>{last?<><p>{dateLabel(last.nextDate,en)}</p><p><strong>{t('الحفظ','Memorization')}</strong> · {segmentLabel(last.nextMemorization,en)||'—'}</p><p><strong>{t('المراجعة','Revision')}</strong> · {segmentLabel(last.nextReview,en)||'—'}</p></>:<p>{t('ستظهر المهام عند تسجيلها من المحفّظ.','New assignments will appear here.')}</p>}</section>
      <section className="panel summary-panel points-wallet"><span className="stat-icon tint-blue"><Sparkles size={20}/></span><h2>{t('رصيد النقاط','Points balance')}</h2><strong className="big-number">{balance}</strong>{!parent&&<button className="btn btn-outline" onClick={()=>go('store')}>{t('زيارة المتجر','Visit the store')}</button>}</section>
    </div>
    {assigned&&<section className="panel section-panel">
      <div className="section-title"><div><h2>{t('المطلوب اليوم','Today’s assignment')}</h2><p>{dateLabel(data.date,en,true)}</p></div><span className="stat-icon tint-green"><CalendarDays size={18}/></span></div>
      <p><strong>{t('الحفظ','Memorization')}</strong> · {segmentLabel(assigned.nextMemorization,en)||'—'}</p><p><strong>{t('المراجعة','Revision')}</strong> · {segmentLabel(assigned.nextReview,en)||'—'}</p>
    </section>}
    <section className="panel section-panel">
      <div className="section-title"><div><h2>{t('التقدم في الحفظ','Memorization progress')}</h2><p>{t('الآيات المسجلة كمكتملة في المنصة','Verses marked complete in the platform')}</p></div><strong className="big-number">{(memorized.size/totalVerses*100).toFixed(1)}%</strong></div>
      <div className="bar-track"><i style={{width:memorized.size/totalVerses*100+'%',background:'#238468'}}/></div>
      <p className="small-text">{memorized.size} / {totalVerses} {t('آية','verses')}</p>
      {!!badges.length&&<div className="chip-row achievement-list">{badges.map(b=><span key={b.label} className="count-pill"><Award size={16}/>{b.label}</span>)}</div>}
    </section>
    <section className="panel section-panel">
      <div className="section-title"><div><h2>{t('متابعة الطالب','Student activity')}</h2><p>{nameFor(student,en)}</p></div></div>
      <div className="chip-row"><button className="btn btn-outline" onClick={()=>go('achievements')}>{t('سجل الحفظ والحضور','Recitation and attendance')}</button><button className="btn btn-outline" onClick={()=>go('exams')}>{t('الاختبارات','Assessments')}</button><button className="btn btn-outline" onClick={()=>go('leaves')}>{t('طلب استئذان','Request leave')}</button></div>
    </section>
  </div>
}
