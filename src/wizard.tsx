import { useState } from 'react'
import { BookOpen, CalendarDays, Check, CircleCheck, ListChecks, Plus, Search, Sparkles, Trash2, UserCheck } from 'lucide-react'
import { emptyDaily, expandRange, idFor, pointsFor, segmentLabel, suggestNext, surahs, validateSegments, verseCount, type Attendance, type Daily, type Result, type Segment, type Student } from './domain'
import { Avatar, Empty, Modal, dateLabel, matches, nameFor, statusText, useWorkspace, type WizardMode } from './ui'

export function StudentPicker({ select, students, initial = '' }: {select:(student:Student)=>void; students?:Student[]; initial?:string}) {
  const {data,t,en} = useWorkspace()
  const [query,setQuery] = useState(initial)
  const pool = (students || data.students).filter(s=>s.active)
  const filtered = pool.filter(s=>matches(s,query))
  return <div className="student-picker">
    <label className="search"><Search size={17}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('ابحث بالاسم...','Search by name...')} aria-label={t('ابحث بالاسم','Search by name')}/></label>
    {filtered.slice(0,6).map(s=><button className="picker-row" type="button" key={s.id} onClick={()=>select(s)}><Avatar student={s}/><span><strong>{nameFor(s,en)}</strong><small>{data.sample&&en?'Imam Asim Circle':data.circles.find(c=>c.id===s.circleId)?.name}</small></span><Plus size={16}/></button>)}
    {filtered.length>6&&<p className="muted small-text">{t('يمكنك تضييق البحث بكتابة اسم الطالب.','Type a student’s name to narrow the results.')}</p>}
    {!filtered.length&&<Empty title={t('لا يوجد طلاب مطابقون','No matching students')}/>}
  </div>
}

function Segments({ value, change, label }: {value:Segment[];change:(next:Segment[])=>void;label:string}) {
  const {en,t} = useWorkspace()
  const [range,setRange] = useState(false)
  const [start,setStart] = useState({surah:78,from:37,to:40})
  const [end,setEnd] = useState({surah:79,from:1,to:4})
  const [descending,setDescending] = useState(false)
  const [error,setError] = useState('')
  const pick = (value:number, set:(s:number)=>void, label:string) => <select aria-label={label} value={value} onChange={e=>set(Number(e.target.value))}>{surahs.map(s=><option key={s.id} value={s.id}>{en?s.en:s.name}</option>)}</select>
  const edit = (i:number, segment:Segment) => change(value.map((s,j)=>i===j?segment:s))
  return <div className="segment-group">
    <div className="segment-title"><strong>{label}</strong><span className="count-pill">{verseCount(value)} {t('آية','verses')}</span></div>
    {value.map((s,i)=><div className="segment-row" key={i}>
      <label>{t('السورة','Surah')}{pick(s.surah, n=>edit(i,{surah:n,from:1,to:1}),t('السورة','Surah'))}</label>
      <label>{t('من آية','From verse')}<input type="number" min="1" max={surahs[s.surah-1].count} value={s.from||''} onChange={e=>edit(i,{...s,from:Number(e.target.value)})}/></label>
      <label>{t('إلى آية','To verse')}<input type="number" min={s.from||1} max={surahs[s.surah-1].count} value={s.to||''} onChange={e=>edit(i,{...s,to:Number(e.target.value)})}/></label>
      <button className="icon-button danger" type="button" aria-label={t('حذف مقطع','Remove segment')} onClick={()=>change(value.filter((_,j)=>j!==i))}><Trash2 size={16}/></button>
    </div>)}
    <div className="chip-row"><button className="btn btn-outline compact" type="button" onClick={()=>change([...value,{surah:78,from:1,to:1}])}><Plus size={15}/>{t('إضافة مقطع','Add segment')}</button><button type="button" className="btn btn-subtle compact" onClick={()=>{setRange(!range);setError('')}}>{t('نطاق بين السور','Range across surahs')}</button></div>
    {range&&<div className="range-form">
      <div className="field-pair"><label>{t('سورة البداية','Start surah')}{pick(start.surah,n=>setStart({...start,surah:n,from:1}),t('سورة البداية','Start surah'))}</label><label>{t('آية البداية','Start verse')}<input type="number" min={1} value={start.from} onChange={e=>setStart({...start,from:Number(e.target.value)})}/></label></div>
      <div className="field-pair"><label>{t('سورة النهاية','End surah')}{pick(end.surah,n=>setEnd({...end,surah:n,to:1}),t('سورة النهاية','End surah'))}</label><label>{t('آية النهاية','End verse')}<input type="number" min={1} value={end.to} onChange={e=>setEnd({...end,to:Number(e.target.value)})}/></label></div>
      <label className="check-line"><input type="checkbox" checked={descending} onChange={e=>setDescending(e.target.checked)}/>{t('ترتيب السور تنازليًا','Descending surah order')}</label>
      {error&&<p className="error-text" role="alert">{error}</p>}
      <button className="btn btn-primary compact" type="button" onClick={()=>{ try { change(validateSegments([...value,...expandRange(start,end,descending)]));setRange(false) } catch(e) {setError((e as Error).message)} }}><Plus size={15}/>{t('إضافة النطاق','Add range')}</button>
    </div>}
  </div>
}

