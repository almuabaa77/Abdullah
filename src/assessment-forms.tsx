import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Check, CalendarDays, Plus, Save, Send, Trash2 } from 'lucide-react'
import { assessmentChunks, assessmentQuestions, assessmentSections, defaultAssessmentCriteria, defaultAssessmentPolicy, errorKinds, type AssessmentAppointment, type AssessmentCase, type AssessmentDashboard, type AssessmentError, type AssessmentPolicy, type AssessmentView, type ReviewTask } from './assessment-model'
import { dayOffset, segmentLabel, surahs, type Segment } from './domain'
import { asciiDigits } from './phone-number'
import { dateLabel, Modal, useWorkspace } from './ui'

export type RunAssessment=(action:string,payload:Record<string,unknown>)=>Promise<boolean>
export const caseTitle=(item:Pick<AssessmentCase,'kind'|'unit'|'parts'>,en:boolean)=>item.kind==='practice'
  ? en?'Practice assessment · '+item.parts.join(', '):'اختبار تجريبي · '+item.parts.join('، ')
  : en?'Stage '+item.unit:'الاختبار المرحلي · المرحلة '+item.unit
export const errorLabels={
  memory:['خطأ في الحفظ','Memorization error'],hesitation:['تردد أو توقف','Hesitation'],prompt:['تلقين الطالب','Prompting'],
  tajwid:['خطأ في التجويد','Tajwid error'],pause:['خطأ في الوقف والابتداء','Stopping and starting error'],skip:['تجاوز آية أو كلمة','Skipped verse or word'],similar:['خلط بين المواضع المتشابهة','Mixed similar passages'],
} as const
export const compactRange=(parts:number[],en:boolean)=>{
  const ranges=parts.map(part=>assessmentSections([part]))
  return ranges.map((range,index)=>range.length<=2?segmentLabel(range,en):
    (en?'Juz ':'الجزء ')+parts[index]+' · '+segmentLabel([range[0]],en)+' ← '+segmentLabel([range.at(-1)!],en)
  ).join(' / ')
}

export function AssessmentExtensionForm({item,run,busy,close}:{item:AssessmentView;run:RunAssessment;busy:boolean;close:()=>void}) {
  const {t,en}=useWorkspace()
  const [days,setDays]=useState(1)
  return <Modal title={t('تمديد مهلة الاستعداد','Preparation extension')} close={close}>
    <form onSubmit={async event=>{
      event.preventDefault()
      const reason=new FormData(event.currentTarget).get('reason')
      if(await run('assessment-extension',{id:item.id,days,reason}))close()
    }}>
      <div className="modal-body"><strong>{caseTitle(item,en)}</strong><p>{t('نهاية المهلة الحالية','Current deadline')} · {dateLabel(item.deadline,en,true)}</p>
        <label>{t('أيام العمل الإضافية','Additional working days')}<select value={days} onChange={event=>setDays(Number(event.target.value))}>
          {item.extendThrough.map((date,i)=><option key={date} value={i+1}>{i+1}</option>)}</select></label>
        <p className="hint-line">{t('نهاية المهلة المتوقعة بعد الموافقة','Expected deadline if approved')} · {dateLabel(item.extendThrough[days-1],en,true)}</p>
        <label>{t('سبب الطلب','Reason for request')}<textarea name="reason" required maxLength={400}/></label>
      </div>
      <div className="modal-foot"><button type="submit" className="btn btn-primary" disabled={busy}><Send size={15}/>{t('إرسال طلب التمديد','Request extension')}</button></div>
    </form>
  </Modal>
}

