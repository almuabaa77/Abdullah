import { useRef, useState } from 'react'
import { BookOpen, CalendarDays, Check, CircleCheck, ListChecks, Plus, Sparkles, Trash2, UserCheck } from 'lucide-react'
import { circleMeets, dayOffset, expandRange, idFor, isRecitationDue, nextCircleDate, pointsFor, resolveAttendance, sameSegments, segmentLabel, suggestNext, surahs, validateSegments, type Attendance, type Daily, type ReminderField, type Result, type Segment, type Student } from './domain'
import { Avatar, Modal, dateLabel, nameFor, statusText, useWorkspace, type WizardMode } from './ui'
import { RecitationBadge, StudentPicker } from './recitation-roster'
import { outcome, prepareRecitation, recitationKinds, suggestAssignment } from './recitation-draft'

function Segments({ value, change, label }: {value:Segment[];change:(next:Segment[])=>void;label:string}) {
  const {en,t} = useWorkspace()
  const [range,setRange] = useState(false)
  const [start,setStart] = useState({surah:78,from:37,to:40})
  const [end,setEnd] = useState({surah:79,from:1,to:4})
  const [descending,setDescending] = useState(false)
  const [error,setError] = useState('')
  const pick = (value:number, set:(s:number)=>void, label:string) => <select aria-label={label} value={value} onChange={e=>set(Number(e.target.value))}>{surahs.map(s=><option key={s.id} value={s.id}>{en?s.en:s.name}</option>)}</select>
  const edit = (i:number, segment:Segment) => change(value.map((s,j)=>i===j?segment:s))
  const count = value.reduce((total,s)=>total+(s.from>0&&s.to>=s.from&&s.to<=surahs[s.surah-1].count?s.to-s.from+1:0),0)
  const addSegment = () => {
    const next = suggestNext(value.filter(s=>s.from>0&&s.to>=s.from&&s.to<=surahs[s.surah-1].count))[0]
    const start = next ? {surah:next.surah,from:next.from,to:next.from} : {surah:78,from:1,to:1}
    change([...value,start])
  }
  return <div className="segment-group">
    <div className="segment-title"><strong><BookOpen size={16}/>{label}</strong><span className="count-pill">{count} {t('آية','verses')}</span></div>
    {!value.length&&!range&&<div className="segment-empty">{t('أضف سورة وحدّد الآيات التي سمّعها الطالب.','Add a surah and select the verses the student recited.')}</div>}
    {value.map((s,i)=><div className="segment-row" key={i}>
      <label>{t('السورة','Surah')}{pick(s.surah, n=>edit(i,{surah:n,from:1,to:1}),t('السورة','Surah'))}</label>
      <label>{t('من آية','From verse')}<input type="number" inputMode="numeric" min="1" max={surahs[s.surah-1].count} value={s.from||''} onChange={e=>edit(i,{...s,from:Number(e.target.value)})}/></label>
      <label>{t('إلى آية','To verse')}<input type="number" inputMode="numeric" min={s.from||1} max={surahs[s.surah-1].count} value={s.to||''} onChange={e=>edit(i,{...s,to:Number(e.target.value)})}/></label>
      <button className="icon-button danger" type="button" aria-label={t('حذف مقطع','Remove segment')} onClick={()=>change(value.filter((_,j)=>j!==i))}><Trash2 size={16}/></button>
    </div>)}
    <div className="chip-row"><button className="btn btn-outline compact" type="button" onClick={addSegment}><Plus size={15}/>{t('إضافة مقطع','Add segment')}</button><button type="button" className="btn btn-subtle compact" onClick={()=>{setRange(!range);setError('')}}>{t('نطاق بين السور','Range across surahs')}</button></div>
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
export function EntryWizard({ student, mode, preset, circleId, focus, close }: {student?:Student; mode:WizardMode; preset?:Partial<Daily>; circleId?:string; focus?:ReminderField; close:()=>void}) {
  const {data,t,en,post,tell} = useWorkspace()
  const [selected,setStudent] = useState(student)
  const focusedRecitation = focus==='memorization'||focus==='review' ? focus : undefined
  const initialStep = (focus ?? mode)==='review'?1:0
  const [step,setStep] = useState(initialStep)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [dirty,setDirty] = useState(false)
  const [editing,setEditing] = useState(mode==='edit')
  const body = useRef<HTMLDivElement>(null)
  const isRecite = mode==='recite'||mode==='review'||mode==='edit'
  const [op,setOp] = useState(idFor)
  const date = preset?.date || data.date
  const init = (s:Student, records=data.daily, values=preset) => prepareRecitation(records,s.id,date,data.circles.find(c=>c.id===s.circleId),mode,values)
  const [entry,setEntry] = useState(()=>student?init(student):undefined)
  const [attendanceEdited,setAttendanceEdited] = useState(preset?.attendance !== undefined)
  const title = focusedRecitation==='memorization' ? t('الحفظ الجديد','New memorization') : focusedRecitation==='review' ? t('المراجعة','Revision')
    : editing ? t('تعديل سجل الطالب','Edit student record') : ({recite:t('تسجيل تسميع','Record recitation'),review:t('تسجيل مراجعة','Log revision'),attendance:t('تسجيل الحضور','Record attendance'),schedule:t('الجدولة القادمة','Upcoming assignment'),points:t('تعديل النقاط','Adjust points'),edit:t('تعديل سجل الطالب','Edit student record')})[mode]
  const select = (s:Student, next=init(s)) => {
    setStudent(s);setEntry(next);setStep(initialStep);setError('');setDirty(false)
    setAttendanceEdited(next.draft.attendance!==next.base.attendance);setEditing(mode==='edit');setOp(idFor())
  }
  const exit = () => {if(!busy&&(!dirty||window.confirm(t('مغادرة التسجيل قبل حفظ التغييرات؟','Leave this entry without saving changes?'))))close()}
  if (!selected || !entry) return <Modal title={title} close={exit} appearance="entry-dialog entry-picker-dialog">
    <div className="modal-body"><div className="entry-picker-title"><span className="stat-icon tint-green"><BookOpen size={21}/></span><div><h3>{t('اختر الطالب','Select a student')}</h3><p>{dateLabel(date,en,true)}</p></div></div>
    <StudentPicker date={date} students={circleId?data.students.filter(item=>item.circleId===circleId):undefined} defaultFilter={mode==='recite'?'due':'all'} select={select}/></div>
  </Modal>
  const {base,draft,suggested,planDate} = entry
  const update = (part:Partial<Daily>) => {setEntry({...entry,draft:{...draft,...part}});setError('');setDirty(true);setOp(idFor())}
  const existing = data.daily.find(d=>d.studentId===selected.id&&d.date===date)
  const circle = data.circles.find(c=>c.id===selected.circleId)
  const changedElsewhere = (existing?.version ?? 0)!==(base.version ?? 0)
  const confirmed = {...draft}
  for (const kind of suggested) {
    confirmed[kind] = base[kind]
    confirmed[outcome[kind]] = base[outcome[kind]]
  }
  const changedRecitation = recitationKinds.filter(kind=>(!focusedRecitation||kind===focusedRecitation)
    &&(!sameSegments(base[kind],confirmed[kind])||base[outcome[kind]]!==confirmed[outcome[kind]]))
  const closed=data.closed.includes(selected.circleId+'/'+date)
  const explicitAttendance=attendanceEdited?draft.attendance:undefined
  const recordedAttendance=resolveAttendance(base,confirmed,explicitAttendance,closed,mode==='attendance').attendance
  const computed = pointsFor({...confirmed,memorizationStatus:confirmed.memorization.length?confirmed.memorizationStatus:'none',reviewStatus:confirmed.review.length?confirmed.reviewStatus:'none',attendance:recordedAttendance},data.rules)
  const nextStudent = mode==='recite'&&!editing&&data.students.find(s=>s.active&&s.id!==selected.id&&s.circleId===selected.circleId&&isRecitationDue(data.daily.find(d=>d.studentId===s.id&&d.date===date)))
  const assignmentChanged = draft.nextDate!==base.nextDate || !sameSegments(draft.nextMemorization,base.nextMemorization) || !sameSegments(draft.nextReview,base.nextReview)
  const validateSchedule = () => {
    const nextMemorization=validateSegments(draft.nextMemorization),nextReview=validateSegments(draft.nextReview)
    if ((nextMemorization.length||nextReview.length)&&(!draft.nextDate||draft.nextDate<=date||!circleMeets(draft.nextDate,circle))) throw new Error(t('اختر تاريخًا قادمًا يوافق أحد أيام الحلقة.','Choose a future date on a circle day.'))
    return {nextMemorization,nextReview,nextDate:draft.nextDate}
  }
  const save = async (continueNext=false) => {
    setBusy(true);setError('')
    try {
      if(focusedRecitation&&(!confirmed[focusedRecitation].length||suggested.includes(focusedRecitation))) {
        throw new Error(t('أضف مقطعًا وأكّد حالة الإنجاز قبل الحفظ.','Add a passage and confirm the outcome before saving.'))
      }
      const values:Record<string,unknown> = {studentId:selected.id,date:draft.date,entry:editing?'edit':'record',baseVersion:base.version ?? 0}
      if (explicitAttendance!==undefined) values.attendance=explicitAttendance
      if (mode==='attendance') values.confirmDefaultAttendance=true
      if (mode==='points'||isRecite) {
        if(draft.bonus!==base.bonus)values.bonus=draft.bonus
        if(draft.note!==base.note)values.note=draft.note
      }
      if ((mode==='schedule'||isRecite) && assignmentChanged) Object.assign(values,validateSchedule())
      if (isRecite) {
        for (const kind of changedRecitation) {
          values[kind] = validateSegments(confirmed[kind])
          values[outcome[kind]] = confirmed[outcome[kind]]
        }
      }
      const saved = await post('daily',values,op)
      tell(t(`حُفظ سجل ${nameFor(selected,en)}`,`${nameFor(selected,en)}’s record was saved`))
      if(continueNext){
        const candidate = saved.students.find(s=>s.active&&s.id!==selected.id&&s.circleId===selected.circleId&&isRecitationDue(saved.daily.find(d=>d.studentId===s.id&&d.date===date)))
        if(!candidate){close();return}
        select(candidate,init(candidate,saved.daily,{date}))
        if(body.current)body.current.scrollTop=0
      } else close()
    } catch(e) {setError((e as Error).message)} finally {setBusy(false)}
  }
  const navigate = (index:number) => {setStep(index);setError('');if(body.current)body.current.scrollTop=0}
  const advance = () => {
    try {
      if (step===0) validateSegments(draft.memorization)
      if (step===1) {
        validateSegments(draft.review)
        if(!confirmed.memorization.length&&!confirmed.review.length)throw new Error(t('أكّد حالة الحفظ أو المراجعة قبل المتابعة.','Confirm memorization or revision before continuing.'))
      }
      if (step===2 && assignmentChanged) validateSchedule()
      navigate(step+1)
    } catch(e) {setError((e as Error).message)}
  }
  const suggestedPlan=suggestAssignment(data.daily,confirmed)
  const acceptAssigned=()=>{
    const next={...draft}
    for(const field of suggested)next[outcome[field]]='complete'
    if(!draft.nextMemorization.length&&!draft.nextReview.length&&!preset?.nextMemorization&&!preset?.nextReview) {
      Object.assign(next,suggestAssignment(data.daily,next))
      if(next.nextDate<=date||!circleMeets(next.nextDate,circle))next.nextDate=nextCircleDate(date,circle)
    }
    setEntry({...entry,draft:next,suggested:[]})
    setDirty(true)
    setOp(idFor())
    navigate(3)
  }
  const pointFields = <div className="field-pair"><label>{t('صافي المكافأة أو الخصم لليوم','Net bonus or deduction for the day')}<input type="number" min={-100} max={100} value={draft.bonus} onChange={e=>update({bonus:Number(e.target.value)})}/></label><label>{t('ملاحظة','Note')}<input value={draft.note} onChange={e=>update({note:e.target.value})} maxLength={400}/></label></div>
  const attendanceField = <label>{t('حالة الحضور','Attendance status')}<select value={explicitAttendance??recordedAttendance} onChange={e=>{setAttendanceEdited(true);update({attendance:e.target.value as Attendance})}}>{attendance.map(s=><option key={s} value={s}>{s==='pending'?t('احتساب تلقائي','Automatic'):statusText(s,t)}</option>)}</select></label>
  const kind = step===0?'memorization':'review'
  const resultKey = outcome[kind]
  const locked = !editing&&base[kind].length>0
  return <Modal title={title} close={exit} wide appearance="entry-dialog">
    <div className="modal-body" ref={body}>
      <div className="wizard-student entry-student"><Avatar student={selected}/><div><strong>{nameFor(selected,en)}</strong><p>{dateLabel(draft.date,en,true)}</p></div><RecitationBadge record={existing}/></div>
      {changedElsewhere&&<div className="error-box" role="status">{t('حُدّث هذا السجل في جلسة أخرى. حمّل آخر نسخة قبل الحفظ.','This record changed in another session. Load the latest version before saving.')} <button className="text-button" type="button" onClick={()=>{if(!dirty||window.confirm(t('استبدال المسودة بالتغييرات المحفوظة؟','Replace the draft with the saved changes?')))select(selected,init(selected,data.daily,{date}))}}>{t('تحميل آخر نسخة','Load latest version')}</button></div>}
      {isRecite&&!focusedRecitation&&<div className="stepper">{stages.map(([Icon,ar,enLabel],index)=><button type="button" key={ar} className={index===step?'current':index<step?'done':''} disabled={!editing&&index>step} aria-current={index===step?'step':undefined} onClick={()=>navigate(index)}><span>{index<step&&!editing?<Check size={16}/>:<Icon size={16}/>}</span><small>{t(ar,enLabel)}</small></button>)}</div>}
      {isRecite&&!focusedRecitation&&<div className="entry-stage-title"><span>{t(`المرحلة ${step+1} من ${stages.length}`,`Step ${step+1} of ${stages.length}`)}</span><h3>{t(stages[step][1],stages[step][2])}</h3></div>}
      {isRecite&&!editing&&!focusedRecitation&&step<2&&suggested.length>0&&<section className="fast-entry" aria-label={t('الجدولة السابقة','Previous assignment')}>
        <div className="fast-entry-heading"><CalendarDays size={17}/><strong>{t('مقاطع جاهزة من الجدولة','Passages from the assignment')}</strong>{planDate&&<small>{dateLabel(planDate,en)}</small>}</div>
        {suggested.map(field=><p key={field}><b>{field==='memorization'?t('الحفظ','Memorization'):t('المراجعة','Revision')}</b> · {segmentLabel(draft[field],en)}</p>)}
        <button className="btn btn-primary compact" type="button" onClick={acceptAssigned}><Check size={17}/>{t('اعتبار المجدول مكتملًا ومراجعة الحفظ','Mark assigned passages complete and review')}</button>
      </section>}
      {isRecite&&step<2&&(locked ? <div className="entry-saved-section">
        <strong><CircleCheck size={18}/>{t('مسجّل في سجل اليوم','Already recorded today')}</strong>
        <p>{segmentLabel(base[kind],en)} · {statusText(base[resultKey],t)}</p>
        <button className="btn btn-outline compact" type="button" onClick={()=>setEditing(true)}>{t('تعديل السجل','Edit record')}</button>
      </div> : <>
        {suggested.includes(kind)&&<div className="hint-line"><CalendarDays size={16}/>{t('عُبّئت المقاطع من جدولة هذا اليوم. حدّد حالة الإنجاز لإدراجها في الحفظ.','Segments were filled from this day’s assignment. Choose an outcome to include them in the save.')}</div>}
        <Segments key={kind} value={draft[kind]} change={segments=>update({[kind]:segments,[resultKey]:segments.length?(suggested.includes(kind)?'none':draft[resultKey]==='none'?'complete':draft[resultKey]):'none'})} label={step===0?t('مقاطع الحفظ الجديد','Memorization segments'):t('مقاطع المراجعة','Revision segments')}/>
        {!!draft[kind].length&&<fieldset className="entry-outcome"><legend>{t('حالة الإنجاز','Completion status')}</legend>{(['complete','partial','none'] as Result[]).map(status=>{
          const chosen = !suggested.includes(kind)&&draft[resultKey]===status
          return <label key={status} className={'check-line '+(chosen?'selected':'')}><input type="radio" name="outcome" checked={chosen} onChange={()=>{setEntry({...entry,suggested:suggested.filter(item=>item!==kind),draft:{...draft,[resultKey]:status}});setDirty(true);setError('');setOp(idFor())}}/>{statusText(status,t)}</label>
        })}</fieldset>}
      </>)}
      {(mode==='schedule'||isRecite&&step===2)&&<>
        <div className="field-pair"><label>{t('موعد الحلقة القادمة','Next circle date')}<input type="date" min={dayOffset(date,1)} value={draft.nextDate} onChange={e=>update({nextDate:e.target.value})}/></label><button className="btn btn-outline align-end" type="button" onClick={()=>{if(!suggestedPlan.nextMemorization.length&&!suggestedPlan.nextReview.length){setError(t('أكّد مقطع حفظ أو مراجعة لاقتراح الجدولة.','Confirm a memorization or revision passage to suggest an assignment.'));return}update(suggestedPlan)}}><Sparkles size={16}/>{t('اقتراح الجدولة','Suggest assignment')}</button></div>
        <Segments value={draft.nextMemorization} change={v=>update({nextMemorization:v})} label={t('الحفظ المطلوب','Assigned memorization')}/>
        <Segments value={draft.nextReview} change={v=>update({nextReview:v})} label={t('المراجعة المطلوبة','Assigned revision')}/>
      </>}
      {mode==='attendance'&&<div className="field-pair"><div className="hint-line"><UserCheck size={18}/>{t('يُحتسب التسميع الفعلي حضورًا. الافتراضي عند التحضير بدون تسميع هو الغياب، ويمكن تغيير الحالة.','Actual recitation counts as attendance. With no recitation, the attendance form defaults to absent and can be changed.')}</div>{attendanceField}</div>}
      {(mode==='points'||isRecite&&step===3)&&<>
        {isRecite&&<div className="entry-review">
          <div><span>{t('الحفظ','Memorization')}</span><strong>{segmentLabel(confirmed.memorization,en)||'—'}</strong></div>
          <div><span>{t('المراجعة','Revision')}</span><strong>{segmentLabel(confirmed.review,en)||'—'}</strong></div>
          <div><span>{t('الحفظ المجدول','Scheduled memorization')}</span><strong>{segmentLabel(draft.nextMemorization,en)||'—'}</strong></div>
          <div><span>{t('المراجعة المجدولة','Scheduled revision')}</span><strong>{segmentLabel(draft.nextReview,en)||'—'}</strong></div>
          <div><span>{t('موعد الجدولة','Assignment date')}</span><strong>{draft.nextMemorization.length||draft.nextReview.length?dateLabel(draft.nextDate,en,true):'—'}</strong></div>
          <div><span>{t('الحضور','Attendance')}</span><strong>{statusText(recordedAttendance,t)}</strong></div>
        </div>}
        {isRecite&&attendanceField}
        {pointFields}<div className="points-preview"><Sparkles size={18}/>{t('مجموع نقاط اليوم','Today’s total points')}<strong>{computed}</strong></div>
      </>}
      {error&&<div className="error-box" role="alert">{error}</div>}
    </div>
    <div className="modal-foot entry-foot">
      <button className="btn btn-outline entry-back" type="button" disabled={busy} onClick={()=>{if(isRecite&&!focusedRecitation&&step>0)navigate(step-1);else exit()}}>{isRecite&&!focusedRecitation&&step>0?t('رجوع','Back'):t('إلغاء','Cancel')}</button>
      {isRecite&&step===3&&nextStudent&&<button className="btn btn-outline" type="button" disabled={busy||changedElsewhere} onClick={()=>void save(true)}>{t('حفظ وتسميع التالي','Save and recite next')}</button>}
      <button className="btn btn-primary" type="button" disabled={busy||changedElsewhere} onClick={isRecite&&!focusedRecitation&&step<3&&!editing?advance:()=>void save()}>
        {busy?t('جارٍ الحفظ…','Saving…'):editing?t('حفظ التعديل','Save changes'):isRecite&&!focusedRecitation&&step<3?t('متابعة','Continue'):t('اعتماد وحفظ','Confirm and save')}
        {(!isRecite||focusedRecitation||editing||step===3)&&<Check size={17}/>}
      </button>
    </div>
  </Modal>
}
