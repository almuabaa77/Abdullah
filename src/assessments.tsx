import { useEffect, useRef, useState } from 'react'
import { Activity, Award, BookOpen, CalendarDays, Check, ClipboardCheck, Clock3, Download, FileText, GraduationCap, History, ListChecks, Plus, Search, Settings, Video } from 'lucide-react'
import { quranVerses, type AssessmentStatus, type AssessmentView } from './assessment-model'
import { dayOffset, segmentLabel } from './domain'
import { Exams as LegacyExams } from './features'
import { Badge, dateLabel, Empty, Modal, normal, useWorkspace } from './ui'
import { AssessmentBooking, AssessmentEvaluation, AssessmentExtensionForm, AssessmentReview, AssessmentSettings, ManualAssessment, caseTitle, compactRange, errorLabels, type RunAssessment } from './assessment-forms'
import { AssessmentCertificateDialog } from './assessment-certificate'
import './assessments.css'

const statusLabels:Record<AssessmentStatus,[string,string]>={
  eligible:['مستحق للاختبار','Eligible'],preparing:['في فترة الاستعداد','Preparing'],ready:['جاهز للاختبار','Ready'],
  scheduled:['مجدول','Scheduled'],'in-progress':['جارٍ الاختبار','In progress'],recording:['بانتظار تسجيل النتيجة','Recording result'],
  'awaiting-result':['بانتظار تسجيل النتيجة','Awaiting result'],'pending-approval':['بانتظار اعتماد النتيجة','Awaiting approval'],
  passed:['مجتاز','Passed'],review:['يحتاج إلى مراجعة','Needs review'],retest:['إعادة الاختبار','Retest'],
  overdue:['متأخر عن الاختبار','Overdue'],cancelled:['ملغى','Cancelled'],
}
const filtersOpen=(item:AssessmentView)=>!['passed','cancelled','pending-approval'].includes(item.status)
const approvedResults=(item:AssessmentView)=>item.attempts.filter(attempt=>attempt.state==='approved')
type AssessmentTab='overview'|'eligible'|'practice'|'stage'|'calendar'|'extensions'|'results'|'certificates'|'reports'|'settings'|'legacy'
type Popup={mode:'detail'|'extension'|'review'|'booking'|'evaluate'|'certificate'|'decline'|'deadline'|'cancel'|'revoke';id:string}|{mode:'batch'|'manual'}

const assessmentTabs=[
  ['overview',Activity,'نظرة عامة','Overview'],
  ['eligible',ClipboardCheck,'الطلاب المستحقون','Eligible students'],
  ['practice',BookOpen,'الاختبارات التجريبية','Practice'],
  ['stage',GraduationCap,'الاختبارات المرحلية','Stages'],
  ['calendar',CalendarDays,'جدول الاختبارات','Calendar'],
  ['extensions',Clock3,'طلبات تمديد المهلة','Extensions'],
  ['results',ListChecks,'النتائج والتقييمات','Results'],
  ['certificates',Award,'الشهادات والإنجازات','Certificates'],
  ['reports',FileText,'التقارير والإحصائيات','Reports'],
  ['settings',Settings,'الإعدادات','Settings'],
  ['legacy',History,'الاختبارات السابقة','Legacy assessments'],
] as const

function Status({value}:{value:AssessmentStatus}) {
  const {t}=useWorkspace()
  return <span className="assessment-status" data-status={value}>{t(...statusLabels[value])}</span>
}