export function AssessmentReview({item,run,busy,close}:{item:AssessmentView;run:RunAssessment;busy:boolean;close:()=>void}) {
  const {data,t,en}=useWorkspace()
  const [editing,setEditing]=useState(false)
  const [tasks,setTasks]=useState(item.review)
  const staff=data.user?.role==='admin'||data.user?.role==='teacher'
  const change=(index:number,values:Partial<ReviewTask>)=>setTasks(all=>all.map((task,i)=>i===index?{...task,...values}:task))
  return <Modal title={t('خطة المراجعة','Review plan')} wide close={close} appearance="assessment-modal">
    <div className="modal-body"><strong>{caseTitle(item,en)}</strong>
      <p className="hint-line"><BookOpen size={16}/>{item.review.filter(task=>task.done).length} / {item.review.length} · {t('مهام مكتملة','Completed tasks')}</p>
      <ol className="assessment-task-list">{(editing?tasks:item.review).map((task,index)=><li key={index}>
        {editing?<label>{t('يوم المراجعة','Review day')}<input type="date" value={task.date} max={item.deadline} onChange={event=>change(index,{date:event.target.value})}/></label>
          :<strong>{dateLabel(task.date,en,true)}</strong>}
        <p>{segmentLabel(task.segments,en)}</p>
        {task.focus.length>0&&<p className="assessment-focus">{t('أولوية المراجعة','Review priority')} · {segmentLabel(task.focus,en)}</p>}
        {editing?<div className="assessment-fields">
          <label>{t('تحديد أولوية المراجعة','Set review priority')}<select value="" onChange={event=>change(index,{focus:event.target.value==='clear'?[]:[task.segments[Number(event.target.value)]]})}>
            <option value="" disabled>{t('اختر موضعًا من المهمة','Choose a passage from this task')}</option><option value="clear">{t('مسح الأولوية','Clear priority')}</option>
            {task.segments.map((segment,i)=><option key={i} value={i}>{segmentLabel([segment],en)}</option>)}
          </select></label>
          <label>{t('توجيه المحفّظ','Teacher guidance')}<textarea rows={2} value={task.note??''} maxLength={300} onChange={event=>change(index,{note:event.target.value})}/></label>
        </div>:task.note&&<p>{task.note}</p>}
        {!editing&&data.user?.role==='student'&&item.status!=='passed'&&item.status!=='cancelled'&&item.status!=='pending-approval'&&<label className="check-line"><input type="checkbox" checked={Boolean(task.done)} disabled={busy} onChange={event=>void run('assessment-review-task',{id:item.id,date:task.date,done:event.target.checked})}/>{t('أكملت المهمة','I completed the task')}</label>}
      </li>)}</ol>
    </div>
    <div className="modal-foot">
      {staff&&item.review.length>0&&!['passed','cancelled','pending-approval'].includes(item.status)&&
        <button className="btn btn-primary" type="button" disabled={busy} onClick={async()=>{
          if(!editing){setTasks(item.review);setEditing(true)}
          else if(await run('assessment-review-edit',{id:item.id,tasks:tasks.map(({date,note,focus})=>({date,note,focus}))}))setEditing(false)
        }}><Save size={15}/>{editing?t('حفظ الخطة','Save plan'):t('تعديل الخطة','Edit plan')}</button>}
    </div>
  </Modal>
}

