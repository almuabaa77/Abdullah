import { useState } from 'react'
import { Check, CircleCheck, CircleMinus, Clock3, ListFilter, Search, UserRoundX } from 'lucide-react'
import { recitationStatus, isRecitationDue, type Daily, type RecitationStatus, type Student } from './domain'
import { Avatar, Empty, matches, nameFor, useWorkspace, type Tr } from './ui'

export const recitationLabel = (status:RecitationStatus,t:Tr) => ({
  complete:t('أتمّ التسميع','Recited'),
  awaiting:t('لم يسمّع بعد','Awaiting recitation'),
  partial:t('تسميع جزئي','Partial recitation'),
  absent:t('غائب','Absent'),
  leave:t('مستأذن','On leave'),
})[status]

export function RecitationBadge({record}:{record?:Daily}) {
  const {t} = useWorkspace()
  const status = recitationStatus(record)
  const Icon = {complete:CircleCheck,awaiting:Clock3,partial:CircleMinus,absent:UserRoundX,leave:CircleMinus}[status]
  return <span className={'recitation-badge recitation-'+status}><Icon size={14}/>{recitationLabel(status,t)}</span>
}

type Filter = 'due' | 'done' | 'all'
export function StudentPicker({select,students,date,defaultFilter='due',compact=false,autoFocus=false}:{
  select:(student:Student)=>void; students?:Student[]; date?:string; defaultFilter?:Filter; compact?:boolean; autoFocus?:boolean
}) {
  const {data,t,en} = useWorkspace()
  const [query,setQuery] = useState('')
  const [filter,setFilter] = useState<Filter>(defaultFilter)
  const [limit,setLimit] = useState(6)
  const pool = (students || data.students).filter(s=>s.active)
  const today = new Map(data.daily.filter(d=>d.date===(date||data.date)).map(d=>[d.studentId,d]))
  const due = pool.filter(s=>isRecitationDue(today.get(s.id))).length
  const done = pool.filter(s=>recitationStatus(today.get(s.id))==='complete').length
  const filters = [
    ['due',t('بانتظار التسميع','To recite'),due], ['done',t('أتمّوا التسميع','Recited'),done], ['all',t('الجميع','All'),pool.length],
  ] as const
  const results = pool.filter(s=>matches(s,query) && (filter==='all'||filter==='due'&&isRecitationDue(today.get(s.id))||filter==='done'&&recitationStatus(today.get(s.id))==='complete'))
  return <div className={'student-picker recitation-picker'+(compact?' compact-picker':'')}>
    <label className="search"><Search size={18}/><input autoFocus={autoFocus} value={query} onChange={e=>{setQuery(e.target.value);setLimit(6);if(e.target.value.trim())setFilter('all')}} placeholder={t('ابحث عن طالب بالاسم','Search by student name')} aria-label={t('ابحث عن طالب بالاسم','Search by student name')}/></label>
    <div className="picker-filters" aria-label={t('تصفية حالة التسميع','Filter by recitation status')}>{filters.map(([key,label,count])=><button key={key} type="button" aria-pressed={key===filter} className={key===filter?'selected':''} onClick={()=>{setFilter(key);setLimit(6)}}>{label}<span>{count}</span></button>)}</div>
    <div className="picker-results">
      {results.slice(0,limit).map(s=>{
        const record=today.get(s.id)
        const completed=recitationStatus(record)==='complete'
        return <button className={'picker-row recitation-row recitation-row-'+recitationStatus(record)} type="button" key={s.id} onClick={()=>select(s)}>
          <Avatar student={s}/><span className="picker-student"><strong>{nameFor(s,en)}</strong>{!compact&&<small>{data.sample&&en?'Imam Asim Circle':data.circles.find(c=>c.id===s.circleId)?.name}</small>}</span>
          <RecitationBadge record={record}/>{completed&&<Check size={17} className="picker-check"/>}
        </button>
      })}
      {!results.length&&<Empty title={query?t('لا توجد أسماء مطابقة','No matching students'):filter==='due'?t('لا يوجد طلاب بانتظار التسميع','No students waiting to recite'):t('لا توجد نتائج','No results')}/>}
    </div>
    {results.length>limit&&<button type="button" className="btn btn-subtle compact" onClick={()=>setLimit(limit+6)}><ListFilter size={15}/>{t('عرض المزيد','Show more')} <span>({results.length-limit})</span></button>}
  </div>
}