export function Assessments({embedded=false}:{embedded?:boolean}) {
  const {data,t,en,post,tell}=useWorkspace()
  const dashboard=data.assessmentDashboard??{items:[],roster:[],examiners:[]}
  const admin=data.user?.role==='admin',teacher=data.user?.role==='teacher',staff=admin||teacher
  const student=data.user?.role==='student'
  const [tab,setTab]=useState<AssessmentTab>('overview')
  const [popup,setPopup]=useState<Popup>()
  const [date,setDate]=useState(data.date)
  const [period,setPeriod]=useState('week')
  const [query,setQuery]=useState('')
  const [circle,setCircle]=useState('')
  const [teacherId,setTeacher]=useState('')
  const [kind,setKind]=useState('')
  const [status,setStatus]=useState('')
  const [studentId,setStudent]=useState('')
  const [since,setSince]=useState('')
  const [until,setUntil]=useState('')
  const [limit,setLimit]=useState(30)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const writing=useRef(false)
  const select=(mode:Exclude<Popup['mode'],'batch'|'manual'>,id:string)=>{setError('');setPopup({mode,id})}
  const close=()=>{if(!writing.current){setError('');setPopup(undefined)}}
  useEffect(()=>{
    function openLinked() {
      const id=sessionStorage.getItem('halaqat-assessment')??new URLSearchParams(location.search).get('assessment')
      if(id){sessionStorage.removeItem('halaqat-assessment');setPopup({mode:'detail',id})}
    }
    openLinked()
    window.addEventListener('halt-open-assessment',openLinked)
    window.addEventListener('popstate',openLinked)
    return ()=>{window.removeEventListener('halt-open-assessment',openLinked);window.removeEventListener('popstate',openLinked)}
  },[])
  useEffect(()=>setLimit(30),[tab,query,circle,teacherId,kind,status,studentId,since,until])
  const run:RunAssessment=async (action,payload)=>{
    if(writing.current)return false
    writing.current=true
    setBusy(true);setError('')
    try {await post(action,payload);tell(t('حُفظ التحديث','Changes saved'));return true}
    catch (error) {const message=(error as Error).message;setError(message);tell(message,true);return false}
    finally {writing.current=false;setBusy(false)}
  }
  const today=data.date
  const roster=dashboard.roster.filter(person=>!studentId||person.id===studentId)
  const teachers=new Map(data.circles.map(circle=>[circle.id,circle.teacherId]))
  const items=dashboard.items.filter(item=>{
    const relevant=item.appointment?.date??item.eligibleAt
    const matchText=normal([item.studentName,item.circleName,item.examinerName,caseTitle(item,en)].join(' ')).includes(normal(query))
    return matchText&&(!circle||item.circleId===circle)&&(!kind||item.kind===kind)&&(!status||item.status===status)&&
      (!studentId||item.studentId===studentId)&&(!teacherId||teacherId===teachers.get(item.circleId)||teacherId===item.appointment?.examinerId)&&
      (!since||relevant>=since)&&(!until||relevant<=until)
  })
  const openItems=items.filter(filtersOpen)
  const upcoming=items.filter(item=>item.appointment&&item.appointment.date>=today&&!['passed','cancelled'].includes(item.status))
    .sort((a,b)=>(a.appointment!.date+a.appointment!.time).localeCompare(b.appointment!.date+b.appointment!.time))
  const extensions=items.filter(item=>item.extensions.length)
  const pending=items.filter(item=>item.status==='pending-approval')
  const delayed=openItems.filter(item=>item.status==='overdue')
  const reviews=items.filter(item=>item.status==='review'||item.status==='retest')
  const certificates=items.filter(item=>item.certificate&&!item.certificate.revokedAt)
  const results=items.flatMap(approvedResults)
  const pass=results.length?Math.round(results.filter(result=>result.passed).length/results.length*100):0
  const avg=results.length?Math.round(results.reduce((a,result)=>a+result.score,0)/results.length):0
  const ready=openItems.filter(item=>item.readyStudent||item.readyTeacher)
  const casesWithDue=items.filter(item=>item.appointment)
  const inTime=casesWithDue.filter(item=>item.appointment!.date<=item.deadline).length
  const stats=[
    [ClipboardCheck,new Set(openItems.map(item=>item.studentId)).size,t('طلاب مستحقون','Eligible students')],
    [Check,new Set(ready.map(item=>item.studentId)).size,t('طلاب جاهزون','Ready students')],
    [CalendarDays,upcoming.filter(item=>item.appointment?.date===today).length,t('اختبارات اليوم','Today’s assessments')],
    [CalendarDays,upcoming.filter(item=>item.appointment!.date>today).length,t('اختبارات قادمة','Upcoming')],
    [Clock3,delayed.length,t('اختبارات متأخرة','Overdue')],
    [BookOpen,new Set(reviews.map(item=>item.studentId)).size,t('طلاب يحتاجون مراجعة','Students needing review')],
    [Clock3,extensions.filter(item=>item.extensions.some(request=>request.status==='pending')).length,t('تمديدات معلّقة','Pending extensions')],
    [ListChecks,pending.length,t('نتائج تنتظر الاعتماد','Awaiting approval')],
    [Activity,pass+'%',t('نسبة الاجتياز','Pass rate')],
    [Award,certificates.length,t('شهادات صادرة','Certificates')],
    [Activity,avg+' / 100',t('متوسط الدرجات','Average mark')],
  ] as const
  const attention=items.flatMap(item=>{
    const entry=(rank:number,label:string,action:string)=>[{item,rank,label,action}]
    if(item.status==='pending-approval')return entry(1,t('النتيجة بانتظار اعتماد الإدارة','The result awaits approval'),t('مراجعة النتيجة','Review result'))
    if(item.extensions.some(request=>request.status==='pending'))return entry(2,t('طلب تمديد بانتظار المراجعة','An extension is awaiting review'),t('عرض الطلب','Open request'))
    if(item.status==='overdue')return entry(3,t('انتهت مهلة الاستعداد','Preparation deadline passed'),t('متابعة الموعد','Review appointment'))
    if(item.kind==='stage'&&item.status==='passed'&&(!item.certificate||item.certificate.revokedAt))return entry(4,t('مرحلة معتمدة بانتظار شهادة سارية','An approved stage needs a valid certificate'),t('إدارة الشهادة','Manage certificate'))
    if(item.status==='retest'||item.status==='review')return entry(5,t('توصية بالمراجعة وإعادة الاختبار','Review and retest recommended'),t('متابعة الخطة','Review plan'))
    if(filtersOpen(item)&&item.remaining<=3)return entry(6,t('اقتربت نهاية المهلة','The deadline is approaching'),t('مراجعة الاستعداد','Check readiness'))
    if(!item.appointment&&filtersOpen(item))return entry(7,item.kind==='stage'?t('طالب مؤهل لاختبار مرحلي','Student is eligible for a stage'):t('اختبار مستحق دون موعد','Eligible assessment without an appointment'),t('فتح الاختبار','Open assessment'))
    const approved=approvedResults(item)
    if(approved.length>1&&approved.at(-1)!.score>approved.at(-2)!.score)return entry(8,t('تحسن مقارنة بالمحاولة السابقة','Improved since the last attempt'),t('عرض النتائج','View results'))
    const positions=approved.flatMap(result=>result.errors.filter(error=>error.surah&&error.verse).map(error=>error.surah+':'+error.verse))
    if(new Set(positions).size<positions.length)return entry(9,t('تكرّرت الأخطاء في مواضع من الحفظ','Errors recurred at specific verses'),t('عرض مواضع الأخطاء','Review error locations'))
    return []
  }).sort((a,b)=>a.rank-b.rank)
  const allowed=assessmentTabs.filter(([id])=>(id!=='legacy'||data.exams.length>0||staff)&&
    (staff||!['eligible','reports','settings'].includes(id))&&(admin||id!=='settings'))
  const currentPopup=popup&&'id' in popup?dashboard.items.find(item=>item.id===popup.id):undefined

  async function start(item:AssessmentView) {
    if(item.inProgress||await run('assessment-start',{id:item.id}))select('evaluate',item.id)
  }
  const resultLink=(item:AssessmentView)=>{
    if(!item.appointment?.lessonId)return
    const lesson=item.appointment.lessonId
    const path=admin?'/admin?section=lessons&lesson='+encodeURIComponent(lesson):'/?lesson='+encodeURIComponent(lesson)+'#lessons'
    return <a href={path} className="btn btn-outline compact"><Video size={16}/>{t('فتح جلسة الاختبار','Open assessment session')}</a>
  }
  function list(entries:AssessmentView[],showDate=false) {
    if(!entries.length)return <Empty title={t('لا توجد اختبارات مطابقة','No assessments match')}/>
    return <div className="assessment-table">
      <div className="assessment-table-head" aria-hidden="true"><span>{t('الاختبار والطالب','Assessment and student')}</span><span>{t('الحالة','Status')}</span><span>{showDate?t('الموعد','Appointment'):t('نهاية المهلة','Deadline')}</span><span>{t('التفاصيل','Details')}</span></div>
      {entries.slice(0,limit).map(item=><article key={item.id} className="assessment-row">
        <div><strong>{caseTitle(item,en)}</strong><p>{item.studentName} · {item.circleName}</p></div>
        <div><Status value={item.status}/></div>
        <div><time dateTime={showDate?item.appointment?.date:item.deadline}>{dateLabel(showDate?item.appointment?.date??item.deadline:item.deadline,en)}</time>
          {showDate&&item.appointment&&<small> · <bdi>{item.appointment.time}</bdi></small>}</div>
        <button className="btn btn-outline compact" type="button" onClick={()=>select('detail',item.id)}>{t('عرض الاختبار','View assessment')}</button>
      </article>)}
      {entries.length>limit&&<button className="btn btn-outline compact" type="button" onClick={()=>setLimit(n=>n+30)}>{t('عرض المزيد','Show more')}</button>}
    </div>
  }
  const calendarStart=period==='day'?date:period==='week'?dayOffset(date,-new Date(date+'T12:00Z').getUTCDay()):date.slice(0,7)+'-01'
  const monthEnd=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).toISOString().slice(0,10)
  const calendarEnd=period==='day'?date:period==='week'?dayOffset(calendarStart,6):monthEnd
  const calendarItems=items.filter(item=>item.appointment&&!item.cancelledAt&&item.appointment.date>=calendarStart&&item.appointment.date<=calendarEnd)
    .sort((a,b)=>(a.appointment!.date+a.appointment!.time).localeCompare(b.appointment!.date+b.appointment!.time))
  const daysInView=period==='day'?[]:Array.from({length:period==='week'?7:Number(calendarEnd.slice(-2))},(_,i)=>dayOffset(calendarStart,i))
  const weekday=new Date(daysInView[0]+'T12:00Z').getUTCDay()
  const first=upcoming[0]??openItems.slice().sort((a,b)=>a.deadline.localeCompare(b.deadline))[0]
  const frequent=new Map<string,{label:string;count:number}>()
  for(const result of results)for(const error of result.errors)if(error.surah&&error.verse){
    const key=error.surah+':'+error.verse
    const entry=frequent.get(key)
    if(entry)entry.count++
    else frequent.set(key,{label:key,count:1})
  }
  const weak=[...frequent.values()].sort((a,b)=>b.count-a.count).slice(0,8)
  const ringReports=data.circles.filter(ring=>!circle||ring.id===circle).map(ring=>{
    const exams=items.filter(item=>item.circleId===ring.id)
    const attempts=exams.flatMap(approvedResults)
    const total=attempts.length
    return {ring,exams:exams.length,total,average:total?Math.round(attempts.reduce((sum,attempt)=>sum+attempt.score,0)/total):0,passed:total?Math.round(attempts.filter(attempt=>attempt.passed).length/total*100):0}
  })
  const monthly=new Map<string,{sum:number;count:number}>()
  for(const result of results){
    if(!result.approvedAt)continue
    const key=result.approvedAt.slice(0,7),entry=monthly.get(key)??{sum:0,count:0}
    entry.count++;entry.sum+=result.score;monthly.set(key,entry)
  }
  const attentionItems=attention.slice(0,12)
  async function exportReport() {
    try {
      const {exportWorkbook}=await import('./export')
      await exportWorkbook([[t('تقرير الاختبارات','Assessments report'),today],
        [t('الطالب','Student'),t('الحلقة','Circle'),t('الاختبار','Assessment'),t('الحالة','Status'),t('المهلة','Deadline'),t('الموعد','Appointment'),t('المختبر','Examiner'),t('عدد المحاولات','Attempts'),t('النتيجة','Result'),t('طلبات التمديد','Extensions'),t('رقم الشهادة السارية','Valid certificate serial')],
        ...items.map(item=>[item.studentName,item.circleName,caseTitle(item,en),t(...statusLabels[item.status]),item.deadline,item.appointment?.date??'',item.examinerName??'',approvedResults(item).length,approvedResults(item).at(-1)?.score??'',item.extensions.length,item.certificate?.revokedAt?'':item.certificate?.id??'']),
        [],[t('أداء الحلقات','Circle performance'),t('الاختبارات','Assessments'),t('المحاولات المعتمدة','Approved attempts'),t('متوسط الدرجات','Mean score'),t('نسبة الاجتياز','Pass rate')],
        ...ringReports.map(({ring,exams,total,average,passed})=>[ring.name,exams,total,average,passed+'%']),
        [],[t('الشهر','Month'),t('متوسط الدرجات','Mean score'),t('المحاولات المعتمدة','Approved attempts')],
        ...[...monthly].sort(([a],[b])=>b.localeCompare(a)).map(([month,{count,sum}])=>[month,Math.round(sum/count),count]),
        [],[t('مواضع الأخطاء','Error locations'),t('عدد مرات التسجيل','Occurrences')],
        ...weak.map(({label,count})=>[label,count]),
      ],'halaqat-assessments-'+today,!en)
    } catch (error) {
      tell((error as Error).message,true)
    }
  }

  return <section className={'assessments'+(embedded?' assessment-embedded':'')}>
    <header className="assessment-heading">
      <div><span className="stat-icon tint-green"><GraduationCap size={24}/></span><h1>{student?t('اختباراتي','My assessments'):staff?t('منظومة الاختبارات','Assessment center'):t('اختبارات الأبناء','Family assessments')}</h1></div>
      {admin&&<div className="chip-row">
        <button type="button" className="btn btn-outline compact" onClick={()=>{setError('');setPopup({mode:'manual'})}}><Plus size={16}/>{t('إضافة استحقاق','Add assessment')}</button>
        <button type="button" className="btn btn-primary compact" onClick={()=>{setError('');setPopup({mode:'batch'})}}><CalendarDays size={16}/>{t('جدولة مجموعة','Schedule group')}</button>
      </div>}
    </header>
    <nav className="assessment-tabs" aria-label={t('أقسام الاختبارات','Assessment sections')}>
      {allowed.map(([id,Icon,ar,english])=><button type="button" key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><Icon size={17}/>{t(ar,english)}</button>)}
    </nav>
    {!['settings','legacy'].includes(tab)&&<details className="assessment-filters" open={staff||undefined}><summary><Search size={16}/>{t('البحث والتصفية','Search and filters')}</summary>
      <div className="assessment-fields">
        {staff&&<label>{t('اسم الطالب أو المحفظ أو الحلقة','Student, teacher, or circle')}<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label>}
        {staff&&<label>{t('الحلقة','Circle')}<select value={circle} onChange={event=>setCircle(event.target.value)}><option value="">{t('كل الحلقات','All circles')}</option>{data.circles.map(ring=><option key={ring.id} value={ring.id}>{ring.name}</option>)}</select></label>}
        {admin&&<label>{t('المحفظ أو المختبر','Teacher or examiner')}<select value={teacherId} onChange={event=>setTeacher(event.target.value)}><option value="">{t('جميع المحفظين','All teachers')}</option>{dashboard.examiners.map(examiner=><option key={examiner.id} value={examiner.id}>{examiner.name}</option>)}</select></label>}
        {dashboard.roster.length>1&&<label>{t('الطالب','Student')}<select value={studentId} onChange={event=>setStudent(event.target.value)}><option value="">{t('جميع الطلاب','All students')}</option>{dashboard.roster.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
        <label>{t('نوع الاختبار','Assessment type')}<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">{t('كل الأنواع','All types')}</option><option value="practice">{t('تجريبي','Practice')}</option><option value="stage">{t('مرحلي','Stage')}</option></select></label>
        <label>{t('الحالة','Status')}<select value={status} onChange={event=>setStatus(event.target.value)}><option value="">{t('كل الحالات','All statuses')}</option>{Object.entries(statusLabels).map(([id,[ar,english]])=><option key={id} value={id}>{t(ar,english)}</option>)}</select></label>
        <label>{t('من تاريخ','From date')}<input type="date" value={since} onChange={event=>setSince(event.target.value)}/></label><label>{t('إلى تاريخ','Through date')}<input type="date" value={until} onChange={event=>setUntil(event.target.value)}/></label>
      </div>
    </details>}
    {tab==='overview'&&(staff?<>
      <div className="assessment-metrics">{stats.map(([Icon,value,label])=><article key={label}><Icon size={17}/><strong>{value}</strong><span>{label}</span></article>)}</div>
      <section className="assessment-panel"><h2>{t('يتطلب انتباهك','Needs attention')}</h2>
        {attentionItems.length?<ul className="assessment-attention">{attentionItems.map(entry=><li key={entry.item.id}><div><strong>{entry.label}</strong><p>{entry.item.studentName} · {caseTitle(entry.item,en)}</p></div>
          <button className="btn btn-outline compact" type="button" onClick={()=>select('detail',entry.item.id)}>{entry.action}</button></li>)}</ul>:<Empty title={t('لا توجد حالات تستدعي إجراءً الآن','Nothing needs attention right now')}/>}
      </section>
    </>:<>
      {first?<article className="assessment-panel assessment-next"><div><h2>{t('الاختبار القادم','Upcoming assessment')}</h2><strong>{caseTitle(first,en)} · {first.studentName}</strong><p>{compactRange(first.parts,en)}</p>
        <p>{t('أيام الاستعداد المتبقية','Preparation days left')} · {first.remaining} · {dateLabel(first.deadline,en,true)}</p></div>
        <div><Status value={first.status}/><button className="btn btn-primary compact" type="button" onClick={()=>select('detail',first.id)}>{t('تفاصيل الاختبار','Assessment details')}</button></div></article>
        :<Empty title={t('لا يوجد اختبار قادم','No upcoming assessment')}/>}
      <section className="assessment-panel"><h2>{t('مسار الإنجاز','Memorization progress')}</h2>
        {roster.map(person=>{
          const exams=dashboard.items.filter(item=>item.studentId===person.id),marks=exams.flatMap(approvedResults).sort((a,b)=>(a.approvedAt??'').localeCompare(b.approvedAt??''))
          return <article className="assessment-journey" key={person.id}><strong>{person.name}</strong><p>{t('نسبة الآيات المحفوظة','Verses memorized')} · {Math.round(person.covered/quranVerses*100)}%</p><progress max={quranVerses} value={person.covered}/>
            <div className="assessment-journey-parts">{person.route.map(part=><span key={part} data-step={person.stageParts.includes(part)?'certified':person.practiceParts.includes(part)?'tested':person.parts.includes(part)?'ready':'future'}
              title={person.stageParts.includes(part)?t('مرحلة معتمدة','Approved stage'):person.practiceParts.includes(part)?t('اجتاز التجريبي','Practice passed'):person.parts.includes(part)?t('محفوظ','Memorized'):t('قادم','Upcoming')}>{part}</span>)}</div>
            <p>{t('الأجزاء المختبرة تجريبيًا','Parts tested')} {person.tested} · {t('محاولات معتمدة','Approved attempts')} {marks.length} ·
              {t(' أفضل نتيجة',' Best mark')} {marks.length?Math.max(...marks.map(mark=>mark.score)):'—'} · {t('المتوسط','Average')} {marks.length?Math.round(marks.reduce((sum,mark)=>sum+mark.score,0)/marks.length):'—'}</p>
            {person.route.find(part=>!person.parts.includes(part))&&<p>{t('الهدف القادم','Next goal')} · {t('الجزء','Part')} {person.route.find(part=>!person.parts.includes(part))}</p>}
            {!!marks.length&&<p>{t('أحدث تقييم للتجويد','Latest Tajwid mark')} · {marks.at(-1)?.scores[1]}</p>}
            {exams.length>0&&<button className="btn btn-outline compact" type="button" onClick={()=>{setStudent(person.id);setTab('results')}}>{t('عرض سجل الإنجاز','View assessment history')}</button>}
          </article>
        })}
      </section>
    </>)}

    {tab==='eligible'&&list(openItems)}
    {tab==='practice'&&list(items.filter(item=>item.kind==='practice'))}
    {tab==='stage'&&list(items.filter(item=>item.kind==='stage'))}
    {tab==='calendar'&&<section className="assessment-panel">
      <div className="assessment-calendar-head"><label>{t('التاريخ','Date')}<input type="date" value={date} onChange={event=>{if(event.target.value)setDate(event.target.value)}}/></label>
        <div className="seg-toggle">{([['day','يومي','Day'],['week','أسبوعي','Week'],['month','شهري','Month']] as const).map(([value,ar,english])=>
          <button type="button" key={value} aria-pressed={period===value} className={period===value?'selected':''} onClick={()=>setPeriod(value)}>{t(ar,english)}</button>)}</div>
        <span>{dateLabel(calendarStart,en)} – {dateLabel(calendarEnd,en)}</span></div>
      {daysInView.length>0&&<div className="assessment-calendar-grid">
        {(en?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت']).map(name=><span key={name}>{name}</span>)}
        {daysInView.map((day,index)=>{
          const count=calendarItems.filter(item=>item.appointment?.date===day).length
          return <button key={day} type="button" style={index===0?{gridColumnStart:weekday+1}:undefined} aria-current={day===today?'date':undefined}
            aria-label={dateLabel(day,en,true)+' · '+count+' '+t('اختبارات','assessments')} onClick={()=>{setDate(day);setPeriod('day')}}>
            <strong>{Number(day.slice(-2))}</strong>{count>0&&<small>{count}</small>}
          </button>
        })}
      </div>}
      {list(calendarItems,true)}
    </section>}
    {tab==='extensions'&&list(extensions.slice().sort((a,b)=>Number(b.extensions.some(request=>request.status==='pending'))-Number(a.extensions.some(request=>request.status==='pending'))))}
    {tab==='results'&&list(items.filter(item=>approvedResults(item).length||staff&&item.status==='pending-approval'))}
    {tab==='certificates'&&list(admin?items.filter(item=>item.kind==='stage'&&item.status==='passed'):certificates)}
    {tab==='settings'&&admin&&<AssessmentSettings data={dashboard} run={run} busy={busy}/>}
    {tab==='legacy'&&<LegacyExams embedded/>}
    {tab==='reports'&&staff&&<section className="assessment-panel assessment-printable-report">
      <div className="split-line"><h2>{t('أداء الحلقات','Circle performance')}</h2><div className="chip-row">
        <button type="button" className="btn btn-outline compact" onClick={()=>void exportReport()}><Download size={15}/>Excel</button>
        <button type="button" className="btn btn-outline compact" onClick={()=>window.print()}><FileText size={15}/>PDF</button>
      </div></div>
      <div className="assessment-report-grid">
        {ringReports.map(({ring,exams,total,average,passed})=><article key={ring.id}><strong>{ring.name}</strong>
          <p>{exams} {t('اختبارات','assessments')} · {total} {t('محاولات معتمدة','approved attempts')} · {t('المتوسط','Average')} {average}</p>
          <progress value={passed} max={100}/><span>{t('الاجتياز','Pass rate')} {passed}%</span></article>)}
      </div>
      <p>{t('الالتزام بالمهل في المواعيد المجدولة','Scheduled within deadline')} · {casesWithDue.length?Math.round(inTime/casesWithDue.length*100):0}% · {inTime}/{casesWithDue.length}</p>
      <section className="assessment-report-grid">
        <article><h3>{t('تطور الدرجات شهريًا','Monthly marks')}</h3>{[...monthly].sort(([a],[b])=>b.localeCompare(a)).slice(0,12).map(([month,values])=><p key={month}>{month} · {Math.round(values.sum/values.count)} / 100</p>)}</article>
        <article><h3>{t('المواضع الأكثر ورودًا في الأخطاء','Most frequent error locations')}</h3>{weak.map(entry=><p key={entry.label}><bdi>{entry.label}</bdi> · {entry.count}</p>)}</article>
        <article><h3>{t('الاختبارات المعتمدة لكل مختبر','Approved results by examiner')}</h3>{[...new Set(results.map(result=>result.evaluator))].map(examiner=><p key={examiner}>{examiner} · {results.filter(result=>result.evaluator===examiner).length}</p>)}</article>
        <article><h3>{t('تقدم المسارات','Route progress')}</h3><p>{t('الأجزاء المجتازة مرحليًا','Passed stage parts')} · {roster.reduce((sum,person)=>sum+person.stageParts.length,0)}</p>
          <p>{t('الشهادات السارية','Valid certificates')} {certificates.length} · {t('طلبات التمديد','Extension requests')} {extensions.length}</p></article>
      </section>
      <h3>{t('الاختبارات المتأخرة','Overdue assessments')}</h3>{list(delayed)}
    </section>}
    {error&&!popup&&<div className="error-box" role="alert">{error}</div>}
    {popup?.mode==='manual'&&<ManualAssessment dashboard={dashboard} run={run} busy={busy} close={close}/>}
    {popup?.mode==='batch'&&<AssessmentBooking items={openItems.filter(item=>!item.inProgress)} dashboard={dashboard} run={run} busy={busy} close={close}/>}
    {popup&&'id' in popup&&!currentPopup&&<Modal title={t('الاختبار','Assessment')} close={close}><div className="modal-body"><Empty title={t('الاختبار غير متاح لهذا الحساب','The assessment is unavailable for this account')}/></div></Modal>}
    {currentPopup&&popup?.mode==='extension'&&<AssessmentExtensionForm item={currentPopup} run={run} busy={busy} close={close}/>}
    {currentPopup&&popup?.mode==='review'&&<AssessmentReview item={currentPopup} run={run} busy={busy} close={close}/>}
    {currentPopup&&popup?.mode==='booking'&&<AssessmentBooking item={currentPopup} items={[]} dashboard={dashboard} run={run} busy={busy} close={close}/>}
    {currentPopup&&popup?.mode==='evaluate'&&<AssessmentEvaluation item={currentPopup} close={close}/>}
    {currentPopup?.certificate&&popup?.mode==='certificate'&&<AssessmentCertificateDialog item={currentPopup} close={close}/>}
    {currentPopup&&popup?.mode==='detail'&&(()=>{
      const item=currentPopup,mutable=filtersOpen(item)
      const extension=item.extensions.find(request=>request.status==='pending')
      const last=item.attempts.at(-1)
      return <Modal title={caseTitle(item,en)} wide appearance="assessment-modal" close={close}>
        <div className="modal-body">
          <div className="assessment-eval-head"><div><strong>{item.studentName}</strong><p>{item.circleName}</p></div><Status value={item.status}/></div>
          <div className="assessment-details-grid">
            <div><strong>{t('استحقاق الاختبار','Eligible since')}</strong><span>{dateLabel(item.eligibleAt,en,true)}</span></div>
            <div><strong>{t('نهاية المهلة','Preparation deadline')}</strong><span>{dateLabel(item.deadline,en,true)} · {item.remaining} {t('أيام عمل متبقية','working days left')}</span></div>
            <div><strong>{t('المختبر أو المحفظ','Examiner or teacher')}</strong><span>{item.examinerName||'—'}</span></div>
            <div><strong>{t('الجاهزية','Readiness')}</strong><span>{item.readyTeacher?t('أكّد المحفظ الجاهزية','Teacher confirmed readiness'):item.readyStudent?t('الطالب مستعد','Student is ready'):t('قيد الاستعداد','Preparing')}</span></div>
            {item.retryDate&&<div><strong>{t('أقرب تاريخ لإعادة الاختبار','Earliest retake date')}</strong><span>{dateLabel(item.retryDate,en,true)}</span></div>}
            {item.appointment&&<div><strong>{t('موعد الاختبار','Appointment')}</strong><span>{dateLabel(item.appointment.date,en,true)} · <bdi>{item.appointment.time}</bdi> · {item.appointment.place}</span></div>}
            {item.proposed&&<div><strong>{t('موعد مقترح للإدارة','Proposed appointment')}</strong><span>{dateLabel(item.proposed.date,en,true)} · <bdi>{item.proposed.time}</bdi></span></div>}
          </div>
          <details><summary>{t('نطاق السور والآيات','Surah and verse range')}</summary><p>{compactRange(item.parts,en)}</p><p>{t('الأجزاء','Parts')} · {item.parts.join('، ')}</p></details>
          {item.extensions.map(request=><article className="assessment-detail-entry" key={request.id}>
            <strong>{t('تمديد مهلة الاستعداد','Preparation extension')} · {request.days} {t('أيام عمل','working days')}</strong> <Badge status={request.status}/>
            <p>{request.reason}</p>{request.decisionNote&&<p>{request.decisionNote}</p>}
            {request.status==='pending'&&<p>{t('المهلة المتوقعة بعد الموافقة','Expected deadline if approved')} · {dateLabel(request.expected,en,true)}</p>}
          </article>)}
          {item.attempts.filter(attempt=>attempt.state==='approved'||staff&&attempt.state==='submitted').map((attempt,i)=><article className="assessment-detail-entry" key={attempt.id}>
            <strong>{t('المحاولة','Attempt')} {i+1} · {attempt.score}/100</strong>
            {attempt.grade&&<span> · {en?attempt.grade.en:attempt.grade.ar}</span>}
            <p>{attempt.evaluator} {attempt.approvedAt&&' · '+dateLabel(attempt.approvedAt.slice(0,10),en)}</p>
            <div className="chip-row">{item.criteria?.map((criterion,index)=><span className="pill subtle" key={index}>{t(criterion.ar,criterion.en)} · {attempt.scores[index]}/{item.weights[index]}</span>)}</div>
            {attempt.feedback&&<p>{attempt.feedback}</p>}
            {staff&&attempt.errors.length>0&&<details><summary>{t('مواضع الأخطاء وملاحظات المختبر','Error locations and examiner notes')} · {attempt.errors.length}</summary>
              <ul>{attempt.errors.map((entry,index)=><li key={index}>{t(errorLabels[entry.kind][0],errorLabels[entry.kind][1])}
                {entry.surah&&entry.verse?' · '+segmentLabel([{surah:entry.surah,from:entry.verse,to:entry.verse}],en):''}{entry.note?' · '+entry.note:''}</li>)}</ul>
            </details>}
          </article>)}
          {error&&<p className="error-box" role="alert">{error}</p>}
          <div className="chip-row">
            {resultLink(item)}
            <button className="btn btn-outline compact" type="button" onClick={()=>select('review',item.id)}><BookOpen size={15}/>{t('خطة المراجعة','Review plan')}</button>
            {mutable&&student&&item.extendThrough.length>0&&<button className="btn btn-outline compact" type="button" onClick={()=>select('extension',item.id)}>{t('طلب تمديد المهلة','Request extension')}</button>}
            {mutable&&(student||staff)&&<button className="btn btn-outline compact" type="button" disabled={busy||(student?item.readyStudent:item.readyTeacher)}
              onClick={()=>void run('assessment-ready',{id:item.id})}><Check size={15}/>{student?t('أنا مستعد للاختبار','I am ready'):t('تأكيد جاهزية الطالب','Confirm readiness')}</button>}
            {mutable&&staff&&item.kind==='stage'&&!item.nominated&&<button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void run('assessment-nominate',{id:item.id})}>{t('ترشيح للمرحلة','Nominate for stage')}</button>}
            {mutable&&staff&&!item.inProgress&&<button className="btn btn-outline compact" type="button" onClick={()=>select('booking',item.id)}>{item.canSchedule?t('ضبط الموعد','Set appointment'):t('اقتراح موعد','Propose appointment')}</button>}
            {item.canAssess&&mutable&&(!item.retryDate||today>=item.retryDate)&&<button className="btn btn-primary compact" type="button" disabled={busy} onClick={()=>void start(item)}>{item.inProgress?t('استكمال التقييم','Resume evaluation'):t('بدء التقييم','Start evaluation')}</button>}
            {item.canApprove&&last?.state==='submitted'&&<><button className="btn btn-primary compact" type="button" disabled={busy} onClick={()=>void run('assessment-approve',{id:item.id})}>{last.score>=item.passMark?t('اعتماد الاجتياز','Approve pass'):t('اعتماد توصية المراجعة','Approve review recommendation')}</button>
              {last.score<item.passMark&&<button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void run('assessment-approve',{id:item.id,retest:true})}>{t('اعتماد إعادة الاختبار','Approve retest')}</button>}</>}
            {admin&&mutable&&extension&&<><button className="btn btn-primary compact" type="button" disabled={busy} onClick={()=>void run('assessment-extension-review',{id:item.id,requestId:extension.id,status:'accepted'})}>{t('اعتماد التمديد','Approve extension')}</button>
              <button className="btn btn-outline compact" type="button" onClick={()=>select('decline',item.id)}>{t('رفض التمديد','Decline extension')}</button></>}
            {admin&&mutable&&<><button className="btn btn-outline compact" type="button" onClick={()=>select('deadline',item.id)}>{t('تعديل المهلة استثنائيًا','Adjust deadline')}</button>
              <button className="btn btn-outline compact" type="button" onClick={()=>select('cancel',item.id)}>{t('خيارات الإلغاء','Cancellation options')}</button></>}
            {item.certificate&&<button className="btn btn-primary compact" type="button" onClick={()=>select('certificate',item.id)}><Award size={15}/>{t('عرض الشهادة','View certificate')}</button>}
            {admin&&item.status==='cancelled'&&<button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void run('assessment-reopen',{id:item.id})}>{t('إعادة فتح الاختبار','Reopen assessment')}</button>}
            {admin&&item.status==='passed'&&item.kind==='stage'&&(!item.certificate||item.certificate.revokedAt)&&<button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void run('assessment-certificate-issue',{id:item.id})}>{t('إصدار شهادة','Issue certificate')}</button>}
            {admin&&item.certificate&&!item.certificate.revokedAt&&<button className="btn btn-outline compact" type="button" onClick={()=>select('revoke',item.id)}>{t('إلغاء الشهادة','Revoke certificate')}</button>}
          </div>
        </div>
      </Modal>
    })()}
    {currentPopup&&popup&&['decline','deadline','cancel','revoke'].includes(popup.mode)&&(()=>{
      const item=currentPopup
      const title=popup.mode==='decline'?t('رفض طلب التمديد','Decline extension'):popup.mode==='deadline'?t('تعديل المهلة','Adjust deadline'):
        popup.mode==='cancel'?t('إلغاء الموعد أو الاختبار','Cancel appointment or assessment'):t('إلغاء الشهادة','Revoke certificate')
      return <Modal title={title} close={close}><form onSubmit={async event=>{
        event.preventDefault()
        const f=new FormData(event.currentTarget),reason=f.get('reason')
        const action=popup.mode==='decline'?'assessment-extension-review':popup.mode==='deadline'?'assessment-deadline':
          popup.mode==='cancel'?(f.get('cancel')==='appointment'?'assessment-unschedule':'assessment-cancel'):'assessment-certificate-revoke'
        if(await run(action,{id:item.id,reason,date:f.get('date'),status:'declined',requestId:item.extensions.find(request=>request.status==='pending')?.id}))select('detail',item.id)
      }}><div className="modal-body">
        {popup.mode==='deadline'&&<label>{t('تاريخ نهاية المهلة','Deadline')}<input type="date" name="date" min={today} defaultValue={item.deadline} required/></label>}
        {popup.mode==='cancel'&&<label>{t('الإجراء','Action')}<select name="cancel">{item.appointment&&<option value="appointment">{t('إلغاء الموعد فقط','Cancel appointment only')}</option>}<option value="case">{t('إلغاء الاختبار','Cancel assessment')}</option></select></label>}
        <label>{t('سبب الإجراء','Reason')}<textarea name="reason" required maxLength={300}/></label>
        {error&&<p className="error-box" role="alert">{error}</p>}
      </div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('حفظ القرار','Save decision')}</button></div></form></Modal>
    })()}
  </section>
}