export function AssessmentBooking({items,item,dashboard,run,busy,close}:{items:AssessmentView[];item?:AssessmentView;dashboard:AssessmentDashboard;run:RunAssessment;busy:boolean;close:()=>void}) {
  const {data,en,t}=useWorkspace()
  const initial=item?.proposed??item?.appointment??item?.suggestions?.[0]
  const admin=data.user?.role==='admin'
  const {examiners}=dashboard
  const [date,setDate]=useState(initial?.date??data.date)
  const [time,setTime]=useState(initial?.time??'16:00')
  const [place,setPlace]=useState(initial?.place??'')
  const [mode,setMode]=useState<AssessmentAppointment['mode']>(initial?.mode??'onsite')
  const [examinerId,setExaminer]=useState(initial?.examinerId??(admin?examiners[0]?.id:data.user?.id)??'')
  const [minutes,setMinutes]=useState(initial?.minutes??20)
  const [selection,setSelection]=useState<string[]>([])
  const [error,setError]=useState('')
  const batch=!item
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const slot={date,time,examinerId,minutes,mode,place}
    if(batch){
      const base=Number(time.slice(0,2))*60+Number(time.slice(3))
      if(base+minutes*selection.length>=1440){setError(t('الفترة تتجاوز نهاية اليوم.','The period extends beyond the end of the day.'));return}
      const slots=selection.map((id,i)=>{
        const start=base+i*minutes
        return {...slot,id,time:[Math.floor(start/60),start%60].map(n=>String(n).padStart(2,'0')).join(':')}
      })
      if(await run('assessment-batch',{slots}))close()
    }else if(await run(item.canSchedule&&(mode==='onsite'||admin)?'assessment-book':'assessment-propose',{id:item.id,...slot}))close()
  }
  return <Modal title={batch?t('جدولة مجموعة اختبارات','Schedule assessment group'):t('موعد الاختبار','Assessment appointment')} close={close} wide appearance="assessment-modal">
    <form onSubmit={submit}><div className="modal-body">
      {item&&<strong>{item.studentName} · {caseTitle(item,en)}</strong>}
      {batch&&<fieldset className="assessment-batch-options"><legend>{t('اختر الاختبارات حسب ترتيب المواعيد','Select assessments in appointment order')}</legend>
        {items.map(exam=><label className="check-line" key={exam.id}><input type="checkbox" checked={selection.includes(exam.id)}
          onChange={event=>setSelection(previous=>event.target.checked?[...previous,exam.id]:previous.filter(id=>id!==exam.id))}/>{selection.includes(exam.id)&&selection.indexOf(exam.id)+1+' · '}{exam.studentName} · {caseTitle(exam,en)}</label>)}
      </fieldset>}
      {!!item?.suggestions?.length&&<div className="chip-row">{item.suggestions.map(slot=><button className="btn btn-outline compact" type="button" key={slot.date}
        onClick={()=>{setDate(slot.date);setTime(slot.time);setPlace(slot.place);if(admin)setExaminer(slot.examinerId)}}><CalendarDays size={15}/>{dateLabel(slot.date,en)} · {slot.time}</button>)}</div>}
      <div className="assessment-fields">
        <label>{t('التاريخ','Date')}<input type="date" value={date} min={item?.retryDate&&item.retryDate>data.date?item.retryDate:data.date} onChange={event=>setDate(event.target.value)} required/></label>
        <label>{t('الوقت بتوقيت الرياض','Riyadh time')}<input type="time" value={time} onChange={event=>setTime(event.target.value)} required/></label>
        <label>{t('المدة بالدقائق','Duration in minutes')}<input type="number" min="10" max="180" value={minutes} onChange={event=>setMinutes(Number(event.target.value))} required/></label>
        <label>{t('المختبر','Examiner')}<select value={examinerId} onChange={event=>setExaminer(event.target.value)} required>
          <option value="">{t('اختر المختبر','Select examiner')}</option>{examiners.map(examiner=><option key={examiner.id} value={examiner.id}>{examiner.name}</option>)}
        </select></label>
        <label>{t('طريقة الاختبار','Delivery')}<select value={mode} onChange={event=>setMode(event.target.value as AssessmentAppointment['mode'])}><option value="onsite">{t('حضوري','In person')}</option><option value="online">{t('عن بُعد عبر جلسات الحلقات','Remote through circle sessions')}</option></select></label>
        {mode==='onsite'&&<label>{t('المكان','Location')}<input value={place} onChange={event=>setPlace(event.target.value)} required maxLength={160}/></label>}
      </div>
      {error&&<p className="error-box" role="alert">{error}</p>}
    </div><div className="modal-foot"><button className="btn btn-primary" disabled={busy||batch&&(!selection.length||selection.length>25)}>
      <CalendarDays size={16}/>{admin||item?.canSchedule&&mode==='onsite'?t('حفظ الموعد','Save appointment'):t('اقتراح الموعد للإدارة','Propose to administration')}
    </button></div></form>
  </Modal>
}

