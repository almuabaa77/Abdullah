import { useState } from 'react'
import { CalendarDays, Clock3, Megaphone, X } from 'lucide-react'
import type { Announcement, Notice } from './domain'
import { useWorkspace, type Tr } from './ui'

const sources:Record<Announcement['source'],[string,string]>={
  administration:['الإدارة','Administration'],circles:['إدارة الحلقات','Circle administration'],'student-affairs':['شؤون الطلاب','Student affairs'],
}
const audiences:Record<Announcement['audience'],[string,string]>={
  all:['الجميع','Everyone'],circle:['حلقة محددة','A specific circle'],student:['طالب محدد','A specific student'],parent:['ولي أمر محدد','A specific guardian'],
}
const templates=[
  {name:['تذكير بموعد الحلقة','Circle reminder'],title:['تذكير بموعد الحلقة','Circle reminder'],body:['نذكّركم بموعد الحلقة القادم. نأمل الحضور في الوقت المحدد والاستعداد بالتسميع المطلوب.','Please arrive on time for the upcoming circle meeting and prepare your assigned recitation.']},
  {name:['تغيير موعد','Schedule change'],title:['تحديث موعد الحلقة','Circle schedule update'],body:['نود إبلاغكم بتغيير موعد الحلقة. الموعد الجديد هو ','The circle meeting has been rescheduled. The new date and time are ']},
  {name:['إشادة بالإنجاز','Achievement recognition'],title:['تهنئة بالإنجاز','Congratulations on your achievement'],body:['نبارك لكم هذا الإنجاز، ونثمّن جهودكم في حفظ كتاب الله. نسأل الله لكم دوام التوفيق.','Congratulations on your achievement. We appreciate your dedication to memorizing the Quran.']},
] as const
export const announcementSource=(source:Announcement['source']|undefined,t:Tr)=>t(...sources[source??'administration'])
export const announcementAudience=(audience:Announcement['audience']|undefined,t:Tr)=>t(...audiences[audience??'all'])
export function announcementDate(time:string,en:boolean) {
  return new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(time))
}

function AnnouncementCard({title,body,source,close}:{title:string;body:string;source:string;close?:()=>void}) {
  const {t}=useWorkspace()
  return <article className="app-announcement">
    <span className="announcement-icon"><Megaphone size={20}/></span>
    <div className="announcement-copy"><small>{source}</small><h2>{title}</h2><p>{body}</p></div>
    {close&&<button type="button" className="icon-button announcement-close" onClick={close} aria-label={t('إغلاق الإعلان','Dismiss announcement')}><X size={18}/></button>}
  </article>
}

export function AnnouncementFeed() {
  const {data,t,en,post,tell}=useWorkspace()
  const [hidden,setHidden]=useState<string[]>([])
  const items=data.notices.filter(notice=>notice.kind==='announcement'&&!notice.announcement?.withdrawn
    &&(!notice.announcement||notice.announcement.publishedAt)&&!notice.announcement?.dismissedBy?.includes(data.user?.id??'')&&!hidden.includes(notice.id))
    .sort((a,b)=>b.time.localeCompare(a.time)).slice(0,1)
  async function dismiss(notice:Notice) {
    setHidden(current=>[...current,notice.id])
    try{await post('announcement-dismiss',{id:notice.id})}
    catch(error){setHidden(current=>current.filter(id=>id!==notice.id));tell((error as Error).message,true)}
  }
  return items.length?<section className="announcement-feed" aria-label={t('إعلانات المنصة','Platform announcements')}>
    {items.map(notice=><AnnouncementCard key={notice.id} title={en&&notice.en?notice.en:notice.title} body={en&&notice.bodyEn?notice.bodyEn:notice.body}
      source={announcementSource(notice.announcement?.source,t)} close={()=>void dismiss(notice)}/>)}
  </section>:null
}