const stages = [[BookOpen,'الحفظ الجديد','Memorization'],[ListChecks,'المراجعة','Revision'],[CalendarDays,'الجدولة القادمة','Assignment'],[CircleCheck,'النقاط والاعتماد','Points & submit']] as const
const attendance = ['present','pending','absent','leave','excused'] as const
export function EntryWizard({ student, mode, preset, close }: {student?:Student; mode:WizardMode; preset?:Partial<Daily>; close:()=>void}) {
  const {data,t,en,post,tell} = useWorkspace()
  const [selected,setStudent] = useState(student)
  const [step,setStep] = useState(0)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [op,setOp] = useState(idFor)
  const date = preset?.date || data.date
  const init = (s:Student) => ({...emptyDaily(s.id,date,data.circles.find(c=>c.id===s.circleId)),...data.daily.find(d=>d.studentId===s.id && d.date===date),...preset})
  const [draft,setDraft] = useState<Daily | undefined>(()=>student?init(student):undefined)
  const [attendanceEdited,setAttendanceEdited] = useState(preset?.attendance !== undefined)
  const title = ({recite:t('تسجيل تسميع','Record recitation'),attendance:t('تسجيل الحضور','Record attendance'),schedule:t('الجدولة القادمة','Upcoming assignment'),points:t('تعديل النقاط','Adjust points')})[mode]
  if (!selected || !draft) return <Modal title={t('اختر الطالب','Select a student')} close={close}><div className="modal-body"><StudentPicker select={s=>{setStudent(s);setDraft(init(s))}}/></div></Modal>
  const update = (part:Partial<Daily>) => {setDraft({...draft,...part});setError('');setOp(idFor())}
  const status = draft.memorization.length || draft.review.length ? 'present' : draft.attendance
  const computed = pointsFor({...draft,memorizationStatus:draft.memorization.length?draft.memorizationStatus:'none',reviewStatus:draft.review.length?draft.reviewStatus:'none',attendance:attendanceEdited||mode==='attendance'?draft.attendance:status},data.rules)
  const save = async () => {
    setBusy(true);setError('')
    try {
      const values:Record<string,unknown> = {studentId:selected.id,date:draft.date}
      if (mode==='attendance') values.attendance = draft.attendance
      if (mode==='points') Object.assign(values,{bonus:draft.bonus,note:draft.note})
      if (mode==='schedule' || mode==='recite') Object.assign(values,{nextMemorization:validateSegments(draft.nextMemorization),nextReview:validateSegments(draft.nextReview),nextDate:draft.nextDate})
      if (mode==='recite') {
        Object.assign(values,{memorization:validateSegments(draft.memorization),review:validateSegments(draft.review),memorizationStatus:draft.memorizationStatus,reviewStatus:draft.reviewStatus,bonus:draft.bonus,note:draft.note})
        if (attendanceEdited) values.attendance = draft.attendance
      }
      await post('daily',values,op)
      tell(t('تم حفظ بيانات الطالب','Student record saved'));close()
    } catch(e) {setError((e as Error).message)} finally {setBusy(false)}
  }
  const advance = () => {
    try {
      if (step===0) validateSegments(draft.memorization)
      if (step===1) validateSegments(draft.review)
      if (step===2) {validateSegments(draft.nextMemorization);validateSegments(draft.nextReview)}
      setStep(step+1);setError('')
    } catch(e) {setError((e as Error).message)}
  }
  const previous = data.daily.filter(d=>d.studentId===selected.id && d.date<date && (d.nextMemorization.length || d.nextReview.length)).sort((a,b)=>b.date.localeCompare(a.date))[0]
  const pointFields = <div className="field-pair"><label>{t('نقاط إضافية أو خصم','Bonus or deduction')}<input type="number" min={-100} max={100} value={draft.bonus} onChange={e=>update({bonus:Number(e.target.value)})}/></label><label>{t('ملاحظة','Note')}<input value={draft.note} onChange={e=>update({note:e.target.value})} maxLength={400}/></label></div>
  const attendanceField = <label>{t('حالة الحضور','Attendance status')}<select value={draft.attendance} onChange={e=>{setAttendanceEdited(true);update({attendance:e.target.value as Attendance})}}>{attendance.map(s=><option key={s} value={s}>{statusText(s,t)}</option>)}</select></label>
  const kind = step===0?'memorization':'review'
  const resultKey = step===0?'memorizationStatus':'reviewStatus'
  return <Modal title={title} close={()=>{if(!busy)close()}} wide>
    <div className="modal-body">
      <div className="wizard-student"><Avatar student={selected}/><div><strong>{nameFor(selected,en)}</strong><p>{dateLabel(draft.date,en,true)}</p></div></div>
      {mode==='recite'&&<div className="stepper">{stages.map(([Icon,ar,enLabel],index)=><button type="button" key={ar} className={index===step?'current':index<step?'done':''} disabled={index>step} onClick={()=>setStep(index)}><span>{index<step?<Check size={16}/>:<Icon size={16}/>}</span><small>{t(ar,enLabel)}</small></button>)}</div>}
      {mode==='recite'&&step<2&&<>
        {previous&&<div className="hint-line"><CalendarDays size={16}/><span>{t('آخر جدولة','Previous assignment')} · {segmentLabel(step===0?previous.nextMemorization:previous.nextReview,en)||'—'}</span><button className="text-button" onClick={()=>update({[kind]:step===0?previous.nextMemorization:previous.nextReview,[resultKey]:'complete'})}>{t('استخدام','Use')}</button></div>}
        <Segments key={kind} value={draft[kind]} change={v=>update({[kind]:v,[resultKey]:v.length?(draft[resultKey]==='none'?'complete':draft[resultKey]):'none'})} label={step===0?t('مقاطع الحفظ الجديد','Memorization segments'):t('مقاطع المراجعة','Revision segments')}/>
        <label>{t('حالة الإنجاز','Completion status')}<select value={draft[resultKey]} onChange={e=>update({[resultKey]:e.target.value as Result})}>{(['none','partial','complete'] as const).map(s=><option key={s} value={s}>{statusText(s,t)}</option>)}</select></label>
      </>}
      {(mode==='schedule'||mode==='recite'&&step===2)&&<>
        <div className="field-pair"><label>{t('موعد الحلقة القادمة','Next circle date')}<input type="date" value={draft.nextDate} onChange={e=>update({nextDate:e.target.value})}/></label><button className="btn btn-outline align-end" type="button" onClick={()=>{const last=draft.memorization.length?draft.memorization:previous?.memorization||[];const review=draft.review.length?draft.review:previous?.review||[];const next=suggestNext(last);if(!next.length&&!review.length){setError(t('أضف مقطع حفظ أو مراجعة لاقتراح الجدولة.','Add a recitation or revision segment first.'));return}update({nextMemorization:next,nextReview:review})}}><Sparkles size={16}/>{t('اقتراح الجدولة','Suggest assignment')}</button></div>
        <Segments value={draft.nextMemorization} change={v=>update({nextMemorization:v})} label={t('الحفظ المطلوب','Assigned memorization')}/>
        <Segments value={draft.nextReview} change={v=>update({nextReview:v})} label={t('المراجعة المطلوبة','Assigned revision')}/>
      </>}
      {mode==='attendance'&&<div className="field-pair"><div className="hint-line"><UserCheck size={18}/>{t('تُحدث نقاط الحضور تلقائيًا.','Attendance points update automatically.')}</div>{attendanceField}</div>}
      {(mode==='points'||mode==='recite'&&step===3)&&<>
        {mode==='recite'&&<div className="entry-review">
          <div><span>{t('الحفظ','Memorization')}</span><strong>{segmentLabel(draft.memorization,en)||'—'}</strong></div>
          <div><span>{t('المراجعة','Revision')}</span><strong>{segmentLabel(draft.review,en)||'—'}</strong></div>
          <div><span>{t('الجدولة القادمة','Next assignment')}</span><strong>{segmentLabel([...draft.nextMemorization,...draft.nextReview],en)||'—'}</strong></div>
          <div><span>{t('الحضور','Attendance')}</span><strong>{statusText(attendanceEdited?draft.attendance:status,t)}</strong></div>
        </div>}
        {pointFields}<div className="points-preview"><Sparkles size={18}/>{t('مجموع نقاط اليوم','Today’s total points')}<strong>{computed}</strong></div>
      </>}
      {error&&<div className="error-box" role="alert">{error}</div>}
    </div>
    <div className="modal-foot"><button className="btn btn-outline" type="button" disabled={busy} onClick={()=>{if(mode==='recite'&&step>0){setStep(step-1);setError('')}else close()}}>{mode==='recite'&&step>0?t('رجوع','Back'):t('إلغاء','Cancel')}</button>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={mode==='recite'&&step<3?advance:save}>{busy?t('جارٍ الحفظ…','Saving…'):mode==='recite'&&step<3?t('متابعة','Continue'):t('اعتماد وحفظ','Confirm and save')}{(mode!=='recite'||step===3)&&<Check size={17}/>}</button>
    </div>
  </Modal>
}