export function AssessmentEvaluation({item,close}:{item:AssessmentView;close:()=>void}) {
  const {t,en,post}=useWorkspace()
  const draft=item.attempts.at(-1)?.state==='draft'?item.attempts.at(-1):undefined
  const [scores,setScores]=useState(draft?.scores??item.weights.map(()=>0))
  const [feedback,setFeedback]=useState(draft?.feedback??'')
  const [errors,setErrors]=useState<AssessmentError[]>(draft?.errors??[])
  const [questions,setQuestions]=useState<Segment[]>(draft?.questions??assessmentQuestions(item.parts))
  const [kind,setKind]=useState<AssessmentError['kind']>('memory')
  const [editQuestions,setEditQuestions]=useState(false)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  const [saved,setSaved]=useState(Boolean(draft))
  const revision=useRef(draft?.version??0)
  const busy=useRef(false)
  const changes=useRef(0)
  const persisted=useRef(0)
  const assessmentRanges=assessmentSections(item.parts)
  const allowedSurahs=surahs.filter(surah=>assessmentRanges.some(range=>range.surah===surah.id))
  function changed() {changes.current++;setSaved(false)}
  async function save(submit=false) {
    if(busy.current)return
    if(!submit&&changes.current===persisted.current)return
    busy.current=true
    setPending(true);setError('')
    const sent=changes.current
    try {
      const result=await post(submit?'assessment-submit':'assessment-draft',{id:item.id,version:revision.current,scores,feedback,errors,questions})
      const outcome=result.assessmentDashboard?.items.find(exam=>exam.id===item.id)?.attempts.at(-1)
      if(outcome)revision.current=outcome.version
      persisted.current=sent
      setSaved(sent===changes.current)
      if(submit)close()
    }catch(error){setError((error as Error).message)}
    finally {busy.current=false;setPending(false)}
  }
  useEffect(()=>{
    if(changes.current===persisted.current||pending||error)return
    const timer=setTimeout(()=>void save(),1200)
    return ()=>clearTimeout(timer)
  },[scores,feedback,errors,questions,pending,error])
  useEffect(()=>{
    function warn(event:BeforeUnloadEvent) {
      if(changes.current===persisted.current)return
      event.preventDefault()
      event.returnValue=''
    }
    window.addEventListener('beforeunload',warn)
    return ()=>window.removeEventListener('beforeunload',warn)
  },[])
  function exit() {
    if(busy.current)return
    if(changes.current!==persisted.current&&!window.confirm(t('هناك تعديلات غير محفوظة. هل تريد الإغلاق؟','Close with unsaved changes?')))return
    close()
  }
  return <Modal title={t('إجراء الاختبار والتقييم','Conduct and score assessment')} close={exit} wide appearance="assessment-modal">
    <div className="modal-body">
      <div className="assessment-eval-head"><div><strong>{item.studentName}</strong><p>{item.circleName} · {caseTitle(item,en)}</p></div><strong>{scores.reduce((sum,score)=>sum+score,0)} / 100</strong></div>
      <p>{compactRange(item.parts,en)}</p>
      <div className="assessment-fields">{(item.criteria??defaultAssessmentCriteria).map((criterion,i)=><label key={i}>{t(criterion.ar,criterion.en)} · {item.weights[i]}
        <input type="number" min="0" max={item.weights[i]} value={scores[i]} onChange={event=>{changed();setScores(previous=>previous.map((score,index)=>index===i?Math.min(item.weights[i],Math.max(0,Number(event.target.value))):score))}}/>
      </label>)}</div>
      <fieldset className="assessment-batch-options"><legend>{t('مواضع الأسئلة المقترحة','Suggested question positions')}</legend>
        <p>{segmentLabel(questions,en)}</p>
        <button type="button" className="btn btn-outline compact" onClick={()=>setEditQuestions(!editQuestions)}>{t('مراجعة مواضع الأسئلة','Review question positions')}</button>
        {editQuestions&&questions.map((question,i)=><div className="assessment-error-row" key={i}>
          <label>{t('السورة','Surah')}<select value={question.surah} onChange={event=>{
            const selected=assessmentRanges.find(range=>range.surah===Number(event.target.value))!
            changed();setQuestions(previous=>previous.map((value,index)=>index===i?{surah:selected.surah,from:selected.from,to:selected.from}:value))
          }}>{allowedSurahs.map(surah=><option key={surah.id} value={surah.id}>{en?surah.en:surah.name}</option>)}</select></label>
          <label>{t('الآية','Verse')}<select value={question.from} onChange={event=>{
            const from=Number(event.target.value)
            changed();setQuestions(previous=>previous.map((value,index)=>index===i?{...value,from,to:from}:value))
          }}>{assessmentRanges.filter(range=>range.surah===question.surah).flatMap(range=>Array.from({length:range.to-range.from+1},(_,offset)=>range.from+offset))
            .map(verse=><option key={verse} value={verse}>{verse}</option>)}</select></label>
        </div>)}
      </fieldset>
      <fieldset className="assessment-batch-options"><legend>{t('أخطاء التسميع','Recitation errors')} · {errors.length}</legend>
        <div className="assessment-error-row"><label>{t('نوع الخطأ','Error type')}<select value={kind} onChange={event=>setKind(event.target.value as AssessmentError['kind'])}>
          {errorKinds.map(type=><option key={type} value={type}>{t(errorLabels[type][0],errorLabels[type][1])}</option>)}</select></label>
          <button className="btn btn-outline compact" type="button" disabled={errors.length>=100} onClick={()=>{changed();setErrors(previous=>[...previous,{kind}])}}><Plus size={15}/>{t('تسجيل خطأ','Add error')}</button>
        </div>
        {errors.map((error,i)=>{
          const update=(values:Partial<AssessmentError>)=>{changed();setErrors(previous=>previous.map((value,index)=>i===index?{...value,...values}:value))}
          return <div className="assessment-error-entry" key={i}>
            <div className="split-line"><strong>{t(errorLabels[error.kind][0],errorLabels[error.kind][1])}</strong><button type="button" className="icon-button mini" aria-label={t('حذف الخطأ','Remove error')} onClick={()=>{changed();setErrors(previous=>previous.filter((_,index)=>i!==index))}}><Trash2 size={15}/></button></div>
            <div className="assessment-fields"><label>{t('السورة','Surah')}<select value={error.surah??''} onChange={event=>{
              const surah=Number(event.target.value)||undefined
              update({surah,verse:assessmentRanges.find(range=>range.surah===surah)?.from})
            }}><option value="">{t('دون موضع محدد','No verse position')}</option>{allowedSurahs.map(surah=><option key={surah.id} value={surah.id}>{en?surah.en:surah.name}</option>)}</select></label>
            {!!error.surah&&<label>{t('الآية','Verse')}<select value={error.verse??''} onChange={event=>update({verse:Number(event.target.value)})}>
              {assessmentRanges.filter(range=>range.surah===error.surah).flatMap(range=>Array.from({length:range.to-range.from+1},(_,offset)=>range.from+offset))
                .map(verse=><option key={verse} value={verse}>{verse}</option>)}</select></label>}</div>
            <label>{t('ملاحظة داخلية','Private note')}<input value={error.note??''} maxLength={260} onChange={event=>update({note:event.target.value})}/></label>
          </div>
        })}
      </fieldset>
      <label>{t('التوصيات التي تظهر للطالب وولي الأمر بعد الاعتماد','Recommendations shared after approval')}<textarea value={feedback} maxLength={700} onChange={event=>{changed();setFeedback(event.target.value)}}/></label>
      {error&&<p className="error-box" role="alert">{error}</p>}
      <p role="status">{pending?t('جارٍ حفظ التقييم…','Saving evaluation…'):saved?t('المسودة محفوظة','Draft saved'):t('تُحفظ التعديلات تلقائيًا','Changes are saved automatically')}</p>
    </div>
    <div className="modal-foot"><button type="button" className="btn btn-outline" disabled={pending} onClick={()=>void save()}><Save size={16}/>{t('حفظ المسودة','Save draft')}</button>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={()=>void save(true)}><Check size={16}/>{t('إرسال للاعتماد','Submit for approval')}</button>
    </div>
  </Modal>
}