export function AnnouncementFields({scheduled,setScheduled}:{scheduled:boolean;setScheduled:(value:boolean)=>void}) {
  const {data,t,en}=useWorkspace()
  const [title,setTitle]=useState('')
  const [body,setBody]=useState('')
  const [audience,setAudience]=useState<Announcement['audience']>('all')
  const [source,setSource]=useState<Announcement['source']>('administration')
  const recipients=audience==='circle'?data.circles:audience==='student'?data.students.filter(student=>student.active&&data.users.some(user=>user.studentId===student.id&&user.role==='student'&&user.status==='active'&&!user.duplicateOf)):data.users.filter(user=>user.role==='parent'&&user.status==='active'&&!user.duplicateOf)
  return <>
    <fieldset className="form-stack"><legend>{t('قوالب نصية قابلة للتعديل','Editable templates')}</legend><div className="chip-row">
      {templates.map(template=><button key={template.title[0]} type="button" className="btn btn-subtle compact" onClick={()=>{setTitle(t(template.title[0],template.title[1]));setBody(t(template.body[0],template.body[1]))}}>{t(template.name[0],template.name[1])}</button>)}
    </div></fieldset>
    <div className="field-pair">
      <label>{t('مصدر الإعلان','Announcement source')}<select name="source" value={source} onChange={event=>setSource(event.target.value as Announcement['source'])}>
        {Object.entries(sources).map(([key,text])=><option key={key} value={key}>{t(...text)}</option>)}
      </select></label>
      <label>{t('المستلمون','Recipients')}<select name="audience" value={audience} onChange={event=>setAudience(event.target.value as Announcement['audience'])}>
        {Object.entries(audiences).map(([key,text])=><option key={key} value={key}>{t(...text)}</option>)}
      </select></label>
    </div>
    {audience!=='all'&&<label>{announcementAudience(audience,t)}<select key={audience} name="targetId" required defaultValue="">
      <option value="">{t('اختر المستلم','Choose a recipient')}</option>{recipients.map(recipient=><option key={recipient.id} value={recipient.id}>{recipient.name}{'circleId' in recipient&&' · '+(data.circles.find(circle=>circle.id===recipient.circleId)?.name??'')}{'phone' in recipient&&recipient.phone?' · '+recipient.phone:''}</option>)}
    </select></label>}
    <label>{t('عنوان الإعلان','Announcement title')}<input name="title" required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label>
    <label>{t('نص الإعلان','Announcement text')}<textarea name="body" required maxLength={600} rows={4} value={body} onChange={event=>setBody(event.target.value)}/><small className="muted">{body.length} / 600</small></label>
    <div className="field-pair">
      <label>{t('النشر','Publish')}<select name="delivery" value={scheduled?'scheduled':'now'} onChange={event=>setScheduled(event.target.value==='scheduled')}>
        <option value="now">{t('الآن','Now')}</option><option value="scheduled">{t('جدولة النشر','Schedule')}</option>
      </select></label>
      {scheduled&&<label>{t('موعد النشر بتوقيت الرياض','Publish time in Riyadh')}<input name="publishAt" type="datetime-local" required dir={en?'ltr':undefined}/></label>}
    </div>
    {(title||body)&&<section className="announcement-preview"><small className="muted">{t('معاينة البطاقة','Card preview')}</small><AnnouncementCard title={title||t('عنوان الإعلان','Announcement title')} body={body} source={announcementSource(source,t)}/></section>}
  </>
}

export function AnnouncementRow({notice,withdraw,busy}:{notice:Notice;withdraw:()=>void;busy:boolean}) {
  const {data,t,en}=useWorkspace()
  const meta=notice.announcement
  const planned=meta&&!meta.publishedAt&&!meta.withdrawn
  const target=meta?.audience==='circle'?data.circles.find(circle=>circle.id===meta.targetId)?.name
    :meta?.audience==='student'?data.students.find(student=>student.id===meta.targetId)?.name:data.users.find(user=>user.id===meta?.targetId)?.name
  return <article className="announcement-admin-row record-tile">
    <div className="split-line"><h3>{notice.title}</h3><span className="count-pill">{meta?.withdrawn?t('مسحوب','Withdrawn'):planned?t('مجدول','Scheduled'):t('منشور','Published')}</span></div>
    <p className="announcement-body">{notice.body}</p>
    <div className="chip-row"><small>{announcementSource(meta?.source,t)} · {announcementAudience(meta?.audience,t)}{target&&' · '+target}</small>
      <small>{planned?<Clock3 size={14}/>:<CalendarDays size={14}/>}<time dateTime={notice.time}>{announcementDate(notice.time,en)}</time></small></div>
    {!meta?.withdrawn&&<button type="button" disabled={busy} className="btn btn-outline compact" onClick={withdraw}>{planned?t('إلغاء الجدولة','Cancel schedule'):t('سحب الإعلان','Withdraw announcement')}</button>}
  </article>
}
