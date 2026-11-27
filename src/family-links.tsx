import { useState, type FormEvent } from 'react'
import { Link2, Search, Users } from 'lucide-react'
import type { Link } from './domain'
import { ChildField, ChildIdentityFields } from './enrollment-form'
import { Badge, Empty, Modal, normal, useWorkspace } from './ui'

function linkLabel(status:Link['status'],t:ReturnType<typeof useWorkspace>['t']) {
  return {pending:t('قيد المراجعة','Under review'),accepted:t('مرتبط','Linked'),declined:t('مرفوض','Declined'),cancelled:t('ملغى','Cancelled')}[status]
}

export function ParentLinks() {
  const {data,t,en,post,tell}=useWorkspace()
  const [open,setOpen]=useState(false)
  const [busy,setBusy]=useState(false)
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy)return
    setBusy(true)
    try {
      await post('link',Object.fromEntries(new FormData(event.currentTarget)))
      setOpen(false)
      tell(t('طلب الربط متاح للمتابعة هنا','You can track the link request here'))
    } catch(error){tell((error as Error).message,true)}
    finally{setBusy(false)}
  }
  async function withdraw(id:string) {
    setBusy(true)
    try{await post('link-withdraw',{id})}catch(error){tell((error as Error).message,true)}
    finally{setBusy(false)}
  }
  return <section className="family-links" aria-label={t('ربط الأبناء','Family links')}>
    <div className="section-title">
      <div><h2>{t('ربط الأبناء','Family links')}</h2><p>{t('أضف ابنًا أو تابع حالة طلبات الربط.','Add a child or track your link requests.')}</p></div>
      <button type="button" className="btn btn-primary compact" onClick={()=>setOpen(true)}><Link2 size={17}/>{t('ربط ابن','Link a child')}</button>
    </div>
    {data.links.map(link=><div className="entity-row" key={link.id}><div><strong>{data.students.find(student=>student.id===link.studentId)?.name||link.claim?.name||t('طلب ربط ابن','Child link request')}</strong>
      {link.createdAt&&<p><time dateTime={link.createdAt}>{new Date(link.createdAt).toLocaleDateString(en?'en-GB':'ar-SA-u-ca-gregory',{timeZone:'Asia/Riyadh'})}</time></p>}</div>
      <div className="chip-row"><Badge status={link.status} label={linkLabel(link.status,t)}/>
        {link.status==='pending'&&<button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void withdraw(link.id)}>{t('سحب الطلب','Withdraw request')}</button>}
      </div>
    </div>)}
    {open&&<Modal title={t('ربط ابن','Link a child')} close={()=>{if(!busy)setOpen(false)}}>
      <form onSubmit={submit}><div className="modal-body">
        <p className="muted">{t('أدخل اسم الابن ورقم جواله كما سجّلا في الحلقة. تُراجع الإدارة الطلب قبل إتاحة بياناته.','Enter the child’s name and mobile number as registered in the circle. Administration reviews the request before granting access.')}</p>
        <ChildIdentityFields phoneField="phone"/>
      </div><div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('إرسال طلب الربط','Send link request')}</button></div></form>
    </Modal>}
  </section>
}

export function ManageFamilyLinks({save,busy}:{save:(action:string,values:Record<string,unknown>)=>Promise<boolean>;busy:boolean}) {
  const {data,t}=useWorkspace()
  const [filter,setFilter]=useState('pending')
  const [query,setQuery]=useState('')
  const [limit,setLimit]=useState(25)
  const [review,setReview]=useState('')
  const request=data.links.find(link=>link.id===review&&link.status==='pending')
  const accounts=new Map(data.users.map(user=>[user.id,user]))
  const students=new Map(data.students.map(student=>[student.id,student]))
  const circles=new Map(data.circles.map(circle=>[circle.id,circle.name]))
  const rows=data.links.filter(link=>(!filter||link.status===filter)
    &&normal([accounts.get(link.parentId)?.name,accounts.get(link.parentId)?.phone,link.claim?.name,link.claim?.phone,students.get(link.studentId)?.name].filter(Boolean).join(' ')).includes(normal(query)))
  async function decide(status:'accepted'|'declined',childId?:FormDataEntryValue|null) {
    if(request&&await save('link-review',{id:request.id,status,childId}))setReview('')
  }
  return <section className="form-stack">
    <div className="admin-filters">
      <label className="search"><Search size={17}/><input type="search" aria-label={t('البحث في طلبات الربط','Search link requests')} placeholder={t('اسم أو رقم الجوال','Name or mobile number')} value={query} onChange={event=>{setQuery(event.target.value);setLimit(25)}}/></label>
      <select aria-label={t('حالة طلب الربط','Link request status')} value={filter} onChange={event=>{setFilter(event.target.value);setLimit(25)}}>
        <option value="">{t('جميع الحالات','All statuses')}</option>
        {(['pending','accepted','declined','cancelled'] as const).map(status=><option key={status} value={status}>{linkLabel(status,t)}</option>)}
      </select>
    </div>
    {rows.slice(0,limit).map(link=>{
      const guardian=accounts.get(link.parentId),child=students.get(link.studentId)
      return <article className="record-tile family-review-row" key={link.id}>
        <div className="chip-row"><Users size={17}/><strong>{guardian?.name??t('حساب سابق','Former account')}</strong><Badge status={link.status} label={linkLabel(link.status,t)}/></div>
        <p>{link.claim?.name??child?.name??t('سجل طالب سابق','Former student record')} {child&&' · '+(circles.get(child.circleId)??'')}</p>
        {link.status==='pending'&&<button type="button" className="btn btn-outline compact" onClick={()=>setReview(link.id)}>{t('مراجعة الربط','Review family link')}</button>}
      </article>
    })}
    {!rows.length&&<Empty title={t('لا توجد طلبات مطابقة','No matching link requests')}/>}
    {rows.length>limit&&<button type="button" className="btn btn-outline" onClick={()=>setLimit(n=>n+25)}>{t('عرض المزيد','Show more')}</button>}
    {request&&<Modal title={t('مراجعة ربط الابن','Review child link')} close={()=>{if(!busy)setReview('')}}>
      <form onSubmit={event=>{event.preventDefault();void decide('accepted',new FormData(event.currentTarget).get('childId'))}}><div className="modal-body">
        <strong>{accounts.get(request.parentId)?.name}</strong>
        {request.claim&&<p>{request.claim.name} · <bdi>{request.claim.phone}</bdi></p>}
        <ChildField value={request.studentId}/>
        <p className="hint-line">{t('تحقّق من علاقة ولي الأمر بالطالب قبل الاعتماد.','Verify the guardian’s relationship before approval.')}</p>
        {accounts.get(request.parentId)?.status!=='active'&&<p className="muted">{t('فعّل حساب ولي الأمر قبل اعتماد الربط.','Activate the guardian account before approving the link.')}</p>}
      </div><div className="modal-foot">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void decide('declined')}>{t('رفض الطلب','Decline request')}</button>
        <button className="btn btn-primary" disabled={busy||accounts.get(request.parentId)?.status!=='active'}>{t('اعتماد الربط','Approve family link')}</button>
      </div></form>
    </Modal>}
  </section>
}
