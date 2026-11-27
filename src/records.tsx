import { useState } from 'react'
import { CalendarDays, Download, FileText, LayoutList, Printer, Table2 } from 'lucide-react'
import { circleMeets, recordedAssignment, dayOffset, segmentLabel, statusFor, type Student, type Daily } from './domain'
import { Badge, Brand, dateLabel, Empty, matches, nameFor, statusText, useWorkspace } from './ui'

export function Records({embedded=false}:{embedded?:boolean}={}) {
  const {data,en,t,post,open,tell} = useWorkspace()
  const [date,setDate] = useState(data.date)
  const [period,setPeriod] = useState('day')
  const [circle,setCircle] = useState('')
  const [layout,setLayout] = useState('table')
  const [student,setStudent] = useState('')
  const [query,setQuery] = useState('')
  const [closing,setClosing] = useState(false)
  const start = period==='week'?dayOffset(date,-6):period==='month'?date.slice(0,7)+'-01':date
  const students = data.students.filter(s=>(!student||s.id===student)&&(!circle||s.circleId===circle)&&matches(s,query))
  const rows = students.flatMap<{s:Student;d?:Daily;date:string}>(s=>{
    const records = data.daily.filter(x=>x.studentId===s.id && x.date>=start && x.date<=date).sort((a,b)=>b.date.localeCompare(a.date))
    return records.length?records.map(d=>({s,d,date:d.date})):period==='day'?[{s,d:undefined,date}]:[]
  })
  const admin = embedded&&data.user?.role==='admin'
  const selectedCircle = data.circles.find(c=>c.id===circle) || (data.circles.length===1?data.circles[0]:undefined)
  const closed = data.closed.includes(selectedCircle?.id+'/'+date)
  const columns = [t('الطالب','Student'),t('التاريخ','Date'),t('الحفظ الجديد','Memorization'),t('المراجعة','Revision'),t('الحفظ المجدول','Assigned memorization'),t('المراجعة المجدولة','Assigned revision'),t('موعد الجدولة','Assignment date'),t('الحضور','Attendance'),t('النقاط','Points'),t('الإنجاز','Completion')]
  const rowValues = rows.map(({s,d,date})=>{
    const plan=recordedAssignment(data.daily,s.id,date,d)
    const passage=(kind:'nextMemorization'|'nextReview')=>{
      const text=segmentLabel(plan[kind].segments,en)
      return text&&plan[kind].incoming?text+' · '+t('مطلوب اليوم','Due today'):text
    }
    return [nameFor(s,en),date,segmentLabel(d?.memorization??[],en),segmentLabel(d?.review??[],en),
      passage('nextMemorization'),passage('nextReview'),plan.nextDate,
      statusText(d?.attendance||'pending',t),d?.points??0,statusText(statusFor(d),t)]
  })
  const edit = (s:Student,d:Daily|undefined,date:string) => open(s,d?'edit':'recite',{date})
  const closeDay = async () => {
    if(!admin||!selectedCircle||!window.confirm(t('سيُسجّل الغياب للطلاب الذين لم يُسجّل حضورهم. هل تريد إغلاق اليوم؟','Unmarked students will be marked absent. Close the day?')))return
    setClosing(true)
    try {await post('close',{circleId:selectedCircle.id,date});tell(t('تم إغلاق سجل اليوم','Daily register closed'))} catch(e) {tell((e as Error).message,true)} finally{setClosing(false)}
  }
  if(!admin&&data.user?.role!=='student'&&data.user?.role!=='parent')return null
  return <section className={embedded?'records-page admin-embedded':'panel section-panel records-page'}>
    <div className="print-brand"><Brand/><p>{t('سجل حلقات تحفيظ القرآن الكريم','Quran memorization records')} · {start} — {date}</p></div>
    <div className="section-title">{!embedded&&<div><h1>{t('إنجازاتي','Achievements')}</h1><p>{t('تصفح الحفظ والمراجعة والجدولة والحضور','Browse recitation, revision, assignments and attendance')}</p></div>}
      {admin&&<div className="chip-row"><button className="btn btn-outline compact" onClick={()=>window.print()} disabled={!rows.length}><Printer size={16}/>PDF</button><button className="btn btn-outline compact" disabled={!rows.length} onClick={async()=>{const {exportWorkbook}=await import('./export');exportWorkbook([[t('حلقات جامع الخير بآل سرحان','Al-Khair Quran Circles'),start,date],columns,...rowValues],`halaqat-${date}`,!en)}}><Download size={16}/>Excel</button></div>}
    </div>
    <div className="records-filters">
      <label>{t('الفترة','Period')}<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="day">{t('يومي','Daily')}</option><option value="week">{t('أسبوعي','Weekly')}</option><option value="month">{t('شهري','Monthly')}</option></select></label>
      <label>{t('التاريخ','Date')}<input type="date" value={date} max={data.date} onChange={e=>{if(e.target.value)setDate(e.target.value)}}/></label>
      <label>{t('الحلقة','Circle')}<select value={circle} onChange={e=>setCircle(e.target.value)}><option value="">{t('جميع الحلقات','All circles')}</option>{data.circles.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{t('الطالب','Student')}<select value={student} onChange={e=>setStudent(e.target.value)}><option value="">{t('جميع الطلاب','All students')}</option>{data.students.map(s=><option key={s.id} value={s.id}>{nameFor(s,en)}</option>)}</select></label>
      <label>{t('البحث','Search')}<input placeholder={t('اسم الطالب','Student name')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    </div>
    <div className="split-line record-tools"><div className="seg-toggle"><button className={layout==='table'?'selected':''} onClick={()=>setLayout('table')}><Table2 size={16}/>{t('جدولي','Table')}</button><button className={layout==='stack'?'selected':''} onClick={()=>setLayout('stack')}><LayoutList size={16}/>{t('بطاقات','Cards')}</button></div>
      {admin&&selectedCircle&&period==='day'&&circleMeets(date,selectedCircle)&&<button className="btn btn-outline compact" disabled={closing||closed} onClick={closeDay}><CalendarDays size={16}/>{closed?t('السجل مغلق','Register closed'):t('إغلاق سجل اليوم','Close today’s register')}</button>}
    </div>
    {!rows.length?<Empty title={t('لا توجد سجلات','No records found')}/>:layout==='table'?<div className="table-wrap"><table className="report-table"><thead><tr>{columns.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(({s,d,date},i)=><tr key={s.id+date}>
      <th>{admin&&(s.active||d)?<button className="text-button" onClick={()=>edit(s,d,date)}>{nameFor(s,en)}</button>:nameFor(s,en)}</th>
      <td>{dateLabel(date,en)}</td>{rowValues[i].slice(2,7).map((value,index)=><td key={index}>{value||'—'}</td>)}<td><Badge status={d?.attendance||'pending'}/></td><td>{d?.points??0}</td><td><Badge status={statusFor(d)}/></td>
    </tr>)}</tbody></table></div>:<div className="summary-grid">{rows.map(({s,d,date},i)=><article className="record-tile" key={s.id+date}><strong>{nameFor(s,en)}</strong><span>{dateLabel(date,en)}</span><Badge status={statusFor(d)}/><dl>{rowValues[i].slice(2,9).map((v,j)=><div key={j}><dt>{columns[j+2]}</dt><dd>{v||'—'}</dd></div>)}</dl>{admin&&(s.active||d)&&<button className="text-button" onClick={()=>edit(s,d,date)}><FileText size={15}/>{d?t('تعديل السجل','Edit record'):t('إضافة سجل','Add record')}</button>}</article>)}</div>}
  </section>
}
