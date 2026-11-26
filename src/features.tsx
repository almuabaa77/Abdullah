import { useState, type FormEvent } from 'react'
import { Award, Bell, BookOpen, CalendarDays, ChevronLeft, Download, Gift, Globe, Link2, Plus, Send, Smartphone, Star, UserCheck, Users } from 'lucide-react'
import { balanceFor, dateKey, idFor, type Exam, type Student } from './domain'
import { Avatar, Badge, Brand, dateLabel, Empty, Modal, nameFor, RoleName, useWorkspace } from './ui'

export function Store() {
  const {data,t,en,post,tell} = useWorkspace()
  const [selected,setSelected] = useState('')
  const [busy,setBusy] = useState(false)
  const [orderId,setOrderId] = useState(idFor)
  const student = data.students.find(s=>s.id===data.user?.studentId)
  const balance = student?balanceFor(student,data):0
  const p = data.prizes.find(p=>p.id===selected)
  return <div className="page-stack">
    <div className="panel section-panel wallet-header"><div className="section-title"><div><h1>{t('متجر النقاط','Points shop')}</h1><p>{t('استبدل نقاطك بجوائز الحلقة','Redeem your points for circle rewards')}</p></div><span className="count-pill balance-pill"><Star size={17}/>{balance} {t('نقطة','points')}</span></div></div>
    <div className="summary-grid">{data.prizes.filter(x=>x.active).map((p,i)=><article key={p.id} className="panel prize-card">
      <div className={'prize-image tint-'+(i%2?'gold':'green')}>{p.image?<img src={p.image} alt={p.name} loading="lazy" referrerPolicy="no-referrer"/>:i%2?<Gift size={48}/>:<BookOpen size={48}/>}</div>
      <h2>{p.name}</h2><p>{p.description}</p><div className="split-line"><strong><Star size={16}/>{p.price} {t('نقطة','points')}</strong><span>{p.stock?t(`${p.stock} متوفرة`,`${p.stock} in stock`):t('نفدت الكمية','Out of stock')}</span></div>
      <button className="btn btn-primary full" disabled={!student||balance<p.price||!p.stock} onClick={()=>{setOrderId(idFor());setSelected(p.id)}}><Gift size={17}/>{t('استبدال','Redeem')}</button>
    </article>)}</div>
    {!data.prizes.length&&<div className="panel"><Empty title={t('لا توجد جوائز متاحة','No rewards available')}/></div>}
    <section className="panel section-panel"><div className="section-title"><h2>{t('طلبات الاستبدال','Redemption orders')}</h2></div>{data.orders.length?data.orders.map(o=><div className="entity-row" key={o.id}><div><strong>{o.name}</strong><p>{dateLabel(o.date,en)} · {o.price} {t('نقطة','points')}</p></div><Badge status={o.status} label={o.status==='pending'?t('قيد المراجعة','Under review'):undefined}/></div>):<Empty title={t('لا توجد طلبات','No orders yet')}/>}</section>
    {p&&<Modal title={t('تأكيد الاستبدال','Confirm redemption')} close={()=>{if(!busy)setSelected('')}}><div className="modal-body"><p>{t(`استبدال ${p.name} مقابل ${p.price} نقطة؟`,`Redeem ${p.name} for ${p.price} points?`)}</p></div><div className="modal-foot"><button className="btn btn-outline" onClick={()=>setSelected('')} disabled={busy}>{t('إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={busy} onClick={async()=>{setBusy(true);try{await post('redeem',{id:p.id,studentId:student?.id},orderId);setSelected('');tell(t('تم إرسال طلب الاستبدال','Redemption requested'))}catch(e){tell((e as Error).message,true)}finally{setBusy(false)}}}>{t('تأكيد الاستبدال','Confirm redemption')}</button></div></Modal>}
  </div>
}

export function Leaves() {
  const {data,t,en,post,tell} = useWorkspace()
  const [show,setShow] = useState(false)
  const [busy,setBusy] = useState(false)
  const staff = data.user?.role==='teacher'||data.user?.role==='admin'
  const submit = async (e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);try{await post('leave',Object.fromEntries(new FormData(e.currentTarget)));setShow(false);tell(t('تم إرسال طلب الاستئذان','Leave request submitted'))}catch(e){tell((e as Error).message,true)}finally{setBusy(false)}}
  const review = async (id:string,status:string)=>{try{await post('leave-review',{id,status});tell(t('تم تحديث الطلب','Request updated'))}catch(e){tell((e as Error).message,true)}}
  return <section className="panel section-panel"><div className="section-title"><div><h1>{t('طلبات الاستئذان','Leave requests')}</h1><p>{t('تابع حالة الطلبات وأيام الاستئذان','Track leave requests and dates')}</p></div>{!staff&&<button className="btn btn-primary" onClick={()=>setShow(true)} disabled={!data.students.length}><Plus size={17}/>{t('طلب استئذان','Request leave')}</button>}</div>
    {data.leaves.map(l=><div key={l.id} className="entity-row"><div><strong>{data.students.find(s=>s.id===l.studentId)?.name}</strong><p>{dateLabel(l.date,en)} · {l.reason}</p></div><div className="chip-row"><Badge status={l.status} label={l.status==='pending'?t('قيد المراجعة','Under review'):undefined}/>{staff&&l.status==='pending'&&<><button className="btn btn-subtle compact" onClick={()=>void review(l.id,'accepted')}>{t('اعتماد','Accept')}</button><button className="btn btn-outline compact" onClick={()=>void review(l.id,'declined')}>{t('رفض','Decline')}</button></>}</div></div>)}
    {!data.leaves.length&&<Empty title={t('لا توجد طلبات استئذان بعد','No leave requests yet')}/>}
    {show&&<Modal title={t('طلب استئذان','Request leave')} close={()=>setShow(false)}><form onSubmit={submit}><div className="modal-body"><label>{t('الطالب','Student')}<select name="studentId" required>{data.students.map(s=><option value={s.id} key={s.id}>{nameFor(s,en)}</option>)}</select></label><label>{t('التاريخ','Date')}<input type="date" name="date" min={data.date} defaultValue={data.date} required/></label><label>{t('السبب','Reason')}<textarea name="reason" maxLength={400} required/></label></div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('إرسال الطلب','Submit request')}</button></div></form></Modal>}
  </section>
}

export function Exams() {
  const {data,t,en,post,tell} = useWorkspace()
  const staff = data.user?.role==='teacher'||data.user?.role==='admin'
  const [open,setOpen] = useState(false)
  const [result,setResult] = useState<{exam:Exam; student:Student}>()
  const [certificate,setCertificate] = useState<{exam:Exam; student:Student}>()
  const [busy,setBusy] = useState(false)
  const submit = async (e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);try{if(result){await post('exam-result',{...Object.fromEntries(f),id:result.exam.id,studentId:result.student.id});setResult(undefined)}else{await post('exam',{...Object.fromEntries(f),studentIds:f.getAll('studentIds')});setOpen(false)}tell(t('تم الحفظ','Saved'))}catch(e){tell((e as Error).message,true)}finally{setBusy(false)}}
  return <section className="panel section-panel"><div className="section-title"><div><h1>{t('الاختبارات','Assessments')}</h1><p>{t('المواعيد والنتائج وشهادات الإنجاز','Schedules, results and certificates')}</p></div>{staff&&<button className="btn btn-primary" onClick={()=>setOpen(true)} disabled={!data.students.length}><Plus size={16}/>{t('اختبار جديد','New assessment')}</button>}</div>
    {data.exams.map(exam=><article className="record-tile exam-card" key={exam.id}><div className="split-line"><div><h2>{exam.name}</h2><p>{dateLabel(exam.date,en,true)} · {exam.place}</p></div><span className="stat-icon tint-gold"><Award size={20}/></span></div><p>{exam.scope}</p>{data.students.filter(s=>exam.studentIds.includes(s.id)).map(s=><div className="entity-row" key={s.id}><div><strong>{nameFor(s,en)}</strong><p>{exam.results[s.id]?exam.results[s.id].score+'/100 · '+exam.results[s.id].feedback:t('بانتظار النتيجة','Awaiting result')}</p></div><div className="chip-row">{staff&&<button className="btn btn-outline compact" onClick={()=>setResult({exam,student:s})}>{t('تسجيل النتيجة','Record result')}</button>}{exam.results[s.id]&&<button className="btn btn-subtle compact" onClick={()=>setCertificate({exam,student:s})}><Award size={16}/>{t('شهادة','Certificate')}</button>}</div></div>)}</article>)}
    {!data.exams.length&&<Empty title={t('لا توجد اختبارات مجدولة','No assessments scheduled')}/>}
    {(open||result)&&<Modal title={result?t('تسجيل النتيجة','Record result'):t('اختبار جديد','New assessment')} close={()=>{setOpen(false);setResult(undefined)}}><form onSubmit={submit}><div className="modal-body">{result?<><strong>{nameFor(result.student,en)}</strong><label>{t('الدرجة من 100','Score out of 100')}<input name="score" type="number" min="0" max="100" required defaultValue={result.exam.results[result.student.id]?.score}/></label><label>{t('التقييم','Feedback')}<textarea name="feedback" defaultValue={result.exam.results[result.student.id]?.feedback}/></label></>:<>
      <label>{t('اسم الاختبار','Assessment name')}<input name="name" required/></label><div className="field-pair"><label>{t('الموعد','Date')}<input name="date" type="date" min={data.date} defaultValue={data.date} required/></label><label>{t('المكان','Location')}<input name="place" required/></label></div><label>{t('السور والأجزاء','Surahs and sections')}<textarea name="scope" required/></label><fieldset className="select-list"><legend>{t('المشاركون','Participants')}</legend>{data.students.map(s=><label className="check-line" key={s.id}><input name="studentIds" type="checkbox" value={s.id}/>{nameFor(s,en)}</label>)}</fieldset>
      </>}</div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('حفظ','Save')}</button></div></form></Modal>}
    {certificate&&<Modal title={t('شهادة إنجاز','Achievement certificate')} close={()=>setCertificate(undefined)}><div className="modal-body certificate"><Brand/><Award size={42}/><h2>{t('شهادة إنجاز','Achievement certificate')}</h2><strong>{nameFor(certificate.student,en)}</strong><p>{certificate.exam.name}</p><p>{certificate.exam.results[certificate.student.id].score}/100 · {dateLabel(certificate.exam.date,en,true)}</p></div><div className="modal-foot"><button className="btn btn-primary" onClick={()=>window.print()}><Download size={16}/>PDF</button></div></Modal>}
  </section>
}

