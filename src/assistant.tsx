import { useEffect, useRef, useState } from 'react'
import { BookOpen, CalendarDays, CircleCheck, Clock3, FileText, ListChecks, MessageSquare, Plus, RotateCcw, Send, Sparkles, Star, UserCheck, Users } from 'lucide-react'
import { assignmentFor, circleMeets, isRecitationDue, recitationStatus, segmentLabel, type Daily, type Student } from './domain'
import { Avatar, dateLabel, nameFor, statusText, useWorkspace } from './ui'
import { parseCommand, type Intent } from './assistant-command'
import { RecitationBadge, StudentPicker } from './recitation-roster'

type Exchange = {id:number; command:string; intent?:Intent; student?:Student; preset?:Partial<Daily>; error?:string}

export function Assistant() {
  const {t,data,en,open,go} = useWorkspace()
  const [text,setText] = useState('')
  const [exchanges,setExchanges] = useState<Exchange[]>([])
  const [view,setView] = useState<'assistant'|'students'>('assistant')
  const [circleId,setCircleId] = useState('')
  const conversation = useRef<HTMLDivElement>(null)
  const counter = useRef(0)
  const students = data.students.filter(s=>s.active&&(!circleId||s.circleId===circleId))
  const meetingCircles = new Set(data.circles.filter(circle=>circleMeets(data.date,circle)).map(circle=>circle.id))
  const todayStudents = students.filter(student=>meetingCircles.has(student.circleId))
  const today = new Map(data.daily.filter(d=>d.date===data.date).map(d=>[d.studentId,d]))
  const completed = todayStudents.filter(s=>recitationStatus(today.get(s.id))==='complete').length
  const remaining = todayStudents.filter(s=>isRecitationDue(today.get(s.id)))
  const progress = todayStudents.length ? Math.round(completed/todayStudents.length*100) : 0
  const shortcuts = [
    ['recite',BookOpen,t('إضافة تسميع','Record recitation'),t('من جدولة الطالب لليوم','From the student’s daily assignment'),'green'],
    ['review',RotateCcw,t('تسجيل مراجعة','Log revision'),t('ابدأ من مرحلة المراجعة','Start at the revision step'),'gold'],
    ['schedule',CalendarDays,t('جدولة الطالب','Plan an assignment'),t('الحفظ والمراجعة القادمة','Upcoming work'),'blue'],
    ['attendance',UserCheck,t('تسجيل الحضور','Mark attendance'),t('الحضور والغياب والاستئذان','Attendance, absence and leave'),'green'],
    ['points',Star,t('تعديل النقاط','Adjust points'),t('مكافأة أو خصم','Bonus or deduction'),'gold'],
    ['report',FileText,t('تقرير طالب','Student report'),t('افتح سجل الطالب','Open a student record'),'blue'],
  ] as const
  const append = (command:string,details:Omit<Exchange,'id'|'command'>={}) => {
    const id=counter.current++
    setExchanges(previous=>[...previous,{id,command,...details}])
    setView('assistant')
  }
  useEffect(()=>{
    const feed=conversation.current
    if(exchanges.length&&feed&&view==='assistant') feed.scrollTop=feed.scrollHeight
  },[exchanges,view])

  function submit(command:string) {
    const query=command.trim()
    if(!query)return
    setText('')
    try{append(query,parseCommand(query,students))}
    catch{append(query,{error:t('تحقق من أرقام الآيات وتداخل المقاطع، ثم أعد إرسال الأمر.','Check the verse numbers and overlapping segments, then try again.')})}
  }

  const select = (id:number,student:Student) => setExchanges(items=>items.map(item=>item.id===id?{...item,student}:item))
  const openEntry = (student:Student,intent:Intent,preset?:Partial<Daily>) => {
    if(intent==='report'){sessionStorage.setItem('report-student',student.id);go('records');return}
    open(student,intent==='remaining'?'recite':intent,preset)
  }
  const last = exchanges.at(-1)
  const example = t('سجّل تسميع عبدالله سورة النبأ من 37 إلى 40','Record Abdullah Al-Naba from 37 to 40')
  return <div className="recitation-workspace">
    <header className="workbench-hero">
      <div className="workbench-hero-art"/>
      <div className="workbench-hero-copy"><span className="workbench-date"><CalendarDays size={15}/>{dateLabel(data.date,en,true)}</span>
      <h1>{t('المساعد الذكي','Smart assistant')}</h1>
      <p>{t('سجّل التسميع وتابع طلاب الحلقة من مكان واحد.','Record recitations and follow your circle in one place.')}</p></div>
      <div className="workbench-hero-actions">
        {data.circles.length>1&&<label className="circle-picker"><select aria-label={t('حلقة المساعد','Assistant circle')} value={circleId} onChange={event=>setCircleId(event.target.value)}><option value="">{t('كل الحلقات','All circles')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}</select></label>}
        <button className="btn btn-gold" disabled={!todayStudents.length} onClick={()=>append(t('تسميع جديد','New recitation'),{intent:'recite'})}><Plus size={18}/>{t('تسميع جديد','New recitation')}</button>
      </div>
    </header>
    <nav className="workbench-mobile-tab" aria-label={t('أقسام المساعد','Assistant views')}>
      <button className={view==='assistant'?'selected':''} aria-pressed={view==='assistant'} onClick={()=>setView('assistant')}><MessageSquare size={17}/>{t('المساعد','Assistant')}</button>
      <button className={view==='students'?'selected':''} aria-pressed={view==='students'} onClick={()=>setView('students')}><Users size={17}/>{t('الطلاب','Students')}<span>{remaining.length}</span></button>
    </nav>
    <div className="workbench-grid" data-mobile-view={view}>
      <section className="panel workbench-chat" aria-label={t('محادثة المساعد','Assistant conversation')}>
        <header className="workbench-panel-head"><span className="workbench-icon"><Sparkles size={21}/></span><div><h2>{t('مساحة العمل','Workspace')}</h2><p>{t('اختر عملية أو اكتب طلبك','Choose an action or type a request')}</p></div>
          {exchanges.length>0&&<button className="icon-button" title={t('محادثة جديدة','New conversation')} aria-label={t('محادثة جديدة','New conversation')} onClick={()=>setExchanges([])}><Plus size={20}/></button>}
        </header>
        <div className="workbench-feed" ref={conversation}>
          {!exchanges.length&&<div className="workbench-start">
            <div className="workbench-welcome"><span className="workbench-welcome-icon"><Sparkles size={25}/></span><h2>{t('كيف تريد المتابعة اليوم؟','What would you like to do today?')}</h2><p>{t('ابدأ بإحدى العمليات السريعة أو اكتب طلبك باسم الطالب.','Start with a quick action or write a request with a student’s name.')}</p></div>
            <div className="workbench-actions">{shortcuts.map(([intent,Icon,title,desc,tint])=><button className="workbench-action" key={intent} onClick={()=>append(title,{intent})}><span className={'stat-icon tint-'+tint}><Icon size={21}/></span><span><strong>{title}</strong><small>{desc}</small></span></button>)}</div>
            <button className="example-command" type="button" onClick={()=>setText(example)}><MessageSquare size={15}/><span>{example}</span></button>
          </div>}
          {exchanges.map(exchange=>{
            const student=exchange.student
            const assignment=student&&assignmentFor(data.daily,student.id,data.date)
            const segments=exchange.preset?.memorization||exchange.preset?.review||exchange.preset?.nextMemorization||exchange.preset?.nextReview
            return <article key={exchange.id} className="workbench-exchange">
              <p className="workbench-user-message">{exchange.command}</p>
              <div className="workbench-reply"><span className="bot-icon"><Sparkles size={17}/></span><div className="workbench-answer">
                {exchange.error?<p role="alert">{exchange.error}</p>:!exchange.intent?<p>{t('اذكر العملية واسم الطالب، أو اختر واحدة من العمليات السريعة.','Include an action and a student’s name, or choose a quick action.')}</p>:student?<div className="assistant-review-card">
                  <div className="assistant-review-name"><Avatar student={student}/><div><strong>{nameFor(student,en)}</strong><span>{t('راجع البيانات قبل اعتمادها','Review before confirming')}</span></div><RecitationBadge record={today.get(student.id)}/></div>
                  {!!assignment?.nextMemorization.length&&exchange.intent!=='review'&&<p><strong>{t('الحفظ المجدول لليوم','Today’s assigned memorization')}</strong> · {segmentLabel(assignment.nextMemorization,en)}</p>}
                  {!!assignment?.nextReview.length&&<p><strong>{t('المراجعة المجدولة لليوم','Today’s assigned revision')}</strong> · {segmentLabel(assignment.nextReview,en)}</p>}
                  {!!segments?.length&&<p><strong>{t('المقاطع','Segments')}</strong> · {segmentLabel(segments,en)}</p>}
                  {exchange.preset?.attendance&&<p>{statusText(exchange.preset.attendance,t)}</p>}
                  {exchange.preset?.bonus!==undefined&&<p>{t('تعديل النقاط','Points adjustment')} · {exchange.preset.bonus}</p>}
                  <button className="btn btn-primary compact" disabled={exchange.intent!=='report'&&!meetingCircles.has(student.circleId)} onClick={()=>openEntry(student,exchange.intent!,exchange.preset)}>{exchange.intent==='report'?t('فتح التقرير','Open report'):t('مراجعة العملية','Review entry')}</button>
                  {exchange.intent!=='report'&&!meetingCircles.has(student.circleId)&&<small className="muted">{t('الحلقة لا تنعقد اليوم','This circle does not meet today')}</small>}
                </div>:<>
                  <strong>{exchange.intent==='remaining'?t(`${remaining.length} طلاب بانتظار إتمام التسميع`,`${remaining.length} students to recite`):t('اختر الطالب','Select a student')}</strong>
                  {last?.id===exchange.id&&<StudentPicker key={exchange.id+circleId} compact students={exchange.intent==='remaining'?remaining:exchange.intent==='report'?students:todayStudents} defaultFilter={exchange.intent==='recite'||exchange.intent==='remaining'?'due':'all'} select={s=>select(exchange.id,s)}/>}
                </>}
              </div></div>
            </article>
          })}
        </div>
        <footer className="workbench-compose">
          {exchanges.length>0&&<div className="workbench-shortcuts">{shortcuts.map(([intent,Icon,title])=><button className="shortcut" key={intent} onClick={()=>append(title,{intent})}><Icon size={15}/>{title}</button>)}</div>}
          <form onSubmit={e=>{e.preventDefault();submit(text)}} className="compose-form"><input value={text} onChange={e=>setText(e.target.value)} aria-label={t('اكتب طلبك للمساعد','Type a request')} placeholder={t('اكتب طلبك للمساعد…','Type a request…')} maxLength={500}/><button className="btn btn-primary" type="submit" aria-label={t('إرسال','Send')} disabled={!text.trim()}><Send size={19}/><span>{t('إرسال','Send')}</span></button></form>
        </footer>
      </section>
      <aside className="workbench-side">
        <section className="panel workbench-progress">
          <div className="section-title"><div><h2>{t('تسميع اليوم','Today’s recitations')}</h2><p>{t('الحفظ الجديد في الحلقة','Memorization in your circle')}</p></div><span className="stat-icon tint-green"><ListChecks size={20}/></span></div>
          <div className="workbench-progress-value"><strong>{progress}%</strong><span>{t(`${completed} من ${todayStudents.length} أتمّوا التسميع`,`${completed} of ${todayStudents.length} recited`)}</span></div>
          <div className="bar-track" role="progressbar" aria-valuenow={progress} aria-label={t('نسبة التسميع','Recitation progress')}><i style={{width:progress+'%'}}/></div>
          <div className="workbench-totals"><div><CircleCheck size={16}/><strong>{completed}</strong><span>{t('أتمّوا التسميع','Recited')}</span></div><button type="button" onClick={()=>append(t('عرض الطلاب المتبقين','Show remaining students'),{intent:'remaining'})}><Clock3 size={16}/><strong>{remaining.length}</strong><span>{t('بانتظار التسميع','To recite')}</span></button></div>
        </section>
        <section className="panel workbench-roster"><div className="section-title"><div><h2>{t('طلاب الحلقة','Circle students')}</h2><p>{t('اختر طالبًا لتسجيل تسميعه','Select a student to record recitation')}</p></div><span className="stat-icon tint-gold"><Users size={19}/></span></div>
          <StudentPicker key={circleId} compact students={todayStudents} select={s=>open(s)}/>
        </section>
      </aside>
    </div>
  </div>
}
