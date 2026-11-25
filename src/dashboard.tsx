import { useMemo, useState } from 'react'
import { Award, BookOpen, CalendarDays, Check, ChevronDown, CircleCheck, Clock3, Ellipsis, ListFilter, Plus, Search, Sparkles, UserCheck, Users } from 'lucide-react'
import { balanceFor, circleMeets, isRecitationDue, recitationStatus, segmentLabel, statusFor, surahs } from './domain'
import { RecitationBadge } from './recitation-roster'
import { Avatar, Badge, Empty, StudentIndicators, dateLabel, matches, nameFor, useWorkspace } from './ui'

export function Dashboard() {
  const {data,t,en,go,open} = useWorkspace()
  const [circleId,setCircle] = useState('')
  const [query,setQuery] = useState('')
  const [filter,setFilter] = useState('all')
  const [overflow,setOverflow] = useState('')
  const circle = data.circles.find(c=>c.id===circleId) || data.circles[0]
  const records = useMemo(()=>new Map(data.daily.filter(d=>d.date===data.date).map(d=>[d.studentId,d])),[data.daily,data.date])
  const students = data.students.filter(s=>s.active && (!circle || s.circleId===circle.id))
  const complete = students.filter(s=>statusFor(records.get(s.id))==='complete').length
  const present = students.filter(s=>records.get(s.id)?.attendance==='present').length
  const absent = students.filter(s=>records.get(s.id)?.attendance==='absent').length
  const recited = students.filter(s=>recitationStatus(records.get(s.id))==='complete').length
  const reviewed = students.filter(s=>records.get(s.id)?.review.length).length
  const pending = students.filter(s=>isRecitationDue(records.get(s.id))).length
  const percent = students.length ? Math.round(complete / students.length * 100) : 0
  const visible = students.filter(s=>matches(s,query) && (filter==='all' || filter==='incomplete' && statusFor(records.get(s.id))!=='complete' || filter==='due' && isRecitationDue(records.get(s.id)) || recitationStatus(records.get(s.id))===filter))
  const cards = [
    {title:t('إجمالي الطلاب','Total students'),value:students.length, detail:circle?.name || t('جميع الحلقات','All circles'), icon:Users,color:'green'},
    {title:t('الحضور اليوم','Attendance today'),value:present, detail:t(`${absent} غائب اليوم`,`${absent} absent today`),icon:UserCheck,color:'blue'},
    {title:t('أتمّوا التسميع','Completed recitation'),value:recited,detail:t('من طلاب الحلقة','Circle students'),icon:BookOpen,color:'gold'},
    {title:t('بانتظار التسميع','Awaiting recitation'),value:pending,detail:t('لم يسمّعوا أو سمّعوا جزئيًا','Waiting or partially recited'),icon:Clock3,color:'orange'},
  ]
  const name = data.sample && en ? 'Abdulrahman' : data.user?.name.split(' ')[0]
  return <>
    <section className="hero">
      <div className="hero-image" />
      <div className="hero-content">
        <div className="hero-date"><CalendarDays size={15}/>{dateLabel(data.date,en,true)}</div>
        <h1>{t(`أهلًا بك، أ. ${name || ''}`,`Welcome, ${name || ''}`)}</h1>
        <p>{t('تابع حضور طلابك وإنجازاتهم في حلقة اليوم.','Track attendance and progress in today’s Quran circle.')}</p>
        <div className="hero-actions">
          <button className="btn btn-gold" onClick={()=>open(undefined,'recite')}><Plus size={17}/>{t('تسجيل تسميع','Record recitation')}</button>
          <button className="btn btn-hero" onClick={()=>go('assistant')}><Sparkles size={16}/>{t('المساعد الذكي','Smart assistant')}</button>
        </div>
      </div>
    </section>
    <div className="section-title overview-title">
      <div><h2>{t('نظرة عامة اليوم','Today at a glance')}</h2><p>{t('ملخص الحضور والتسميع في الحلقة','Attendance and recitation in your circle')}</p></div>
      <label className="circle-picker"><BookOpen size={16}/><select aria-label={t('الحلقة','Circle')} value={circle?.id||''} onChange={e=>setCircle(e.target.value)}>
        {!data.circles.length && <option value="">{t('لا توجد حلقات','No circles')}</option>}{data.circles.map(c=><option key={c.id} value={c.id}>{data.sample && en ? 'Imam Asim Circle' : c.name}</option>)}
      </select><ChevronDown size={15}/></label>
    </div>
    <div className="stats-grid">
      {cards.map(({title,value,detail,icon:Icon,color},i)=><article className="stat-card" key={title}>
        <div className={`stat-icon tint-${color}`}><Icon size={21} strokeWidth={1.85}/></div>
        <div className="stat-text"><h3>{title}</h3><strong>{value}</strong><span>{i===0 && data.sample && en ? 'Imam Asim Circle' : detail}</span></div>
      </article>)}
    </div>
    <div className="dashboard-grid">
      <section className="panel roster">
        <div className="section-title"><div><h2>{t('طلاب الحلقة','Circle students')} <span className="count-pill">{students.length}</span></h2><p>{t('تابع تفاصيل الإنجاز لكل طالب','Review each student’s daily progress')}</p></div>
          <button className="btn btn-outline compact" onClick={()=>open(undefined,'recite')}><Plus size={16}/><span>{t('عملية جديدة','New entry')}</span></button>
        </div>
        {circle && !circleMeets(data.date,circle) && <div className="hint-line"><CalendarDays size={15}/>{t('اليوم إجازة للحلقة','The circle is off today')}</div>}
        <div className="toolbar">
          <label className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('ابحث عن طالب...','Search for a student...')} aria-label={t('ابحث عن طالب','Search students')} /></label>
          <label className="circle-picker filter-picker"><ListFilter size={17}/><select value={filter} onChange={e=>setFilter(e.target.value)} aria-label={t('تصفية الطلاب','Filter students')}>
            <option value="all">{t('كل الحالات','All statuses')}</option><option value="incomplete">{t('غير المكتملين','Incomplete')}</option>
            <option value="due">{t('بانتظار التسميع','To recite')}</option><option value="complete">{t('أتمّ التسميع','Recited')}</option><option value="partial">{t('تسميع جزئي','Partial')}</option>
            <option value="awaiting">{t('لم يسمّع بعد','Awaiting recitation')}</option><option value="absent">{t('غائب','Absent')}</option><option value="leave">{t('مستأذن','On leave')}</option>
          </select><ChevronDown size={14}/></label>
        </div>
        <div className="roster-list">{visible.map(student => {
          const d = records.get(student.id), status = recitationStatus(d)
          return <article className={'student-row row-' + status} key={student.id}>
            <div className="student-top">
              <button className="student-name" onClick={()=>open(student)}><Avatar student={student}/><span>{nameFor(student,en)}{status==='complete' && <CircleCheck size={15} className="complete-mark"/>}</span></button>
              <div className="student-right"><RecitationBadge record={d}/>
                <div className="relative"><button className="icon-button mini" aria-label={t('خيارات الطالب','Student actions')} aria-expanded={overflow===student.id} onClick={()=>setOverflow(overflow===student.id?'':student.id)}><Ellipsis size={18}/></button>
                {overflow===student.id && <div className="popover small-pop">{([['recite',t('تسجيل التسميع','Record recitation')],['attendance',t('تعديل الحضور','Edit attendance')],['schedule',t('تعديل الجدولة','Edit schedule')],['points',t('تعديل النقاط','Adjust points')]] as const).map(([mode,label])=><button type="button" key={mode} onClick={()=>{setOverflow('');open(student,mode)}}>{label}</button>)}</div>}</div>
              </div>
            </div>
            <StudentIndicators record={d}/>
          </article>
        })}{!visible.length && <Empty title={t('لا توجد نتائج','No students found')} body={query?t('جرّب اسمًا آخر أو غيّر عامل التصفية.','Try another name or filter.'):t('ستظهر أسماء الطلاب بعد إضافتهم إلى الحلقة.','Students will appear once added to the circle.')}/>}</div>
      </section>
      <aside className="dashboard-side">
        <section className="panel progress-card">
          <div className="section-title"><div><h2>{t('الإنجاز اليومي','Daily completion')}</h2><p>{t('نسبة اكتمال مهام الحلقة','Circle activities completed')}</p></div><span className="stat-icon tint-green"><CircleCheck size={19}/></span></div>
          <div className="donut" role="img" aria-label={percent+'%'} style={{'--percent':percent+'%'} as React.CSSProperties}><div><strong>{percent}<small>%</small></strong><span>{t('نسبة الإنجاز','Completion')}</span></div></div>
          <div className="progress-summary"><span><span className="legend-dot" />{t(`${complete} مكتمل`,`${complete} complete`)}</span><span><span className="legend-dot muted-dot" />{t(`${students.length-complete} متبقٍ`,`${students.length-complete} remaining`)}</span></div>
          <div className="progress-breakdown">
            {[[t('الحفظ الجديد','Memorization'),recited,'#238468'],[t('المراجعة','Revision'),reviewed,'#d4ad62'],[t('الحضور','Attendance'),present,'#469884']].map(([label,count,color])=><div className="bar-row" key={label}><div><span>{label}</span><span>{count} / {students.length}</span></div><div className="bar-track"><i style={{width:(students.length?Number(count)/students.length*100:0)+'%',background:String(color)}}/></div></div>)}
          </div>
          <button className="btn btn-subtle full" onClick={()=>{setFilter(filter==='incomplete'?'all':'incomplete');document.querySelector('.roster')?.scrollIntoView({block:'nearest',behavior:'smooth'})}}><ListFilter size={16}/>{filter==='incomplete'?t('عرض جميع الطلاب','Show all students'):t('عرض الطلاب غير المكتملين','Show incomplete students')}</button>
        </section>
        <section className="assistant-callout"><span className="callout-icon"><Sparkles size={21}/></span><div><h3>{t('المساعد الذكي','Smart assistant')}</h3><p>{t('سجّل التسميع والحضور بأوامر مختصرة.','Log recitation and attendance with short commands.')}</p></div><button className="btn btn-white" onClick={()=>go('assistant')}>{t('فتح المساعد','Open assistant')}</button></section>
      </aside>
    </div>
  </>
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
      <section className="panel summary-panel"><span className="stat-icon tint-blue"><Sparkles size={20}/></span><h2>{t('رصيد النقاط','Points balance')}</h2><strong className="big-number">{balance}</strong>{!parent&&<button className="btn btn-outline" onClick={()=>go('store')}>{t('زيارة المتجر','Visit the store')}</button>}</section>
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
      <div className="chip-row"><button className="btn btn-outline" onClick={()=>go('records')}>{t('سجل الحفظ والحضور','Recitation and attendance')}</button><button className="btn btn-outline" onClick={()=>go('exams')}>{t('الاختبارات','Assessments')}</button><button className="btn btn-outline" onClick={()=>go('leaves')}>{t('طلب استئذان','Request leave')}</button></div>
    </section>
  </div>
}
