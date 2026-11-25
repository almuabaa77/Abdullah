import { useState } from 'react'
import { BookOpen, CalendarDays, CircleHelp, Clock3, FileText, ListChecks, Send, Sparkles, Star, UserCheck } from 'lucide-react'
import { segmentLabel, surahs, validateSegments, type Daily, type Student } from './domain'
import { dateLabel, normal, useWorkspace, type WizardMode } from './ui'
import { StudentPicker } from './wizard'

type Intent = WizardMode | 'review' | 'remaining' | 'report'
type Bot = { id:number; text:string; from:'user'|'bot'; pick?:Intent; student?:Student; preset?:Partial<Daily>; remaining?:boolean }
export function Assistant() {
  const {t,data,en,open,go} = useWorkspace()
  const [text,setText] = useState('')
  const [messages,setMessages] = useState<Bot[]>([])
  const [selected,setSelected] = useState<Student>()
  const shortcuts = [
    ['recite',BookOpen,t('إضافة تسميع','Add recitation')],['review',Clock3,t('تسجيل مراجعة','Log revision')],['schedule',CalendarDays,t('جدولة الحفظ والمراجعة','Plan the next assignment')],
    ['attendance',UserCheck,t('تسجيل الحضور والغياب','Mark attendance')],['points',Star,t('تعديل النقاط','Adjust points')],
    ['report',FileText,t('عرض تقرير طالب','View a student report')],['remaining',ListChecks,t('عرض الطلاب المتبقين','Show remaining students')]
  ] as const
  const remaining = data.students.filter(s=>s.active && !data.daily.some(d=>d.studentId===s.id&&d.date===data.date&&d.memorizationStatus==='complete'&&d.reviewStatus==='complete'&&d.attendance==='present'&&(d.nextMemorization.length||d.nextReview.length)))
  const append = (text:string,extra:Partial<Bot>={}) => setMessages(m=>[...m,{id:m.length,text,from:'bot',...extra}])
  const ask = (intent:Intent,text:string,student?:Student,preset?:Partial<Daily>) => {
    append(text,{from:'user'})
    if(intent==='remaining'){append(t(`عدد الطلاب المتبقين ${remaining.length}`,`${remaining.length} students remaining`),{remaining:true});return}
    if(student){setSelected(student);append(t('راجع بيانات العملية قبل اعتمادها.','Review the entry before confirming it.'),{pick:intent,student,preset});return}
    append(t('اختر طالبًا للمتابعة.','Select a student to continue.'),{pick:intent,preset})
  }
  function submit() {
    const msg = text.trim()
    if(!msg)return
    const n = normal(msg).replace(/[٠-٩]/g,n=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(n)))
    const candidates = data.students.filter(s=>s.active && (n.includes(normal(s.name)) || Boolean(s.latin && n.includes(normal(s.latin)))))
    const firstNameMatches = data.students.filter(s=>s.active && [s.name,s.latin||''].some(name=>name.trim() && n.split(/[\s،,.]+/).includes(normal(name.split(' ')[0]))))
    const student = candidates.length===1?candidates[0]: firstNameMatches.length===1?firstNameMatches[0]:candidates.length===0&&firstNameMatches.length===0?selected:undefined
    const intent:Intent|undefined = /متبق|غير مكتمل|remaining|incomplete/.test(n)?'remaining':/تقرير|report/.test(n)?'report':/جدول|موعد|schedule|assign/.test(n)?'schedule':/حضور|غاب|غياب|غائب|حاضر|مستاذن|اذن|attendance|absent|present/.test(n)?'attendance':/نقط|points/.test(n)?'points':/مراجع|revision|review/.test(n)?'review':/تسميع|حفظ|سمع|recit|memoriz/.test(n)?'recite':undefined
    setText('')
    if(!intent){append(msg,{from:'user'});append(t('اختر إحدى العمليات أدناه أو اكتب أمرًا يتضمن العملية واسم الطالب.','Choose an action below or type an action and a student’s name.'));return}
    const preset:Partial<Daily> = {}
    if(intent==='attendance') preset.attendance=/غائب|غاب|غياب|absent/.test(n)?'absent':/مستاذن|leave/.test(n)?'leave':/حاضر|حضور|present/.test(n)?'present':undefined
    if(intent==='points'){const point=n.match(/-?\d+/)?.[0];if(point) preset.bonus=(/خصم|subtract|deduct/.test(n)?-1:1)*Math.abs(Number(point))}
    if(intent==='review'||intent==='recite'||intent==='schedule'){
      const fromTo = n.match(/(?:من|from)\s*(?:الاية\s*|اية\s*|verse\s*)?(\d+)\s*(?:الي|الى|to|[-–])\s*(?:الاية\s*|اية\s*|verse\s*)?(\d+)/) || n.match(/(\d+)\s*[-–]\s*(\d+)/)
      const chapter = [...surahs].sort((a,b)=>b.name.length - a.name.length).find(s=>[normal(s.name),normal(s.en)].some(name=>n.includes(name)))
      if(chapter&&fromTo){
        try{
          const segments=validateSegments([{surah:chapter.id,from:Number(fromTo[1]),to:Number(fromTo[2])}])
          if(intent==='recite'){preset.memorization=segments;preset.memorizationStatus='complete'}
          if(intent==='review'){preset.review=segments;preset.reviewStatus='complete'}
          if(intent==='schedule')preset.nextMemorization=segments
        }catch(e){append(msg,{from:'user'});append((e as Error).message);return}
      }
    }
    ask(intent,msg,student,preset)
  }
  const card = (s:Student,intent:Intent,preset?:Partial<Daily>) => {
    const prev = data.daily.filter(d=>d.studentId===s.id).sort((a,b)=>b.date.localeCompare(a.date))[0]
    const segment = preset?.memorization||preset?.review||preset?.nextMemorization
    return <div className="assistant-student">
      <strong>{en&&s.latin?s.latin:s.name}</strong>
      {prev&&<p>{t('الجدولة السابقة','Previous assignment')} · {dateLabel(prev.nextDate,en)} · {segmentLabel(prev.nextMemorization,en)||'—'}</p>}
      {segment?.length&&<p>{segmentLabel(segment,en)}</p>}
      {preset?.attendance&&<p>{({present:t('حاضر','Present'),absent:t('غائب','Absent'),leave:t('مستأذن','On leave'),excused:t('بعذر','Excused'),pending:t('لم يسجل','Pending')})[preset.attendance]}</p>}
      {preset?.bonus!==undefined&&<p>{t('تعديل النقاط','Points adjustment')} · {preset.bonus}</p>}
      <button className="btn btn-primary compact" onClick={()=>{if(intent==='report'){sessionStorage.setItem('report-student',s.id);go('records')} else open(s,intent==='review'||intent==='remaining'?'recite':intent,preset)}}>{intent==='report'?t('فتح التقرير','Open report'):t('مراجعة العملية','Review entry')}</button>
    </div>
  }
  return <section className="panel assistant-page">
    <div className="assistant-header"><span className="stat-icon tint-green"><Sparkles size={22}/></span><div><h1>{t('المساعد الذكي','Smart assistant')}</h1><p>{t('مساعدك لتسجيل مهام الحلقة اليومية','Your assistant for daily circle tasks')}</p></div></div>
    <div className="assistant-feed" aria-live="polite">
      <div className="bot-line"><span className="bot-icon"><Sparkles size={18}/></span><div className="chat-bubble"><strong>{t('السلام عليكم! كيف يمكنني مساعدتك؟','Assalamu alaikum! How can I help?')}</strong><p>{t('اختر مهمة سريعة أو اكتب أمرًا باسم الطالب.','Choose a quick action or type a request with a student’s name.')}</p></div></div>
      {messages.map(m=><div key={m.id} className={m.from==='bot'?'bot-line':'user-line'}>{m.from==='bot'&&<span className="bot-icon"><Sparkles size={17}/></span>}<div className="chat-bubble">
        <p>{m.text}</p>
        {m.remaining&&remaining.length>0&&<StudentPicker students={remaining} select={s=>append(t('راجع العملية لهذا الطالب.','Review an entry for this student.'),{pick:'recite',student:s})}/>}
        {m.pick&&(m.student?card(m.student,m.pick,m.preset):<StudentPicker select={s=>{setSelected(s);append(t('راجع بيانات العملية قبل اعتمادها.','Review the entry before confirming it.'),{pick:m.pick,student:s,preset:m.preset})}}/>)}
      </div></div>)}
    </div>
    <div className="assistant-composer">
      <div className="shortcut-grid">{shortcuts.map(([intent,Icon,label])=><button className="shortcut" key={intent} onClick={()=>ask(intent,label)}><Icon size={16}/>{label}</button>)}</div>
      <form onSubmit={e=>{e.preventDefault();submit()}} className="compose-form"><input value={text} onChange={e=>setText(e.target.value)} aria-label={t('اكتب أمرًا','Type a command')} placeholder={t('مثال: سجل تسميع عبدالله سورة النبأ من 37 إلى 40','Example: record Abdullah Al-Naba from 37 to 40')}/><button className="btn btn-primary" type="submit" aria-label={t('إرسال','Send')} disabled={!text.trim()}><Send size={18}/></button></form>
      <p className="small-text muted"><CircleHelp size={14}/>{t('راجع المقاطع والنقاط قبل الاعتماد.','Review segments and points before confirming.')}</p>
    </div>
  </section>
}