type InstallEvent = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
export function More({ changeLanguage, switchRole, currentRole, install }: {changeLanguage:()=>void; switchRole:(role:string)=>void; currentRole:string;install:InstallEvent|null}) {
  const {data,t,go,post,tell,en} = useWorkspace()
  const [modal,setModal] = useState<'link'|'install'|'permissions'|''>('')
  const [busy,setBusy] = useState(false)
  const parent = data.user?.role === 'parent'
  const staff = data.user?.role==='admin'||data.user?.role==='teacher'
  const opts = [
    ...(parent?[[Users,t('إضافة طالب','Add a student'),()=>setModal('link')]] as const:[]),
    [CalendarDays,t('الاختبارات','Assessments'),()=>go('exams')],
    [UserCheck,t('الاستئذانات','Leave requests'),()=>go('leaves')],
    ...(staff?[[BookOpen,t('السجل والتقارير','Records and reports'),()=>go('records')]] as const:[]),
    [Globe,t('English','العربية'),changeLanguage],
    [Smartphone,t('تثبيت التطبيق','Install application'),()=>{if(install)void install.prompt();else setModal('install')}],
    [Bell,t('الأذونات','Permissions'),()=>setModal('permissions')],
  ] as const
  return <section className="panel section-panel">
    <div className="section-title"><div><h1>{t('المزيد','More')}</h1><p>{data.user?.name} · <RoleName role={data.user?.role||''}/></p></div></div>
    <div className="more-list">{opts.map(([Icon,label,fn])=><button className="more-row" key={label} onClick={fn}><span className="stat-icon tint-green"><Icon size={18}/></span><strong>{label}</strong><ChevronLeft size={17}/></button>)}</div>
    {parent&&data.links.length>0&&<div className="section-panel"><h2>{t('طلبات الربط','Link requests')}</h2>{data.links.map(l=><div className="entity-row" key={l.id}>{data.students.find(s=>s.id===l.studentId)?.name||t('طلب ربط طالب','Student link request')}<Badge status={l.status} label={l.status==='pending'?t('قيد المراجعة','Under review'):undefined}/></div>)}</div>}
    {data.sample&&<div className="demo-settings"><div><strong>{t('مساحة المعاينة','Preview workspace')}</strong><p>{t('بيانات توضيحية خاصة بك. يمكنك تجربة الواجهات بالأدوار المختلفة.','Private sample data. Explore the interface from each role.')}</p></div><label>{t('عرض الحساب','Account view')}<select value={currentRole} onChange={e=>switchRole(e.target.value)}><option value="admin">{t('لوحة المحفّظ والإدارة','Teacher dashboard & administration')}</option><option value="teacher">{t('المحفّظ','Teacher')}</option><option value="student">{t('الطالب','Student')}</option><option value="parent">{t('ولي الأمر','Guardian')}</option></select></label></div>}
    {modal==='link'&&<Modal title={t('إضافة طالب','Add a student')} close={()=>setModal('')}><form onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);try{await post('link',{phone:form.get('phone')});tell(t('إذا كان الرقم مسجلًا فسيصل الطلب للإدارة.','If the phone is registered, the request will be sent to administration.'));setModal('')}catch(err){tell((err as Error).message,true)}finally{setBusy(false)}}}><div className="modal-body"><p>{t('أدخل رقم جوال الطالب المسجل. تراجع الإدارة الطلب قبل إتاحة البيانات.','Enter the student’s registered mobile number. Administration reviews access requests.')}</p><label>{t('رقم جوال الطالب','Student mobile number')}<input type="tel" name="phone" dir="ltr" placeholder="+966 5X XXX XXXX" required/></label></div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}><Link2 size={16}/>{t('إرسال طلب الربط','Send link request')}</button></div></form></Modal>}
    {modal==='install'&&<Modal title={t('تثبيت التطبيق','Install application')} close={()=>setModal('')}><div className="modal-body"><div className="hint-line"><Smartphone size={18}/>{t('على iPhone أو iPad من Safari، اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية.','On iPhone or iPad in Safari, tap Share and then Add to Home Screen.')}</div><p>{t('على Android أو الكمبيوتر، افتح قائمة المتصفح واختر تثبيت التطبيق إذا ظهر الخيار.','On Android or desktop, open the browser menu and select Install app when offered.')}</p></div></Modal>}
    {modal==='permissions'&&<Modal title={t('أذونات التطبيق','App permissions')} close={()=>setModal('')}><div className="modal-body"><p>{t('يطلب التطبيق الأذونات من المتصفح عند استخدامها. يمكنك تغييرها من إعدادات الموقع.','The browser asks for permissions when needed. Change them in site settings.')}</p><button className="btn btn-outline" onClick={async()=>{if(!('Notification'in window)){tell(t('هذا المتصفح لا يدعم الإشعارات','Notifications are unavailable in this browser'),true);return}const result=await Notification.requestPermission();tell(result==='granted'?t('تم السماح بإشعارات الجهاز','Device notifications allowed'):t('يمكن تغيير الإذن من إعدادات الموقع','Change access from site settings'))}}><Bell size={16}/>{t('السماح بالإشعارات','Allow notifications')}</button></div></Modal>}
  </section>
}

export const today = dateKey
