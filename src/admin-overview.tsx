import { useMemo, useState } from 'react'
import { Activity, ArrowUpRight, Award, BookOpen, CalendarDays, ClipboardList, GraduationCap, Link2, UserCheck, Users } from 'lucide-react'
import { quranVerses } from './assessment-model'
import { completedVerses, dayOffset } from './domain'
import { dateLabel, Empty, useWorkspace } from './ui'

type OverviewPage='circles'|'students'|'people'|'links'|'records'|'exams'|'points-review'|'legacy'
const percentage=(total:number,count:number)=>count?Math.round(100*total/count):null

export function AdminOverview({open}:{open:(page:OverviewPage)=>void}) {
  const {data,t,en}=useWorkspace()
  const [circle,setCircle]=useState('')
  const [days,setDays]=useState(30)
  const [detail,setDetail]=useState(false)
  const firstDay=days?dayOffset(data.date,1-days):'0000-01-01'
  const calculated=useMemo(()=>{
    const students=data.students.filter(student=>!circle||student.circleId===circle)
    const ids=new Set(students.map(student=>student.id))
    const history=new Map<string,typeof data.daily>()
    const dated=new Map<string,{date:string;present:number;total:number;memorized:number}>()
    let present=0,attendance=0,memorized=0,records=0
    for(const record of data.daily){
      if(!ids.has(record.studentId))continue
      const person=history.get(record.studentId)??[]
      person.push(record);history.set(record.studentId,person)
      if(record.date<firstDay||record.date>data.date)continue
      const point=dated.get(record.date)??{date:record.date,present:0,total:0,memorized:0}
      if(record.attendance!=='pending'){
        attendance++;point.total++
        if(record.attendance==='present'){present++;point.present++}
      }
      if(record.memorizationStatus==='complete'&&record.memorization.length){memorized++;point.memorized++}
      records++;dated.set(record.date,point)
    }
    const active=students.filter(student=>student.active).map(student=>({
      student,verses:completedVerses(history.get(student.id)??[]),
    })).sort((a,b)=>a.student.name.localeCompare(b.student.name,en?'en':'ar'))
    let attempts=0,passed=0,certificates=0,legacy=0
    const since=(date:string)=>date>=firstDay&&date<=data.date
    for(const exam of data.assessmentDashboard?.items??[]){
      if(!ids.has(exam.studentId))continue
      if(exam.certificate&&!exam.certificate.revokedAt&&since(exam.certificate.issuedAt.slice(0,10)))certificates++
      for(const attempt of exam.attempts){
        if(attempt.state!=='approved'||!attempt.approvedAt||!since(attempt.approvedAt.slice(0,10)))continue
        attempts++
        if(attempt.passed)passed++
      }
    }
    for(const exam of data.exams)if(since(exam.date))for(const [id,result] of Object.entries(exam.results))if(ids.has(id)&&Number.isFinite(result.score))legacy++
    return {active,present,attendance,memorized,records,attempts,passed,certificates,legacy,trend:[...dated.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-10)}
  },[data.students,data.daily,data.date,data.exams,data.assessmentDashboard,circle,firstDay,en])
  const {active,present,attendance,memorized,records,attempts,passed,certificates,legacy,trend}=calculated
  const progress=percentage(active.reduce((sum,item)=>sum+item.verses,0),active.length*quranVerses)
  const number=new Intl.NumberFormat(en?'en':'ar')
  const fmt=(value:number)=>number.format(value)
  const percent=(value:number|null)=>value===null?'—':new Intl.NumberFormat(en?'en':'ar',{style:'percent'}).format(value/100)
  const cards=[
    [GraduationCap,t('الطلاب النشطون','Active students'),fmt(active.length),'students'],
    [UserCheck,t('الحضور من الحالات المسجلة','Attendance across recorded statuses'),percent(percentage(present,attendance)),'records'],
    [BookOpen,t('تسميعات الحفظ المكتملة','Completed memorization records'),fmt(memorized),'records'],
    [ClipboardList,t('السجلات خلال الفترة','Records in period'),fmt(records),'records'],
    [Award,t('نسبة اجتياز المحاولات المعتمدة','Pass rate for approved attempts'),percent(percentage(passed,attempts)),'exams'],
    [CalendarDays,t('شهادات سارية صدرت خلال الفترة','Valid certificates issued in period'),fmt(certificates),'exams'],
  ] as const
  const accounts=data.users.filter(user=>user.status==='pending'&&!user.duplicateOf&&(!circle||user.enrollmentCircleId===circle)).length
  const relevantIds=new Set(data.students.filter(student=>!circle||student.circleId===circle).map(student=>student.id))
  const links=data.links.filter(link=>link.status==='pending'&&(!circle||relevantIds.has(link.studentId))).length
  const reviewCount=data.legacyPointReviews?.filter(item=>!item.decision).length??0
  return <div className="admin-overview">
    <div className="overview-banner">
      <div><p>{dateLabel(data.date,en,true)}</p><h3>{t('أهلًا بك','Welcome')}{data.user?.name?'، '+data.user.name:''}</h3>
        <p>{t('الحضور والحفظ والاختبارات خلال الفترة المحددة','Attendance, memorization and assessments for the selected period')}</p></div>
      <div className="chip-row"><button type="button" className="btn btn-outline compact" onClick={()=>open('points-review')}>{t('تسوية النقاط','Points reconciliation')} <bdi>{fmt(reviewCount)}</bdi></button>
        {data.legacyArchive&&<button type="button" className="btn btn-outline compact" onClick={()=>open('legacy')}>{t('الأرشيف السابق','Legacy archive')}</button>}</div>
    </div>
    <div className="admin-overview-filters">
      <label>{t('الحلقة','Circle')}<select value={circle} onChange={event=>{setCircle(event.target.value);setDetail(false)}}>
        <option value="">{t('جميع الحلقات','All circles')}</option>
        {data.circles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="admin-overview-period" role="group" aria-label={t('الفترة','Period')}>
        {([[7,'٧ أيام','7 days'],[30,'٣٠ يومًا','30 days'],[90,'٩٠ يومًا','90 days'],[0,'كل المدة','All time']] as const).map(([period,ar,english])=>
          <button className="btn btn-outline compact" type="button" key={period} aria-pressed={days===period} onClick={()=>setDays(period)}>{t(ar,english)}</button>)}
      </div>
    </div>
    <div className="summary-grid admin-metrics">
      {cards.map(([Icon,label,value,page])=><button type="button" key={label} className="record-tile admin-metric" onClick={()=>open(page)}>
        <span className="stat-icon tint-green"><Icon size={18}/></span><strong className="big-number">{value}</strong><span>{label}</span>
      </button>)}
    </div>
    <div className="admin-overview-columns">
      <section>
        <h3><Activity size={17}/>{t('الحضور في آخر أيام التسجيل','Attendance on recent recorded days')}</h3>
        {trend.length?<ol className="admin-overview-trend">{trend.map(point=><li key={point.date}>
          <time dateTime={point.date}>{dateLabel(point.date,en)}</time>
          <meter min={0} max={100} value={percentage(point.present,point.total)??0} aria-label={t('الحضور','Attendance')+' '+dateLabel(point.date,en)}/>
          <span>{percent(percentage(point.present,point.total))}</span>
        </li>)}</ol>:<Empty title={t('لا توجد سجلات لهذه الفترة','No records in this period')}/>}
      </section>
      <section>
        <h3><BookOpen size={17}/>{t('تقدم الحفظ التراكمي','Cumulative memorization progress')}</h3>
        <p>{t('متوسط عدد الآيات الفريدة المحفوظة من كامل المصحف للطلاب النشطين','Average share of unique Quran verses memorized by active students')}</p>
        <strong className="big-number">{percent(progress)}</strong>
        {progress!==null&&<progress max={100} value={progress} aria-label={t('متوسط تقدم الحفظ','Average memorization progress')}/>}
        {active.length>0&&<button className="btn btn-outline compact" type="button" aria-expanded={detail} onClick={()=>setDetail(open=>!open)}>
          {detail?t('إخفاء تفاصيل الطلاب','Hide student details'):t('عرض تقدم الطلاب','View student progress')}
        </button>}
        {detail&&<ul className="admin-overview-students">{active.map(({student,verses})=><li key={student.id}><span>{student.name}</span><bdi>{fmt(verses)} / {fmt(quranVerses)} · {percent(percentage(verses,quranVerses))}</bdi></li>)}</ul>}
      </section>
    </div>
    <div className="admin-overview-links">
      {([[Users,t('طلبات التسجيل','Registration requests'),accounts,'people'],[Link2,t('طلبات الربط','Family link requests'),links,'links'],
        [Award,t('محاولات معتمدة','Approved attempts'),attempts,'exams'],[ClipboardList,t('نتائج الاختبارات السابقة','Legacy assessment results'),legacy,'exams']] as const).map(([Icon,label,count,page])=>
        <button type="button" className="btn btn-outline compact" key={label} onClick={()=>open(page)}><Icon size={15}/>{label}<bdi>{fmt(count)}</bdi><ArrowUpRight size={13}/></button>)}
    </div>
  </div>
}