const numericList=(v:FormDataEntryValue|null)=>asciiDigits(String(v??'')).split(/[\s,،]+/).filter(Boolean).map(Number)
export function AssessmentSettings({data:dashboard,run,busy}:{data:AssessmentDashboard;run:RunAssessment;busy:boolean}) {
  const {data,t,en}=useWorkspace()
  const [target,setTarget]=useState('')
  const base=dashboard.policy??defaultAssessmentPolicy
  const policy=target?dashboard.rings?.[target]??base:base
  const criteria=policy.criteria??defaultAssessmentCriteria
  const [student,setStudent]=useState('')
  async function savePolicy(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f=new FormData(event.currentTarget)
    const n=(key:string)=>Number(f.get(key))
    const enabled=(key:string)=>f.has(key)
    const read=String(f.get('stagePassing')??'').trim().split(/[\s,،]+/).filter(Boolean)
    const next:AssessmentPolicy={active:enabled('active'),order:numericList(f.get('order')),practiceSize:n('practiceSize'),stageSize:n('stageSize'),
      requirePractice:enabled('requirePractice'),workdays:f.getAll('workdays').map(Number),holidays:String(f.get('holidays')??'').split(/[\s,،]+/).filter(Boolean),
      days:{practice:n('practiceDays'),stage:n('stageDays')},passing:{practice:n('practicePassing'),stage:n('stageMark')},
      stagePassing:Object.fromEntries(read.map(line=>line.split('=').map(Number))),extensionDays:n('extensionDays'),extensionLimit:n('extensionLimit'),
      retakeDays:n('retakeDays'),reminderDays:numericList(f.get('reminderDays')),weights:criteria.map((_,i)=>n('weight'+i)),
      criteria:criteria.map((_,i)=>({ar:String(f.get('criterion-ar'+i)??''),en:String(f.get('criterion-en'+i)??'')})),
      grades:policy.grades.map((_,i)=>({min:n('grade'+i),ar:String(f.get('ar'+i)??''),en:String(f.get('en'+i)??'')})),
      teacherApproval:enabled('teacherApproval'),teacherScheduling:enabled('teacherScheduling'),autoCertificate:enabled('autoCertificate')}
    await run('assessment-policy',{target,policy:next})
  }
  return <div className="assessment-settings">
    <label>{t('نطاق الإعدادات','Policy scope')}<select value={target} onChange={event=>setTarget(event.target.value)}><option value="">{t('السياسة العامة','General policy')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></label>
    <form key={target} onSubmit={savePolicy} className="assessment-policy-form">
      <div className="assessment-fields">{([
        ['active',t('إنشاء الاختبارات تلقائيًا','Create assessments automatically')],['requirePractice',t('اشتراط اجتياز التجريبي','Require practice passes')],
        ['teacherApproval',t('السماح للمختبر باعتماد التجريبي','Allow examiners to approve practice')],['teacherScheduling',t('السماح للمحفّظ بجدولة الحضوري','Allow teachers to book in-person exams')],
        ['autoCertificate',t('إصدار الشهادة تلقائيًا بعد الاعتماد','Issue certificates after approval')],
      ] as const).map(([key,label])=><label className="check-line" key={key}><input type="checkbox" name={key} defaultChecked={policy[key]}/>{label}</label>)}</div>
      <label>{t('ترتيب أجزاء المسار (1 إلى 30، مفصولة بفواصل)','Order all parts 1–30, separated by commas')}<textarea name="order" required rows={2} dir="ltr" defaultValue={policy.order.join(', ')}/></label>
      <fieldset className="day-select"><legend>{t('أيام العمل','Working days')}</legend>
        {(en?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']).map((day,i)=><label className="check-line" key={day}><input type="checkbox" name="workdays" value={i} defaultChecked={policy.workdays.includes(i)}/>{day}</label>)}
      </fieldset>
      <label>{t('العطلات والإجازات (YYYY-MM-DD)','Holidays (YYYY-MM-DD)')}<textarea name="holidays" rows={2} dir="ltr" defaultValue={policy.holidays.join('\n')}/></label>
      <div className="assessment-fields">{([
        ['practiceSize',t('الأجزاء لكل اختبار تجريبي','Parts per practice assessment'),policy.practiceSize,1,30],
        ['stageSize',t('الأجزاء لكل مرحلة','Parts per stage'),policy.stageSize,1,30],
        ['practiceDays',t('مهلة التجريبي بأيام العمل','Practice preparation days'),policy.days.practice,1,60],
        ['stageDays',t('مهلة المرحلي بأيام العمل','Stage preparation days'),policy.days.stage,1,60],
        ['practicePassing',t('درجة اجتياز التجريبي','Practice pass mark'),policy.passing.practice,0,100],
        ['stageMark',t('درجة اجتياز المرحلي','Stage pass mark'),policy.passing.stage,0,100],
        ['extensionDays',t('أقصى أيام للتمديد','Maximum extension days'),policy.extensionDays,1,3],
        ['extensionLimit',t('عدد طلبات التمديد','Extension request limit'),policy.extensionLimit,0,5],
        ['retakeDays',t('أيام العمل قبل إعادة الاختبار','Working days before a retake'),policy.retakeDays,1,60],
      ] as const).map(([name,label,value,min,max])=><label key={name}>{label}<input name={name} type="number" min={min} max={max} defaultValue={value} required/></label>)}
      <label>{t('درجات اجتياز خاصة بالمراحل، مثل 1=80','Stage-specific pass marks, e.g. 1=80')}<input name="stagePassing" dir="ltr" defaultValue={Object.entries(policy.stagePassing).map(([k,v])=>k+'='+v).join(', ')}/></label>
      <label>{t('التذكير قبل عدد أيام العمل','Remind this many working days before deadline')}<input name="reminderDays" dir="ltr" defaultValue={policy.reminderDays.join(', ')}/></label></div>
      <fieldset className="assessment-batch-options"><legend>{t('معايير التقييم وأوزانها','Rubric criteria and weights')}</legend>{criteria.map((criterion,i)=>
        <div className="assessment-fields" key={i}>
          <label>{t('المعيار بالعربية','Arabic criterion')}<input name={'criterion-ar'+i} required maxLength={80} defaultValue={criterion.ar}/></label>
          <label>{t('المعيار بالإنجليزية','English criterion')}<input name={'criterion-en'+i} required maxLength={80} defaultValue={criterion.en}/></label>
          <label>{t('الوزن من 100','Weight out of 100')}<input name={'weight'+i} type="number" min="0" max="100" required defaultValue={policy.weights[i]}/></label>
        </div>)}</fieldset>
      <fieldset className="assessment-batch-options"><legend>{t('التقديرات','Grade bands')}</legend>{policy.grades.map((grade,i)=><div className="assessment-fields" key={i}>
        <label>{t('الحد الأدنى','Minimum')}<input name={'grade'+i} type="number" min="0" max="100" required defaultValue={grade.min}/></label>
        <label>{t('التقدير بالعربية','Arabic grade')}<input name={'ar'+i} required defaultValue={grade.ar}/></label>
        <label>{t('التقدير بالإنجليزية','English grade')}<input name={'en'+i} required defaultValue={grade.en}/></label>
      </div>)}</fieldset>
      <div className="chip-row"><button className="btn btn-primary" disabled={busy}><Save size={16}/>{t('حفظ سياسة الاختبارات','Save assessment policy')}</button>
      {target&&dashboard.rings?.[target]&&<button className="btn btn-outline" disabled={busy} type="button" onClick={()=>void run('assessment-policy',{target,reset:true})}>{t('استعادة السياسة العامة','Use general policy')}</button>}</div>
    </form>
    <form className="assessment-policy-form" onSubmit={event=>{event.preventDefault();void run('assessment-route',{target:student,order:numericList(new FormData(event.currentTarget).get('order'))})}}>
      <label>{t('مسار مخصص للطالب','Student memorization route')}<select value={student} onChange={event=>setStudent(event.target.value)} required>
        <option value="">{t('اختر الطالب','Select student')}</option>{dashboard.roster.map(student=><option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
      {student&&<label>{t('ترتيب الأجزاء','Part order')}<textarea key={student} name="order" required rows={2} dir="ltr" defaultValue={dashboard.roster.find(entry=>entry.id===student)?.route.join(', ')}/></label>}
      <div className="chip-row"><button className="btn btn-primary" disabled={busy||!student}>{t('حفظ مسار الطالب','Save student route')}</button>
        {dashboard.routes?.[student]&&<button className="btn btn-outline" disabled={busy} type="button" onClick={()=>void run('assessment-route',{target:student,reset:true})}>{t('استعادة مسار الحلقة','Use circle route')}</button>}
      </div>
    </form>
  </div>
}

export function ManualAssessment({dashboard,run,busy,close}:{dashboard:AssessmentDashboard;run:RunAssessment;busy:boolean;close:()=>void}) {
  const {data,t}=useWorkspace()
  const [student,setStudent]=useState('')
  const [kind,setKind]=useState<'practice'|'stage'>('practice')
  const [scope,setScope]=useState('')
  const learner=dashboard.roster.find(person=>person.id===student)
  const policy=dashboard.rings?.[learner?.circleId??'']??dashboard.policy??defaultAssessmentPolicy
  const size=kind==='practice'?policy.practiceSize:policy.stageSize
  const groups=learner?assessmentChunks(learner.route,size).filter(parts=>parts.every(part=>learner.parts.includes(part)
    &&(kind==='practice'||!policy.requirePractice||learner.practiceParts.includes(part)))):[]
  return <Modal title={t('إضافة استحقاق اختبار','Add assessment eligibility')} close={close}>
    <form onSubmit={async event=>{
      event.preventDefault()
      if(await run('assessment-create',{studentId:student,kind,parts:scope.split(',').map(Number)}))close()
    }}><div className="modal-body">
      <label>{t('الطالب','Student')}<select value={student} required onChange={event=>{setStudent(event.target.value);setScope('')}}>
        <option value="">{t('اختر الطالب','Select student')}</option>{dashboard.roster.map(learner=><option key={learner.id} value={learner.id}>{learner.name} · {data.circles.find(circle=>circle.id===learner.circleId)?.name}</option>)}
      </select></label>
      <label>{t('نوع الاختبار','Assessment type')}<select value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setScope('')}}>
        <option value="practice">{t('تجريبي','Practice')}</option><option value="stage">{t('مرحلي','Stage')}</option>
      </select></label>
      <label>{t('نطاق الحفظ المكتمل','Completed memorization scope')}<select value={scope} required onChange={event=>setScope(event.target.value)}>
        <option value="">{t('اختر الأجزاء','Select parts')}</option>{groups.map(parts=><option key={parts.join(',')} value={parts.join(',')}>{parts.join('، ')}</option>)}
      </select></label>
      {student&&!groups.length&&<p>{t('لا يوجد نطاق مكتمل ومستوفٍ لشروط هذا النوع.','No completed scope meets this assessment’s requirements.')}</p>}
    </div><div className="modal-foot"><button className="btn btn-primary" disabled={busy||!scope}>{t('إضافة الاستحقاق','Add assessment')}</button></div></form>
  </Modal>
}
