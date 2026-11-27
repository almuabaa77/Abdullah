import { useState, type FormEvent } from 'react'
import { BookOpen, CalendarDays, MessageCircle, Star } from 'lucide-react'
import { defaultCommunication, communicationKeys, type Circle } from './domain'
import { useWorkspace } from './ui'

export function PolicySettings({save,busy}:{save:(action:string,values:Record<string,unknown>)=>Promise<boolean>;busy:boolean}) {
  const {data,t}=useWorkspace()
  const [preview,setPreview]=useState({memorization:String(data.rules.memorization),review:String(data.rules.review),attendance:String(data.rules.attendance)})
  const [chat,setChat]=useState(data.rules.chat)
  const points=[['memorization',t('إتمام الحفظ','Completed memorization')],['review',t('إتمام المراجعة','Completed revision')],['attendance',t('حضور الحلقة','Attendance')]] as const
  const permissions=[
    t('محادثة الطالب مع محفّظ حلقته','Student and circle teacher'),
    t('محادثة ولي الأمر مع محفّظ الابن المرتبط','Guardian and linked child’s teacher'),
    t('المحادثات الجماعية للحلقات','Circle group conversations'),
    t('المكالمات الصوتية','Voice calls'),t('المكالمات المرئية','Video calls'),
  ]
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form=new FormData(event.currentTarget)
    void save('rules',{...Object.fromEntries(form),chat,...Object.fromEntries(communicationKeys.map(key=>[key,form.has(key)]))})
  }
  return <form className="form-stack" onSubmit={submit}>
    <section className="policy-panel record-tile"><h3><Star size={19}/>{t('النقاط اليومية','Daily points')}</h3>
      <div className="summary-grid">{points.map(([key,label])=><label key={key}>{label}<input name={key} type="number" min={0} max={100} required value={preview[key]} onChange={event=>setPreview({...preview,[key]:event.target.value})}/></label>)}</div>
      <p className="hint-line"><Star size={16}/>{t('مجموع يوم مكتمل','Total for a complete day')} <strong>{Number(preview.memorization)+Number(preview.review)+Number(preview.attendance)}</strong></p>
    </section>
    <section className="policy-panel record-tile"><h3><MessageCircle size={19}/>{t('قنوات التواصل','Communication channels')}</h3>
      <label className="check-line"><input name="chat" type="checkbox" checked={chat} onChange={event=>setChat(event.target.checked)}/>{t('السماح بالتواصل','Enable communication')}</label>
      <div className="policy-options">{communicationKeys.map((key,index)=><label className="check-line" key={key}><input type="checkbox" name={key} defaultChecked={(data.rules.communication??defaultCommunication)[key]}/>{permissions[index]}</label>)}</div>
    </section>
    <div><button className="btn btn-primary" disabled={busy}>{t('حفظ الإعدادات','Save settings')}</button></div>
  </form>
}

export function AssessmentPolicyFields({circle}:{circle:Circle}) {
  const {t}=useWorkspace()
  const [enabled,setEnabled]=useState(Boolean(circle.autoExam))
  return <>
    <p className="hint-line"><BookOpen size={18}/>{circle.name}</p>
    <label className="check-line"><input name="enabled" type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>{t('جدولة اختبار عند بلوغ حد الحفظ','Schedule an assessment at a memorization milestone')}</label>
    {enabled&&<>
      <div className="field-pair">
        <label>{t('عدد الآيات المكتملة','Completed verses')}<input name="threshold" type="number" min={1} max={6236} defaultValue={circle.autoExam?.threshold} required/></label>
        <label>{t('مهلة الاستعداد بالأيام','Preparation time in days')}<input name="leadDays" type="number" min={1} max={60} defaultValue={circle.autoExam?.leadDays??3} required/></label>
      </div>
      <div className="field-pair">
        <label>{t('وقت الاختبار بتوقيت الرياض','Time in Riyadh')}<input type="time" name="time" defaultValue={circle.autoExam?.time} required/></label>
        <label>{t('مكان الاختبار','Assessment venue')}<input name="place" maxLength={160} defaultValue={circle.autoExam?.place} required/></label>
      </div>
      <p className="hint-line"><CalendarDays size={17}/>{t('يُختار أول يوم انعقاد بعد مهلة الاستعداد، مع استبعاد الإجازات. تُحسب كل آية مكتملة مرة واحدة.','The first meeting day after the preparation period is used, excluding holidays. Each completed verse counts once.')}</p>
    </>}
  </>
}
