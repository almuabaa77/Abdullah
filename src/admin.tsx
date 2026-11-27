import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, Bell, BookOpen, CalendarDays, ClipboardList, Ellipsis, Gift, GraduationCap, History, LayoutGrid, Link2, MessageCircle, Plus, Search, Settings, ShieldAlert, ShieldCheck, UserCheck, Users } from 'lucide-react'
import type { Circle, Prize, Student, User } from './domain'
import { DuplicateAccounts } from './duplicate-accounts'
import { AdminLive } from './admin-live'
import type { RecordStreamStatus } from './live-records'
import { normalizeMobile } from './phone-number'
import { Avatar, Badge, dateLabel, Empty, Modal, nameFor, RoleName, useWorkspace } from './ui'
import './admin.css'

type Edit = {kind:'student';item?:Student}|{kind:'circle';item?:Circle}|{kind:'prize';item?:Prize}|{kind:'announcement'}|{kind:'invite'}

const sections = [
  {id:'live',group:'monitor',icon:Activity,label:['المتابعة المباشرة','Live monitoring'],short:['المتابعة','Live']},
  {id:'overview',group:'monitor',icon:LayoutGrid,label:['الإحصاءات العامة','Overview']},
  {id:'audit',group:'monitor',icon:History,label:['سجل العمليات','Audit log']},
  {id:'people',group:'school',icon:Users,label:['الحسابات وطلبات التسجيل','Accounts & enrollment'],short:['الحسابات','Accounts'],add:['إضافة حساب','Add account'],edit:'invite',search:true},
  {id:'students',group:'school',icon:GraduationCap,label:['الطلاب','Students'],short:['الطلاب','Students'],add:['إضافة طالب','Add student'],edit:'student',search:true},
  {id:'circles',group:'school',icon:BookOpen,label:['الحلقات','Circles'],short:['الحلقات','Circles'],add:['إضافة حلقة','Add circle'],edit:'circle',search:true},
  {id:'links',group:'school',icon:Link2,label:['ربط الأبناء','Family links']},
  {id:'duplicates',group:'school',icon:ShieldAlert,label:['الأرقام المكررة','Duplicate numbers']},
  {id:'store',group:'services',icon:Gift,label:['المتجر والطلبات','Store & orders'],add:['إضافة جائزة','Add reward'],edit:'prize',search:true},
  {id:'announcements',group:'services',icon:Bell,label:['الإعلانات','Announcements'],add:['إعلان جديد','New announcement'],edit:'announcement'},
  {id:'settings',group:'services',icon:Settings,label:['النقاط وصلاحيات التواصل','Points & communication']},
] as const

type Tab = typeof sections[number]['id']
type Section = {
  id:Tab; group:'monitor'|'school'|'services'; icon:typeof Activity
  label:readonly [string,string]; short?:readonly [string,string]; add?:readonly [string,string]; edit?:Edit['kind']; search?:boolean
}
const groups = [
  ['monitor','السجلات والمتابعة','Monitoring'],
  ['school','الحلقات والحسابات','Circles & accounts'],
  ['services','الخدمات والإعدادات','Services & settings'],
] as const
const mobileSections = sections.filter(section=>'short' in section)
const rosterPage = 25

function readTab():Tab {
  const value=new URLSearchParams(location.search).get('section')
  return sections.find(section=>section.id===value)?.id ?? 'live'
}

function AdminList<T>({items,render,empty,filtered=false}:{items:T[];render:(item:T,index:number)=>ReactNode;empty:string;filtered?:boolean}) {
  const {t} = useWorkspace()
  const [limit,setLimit] = useState(rosterPage)
  if(!items.length)return <Empty title={filtered?t('لا توجد نتائج مطابقة','No matching results'):empty}/>
  return <div className="admin-list">
    {items.slice(0,limit).map(render)}
    {limit<items.length&&<button type="button" className="btn btn-outline" onClick={()=>setLimit(n=>n+rosterPage)}>
      {t('عرض المزيد','Show more')} <span className="count-pill">{Math.min(items.length,limit)} / {items.length}</span>
    </button>}
  </div>
}

export function Admin({liveRecords,online}:{liveRecords:RecordStreamStatus;online:boolean}) {
  const {data,t,en,go,post,tell} = useWorkspace()
  const [tab,setTab] = useState(readTab)
  const [edit,setEdit] = useState<Edit>()
  const [query,setQuery] = useState('')
  const [accountFilter,setAccountFilter] = useState('')
  const [busy,setBusy] = useState(false)
  const [menu,setMenu] = useState(false)
  const writing = useRef(false)
  useEffect(()=>{
    const restore=()=>{setTab(readTab());setQuery('');setAccountFilter('');setMenu(false);setEdit(undefined)}
    window.addEventListener('popstate',restore)
    return ()=>window.removeEventListener('popstate',restore)
  },[])
  if(data.user?.role!=='admin'||data.user.status!=='active') return <div className="panel"><Empty title={t('لا تتوفر صلاحية الإدارة','Administration access required')}/></div>

  function openTab(id:Tab) {
    if(id!==tab) {
      const url=new URL(location.href)
      if(id==='live')url.searchParams.delete('section')
      else url.searchParams.set('section',id)
      history.pushState(null,'',url)
      setTab(id)
      setQuery('')
      setAccountFilter('')
      window.scrollTo({top:0,behavior:'instant'})
    }
    setMenu(false)
  }
  async function submit(action:string,payload:Record<string,unknown>) {
    if(writing.current)return false
    writing.current=true
    setBusy(true)
    try {
      await post(action,payload)
      tell(t('تم تحديث البيانات','Changes saved'))
      return true
    } catch(error) {
      tell((error as Error).message,true)
      return false
    } finally {
      writing.current=false
      setBusy(false)
    }
  }
  async function form(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(!edit)return
    const fields=new FormData(event.currentTarget)
    const values=Object.fromEntries(fields) as Record<string,unknown>
    if('item' in edit&&edit.item)values.id=edit.item.id
    if(edit.kind==='circle') {
      values.days=fields.getAll('days')
      values.holidays=String(values.holidays||'').split(/[\s,،]+/).filter(Boolean)
    }
    if(edit.kind==='student'||edit.kind==='prize')values.active=fields.has('active')
    if(await submit(edit.kind,values))setEdit(undefined)
  }

  const current:Section=sections.find(section=>section.id===tab) ?? sections[0]
  const search=query.trim().toLowerCase()
  const includes = (...fields:(string|undefined)[])=>fields.some(field=>field?.toLowerCase().includes(search))
  const phone=normalizeMobile(query)
  const userNames=new Map(data.users.map(user=>[user.id,user.name]))
  const circleNames=new Map(data.circles.map(circle=>[circle.id,circle.name]))
  const studentNames=new Map(data.students.map(student=>[student.id,nameFor(student,en)]))
  const circleSizes=new Map<string,number>()
  for(const student of data.students)circleSizes.set(student.circleId,(circleSizes.get(student.circleId)??0)+1)
  const pendingCount=data.users.filter(user=>user.status==='pending').length
  const pendingLinks=data.links.filter(link=>link.status==='pending').length
  const activeBadge=(account:User)=>account.duplicateOf?t('بانتظار تأكيد الإنهاء','Awaiting closure confirmation'):account.status==='pending'?t('بانتظار الاعتماد','Pending approval'):undefined
  const searchTitle=t('بحث في هذا القسم','Search this section')
  const primaryActive=mobileSections.some(section=>section.id===tab)

  function sectionLinks() {
    return groups.map(([id,ar,english])=><div className="admin-menu-group" key={id}>
      <span>{t(ar,english)}</span>
      {sections.filter(section=>section.group===id).map(({id,icon:Icon,label})=><button key={id} type="button"
        aria-current={tab===id?'page':undefined} onClick={()=>openTab(id)}>
        <Icon size={18}/><span>{t(label[0],label[1])}</span>
        {id==='people'&&pendingCount>0&&<small className="count-pill" aria-label={t('طلبات تسجيل معلّقة','Pending registrations')}>{pendingCount}</small>}
      </button>)}
    </div>)
  }

  return <div className="page-stack admin-workspace">
    <section className="panel admin-hero">
      <div className="admin-identity"><span className="stat-icon tint-green"><ShieldCheck size={23}/></span><h1>{t('لوحة الإدارة','Administration')}</h1></div>
      <span className="admin-date"><CalendarDays size={17}/>{dateLabel(data.date,en,true)}</span>
    </section>
    <div className="admin-grid">
      <nav className="panel admin-nav" aria-label={t('أقسام الإدارة','Administration sections')}>{sectionLinks()}</nav>
      <section className="panel section-panel admin-main" aria-busy={busy}>
        <header className="admin-section-head">
          <h2>{t(...current.label)}</h2>
          {current.edit&&current.add&&<button className="btn btn-primary compact" type="button" disabled={busy} onClick={()=>setEdit({kind:current.edit!})}>
            <Plus size={16}/>{t(...current.add)}
          </button>}
        </header>
        {(current.search||tab==='audit')&&<div className="admin-filters">
          <label className="search"><Search size={17}/><input type="search" aria-label={searchTitle} placeholder={searchTitle} value={query} onChange={event=>setQuery(event.target.value)}/></label>
          {tab==='people'&&<select aria-label={t('حالة الحساب','Account status')} value={accountFilter} onChange={event=>setAccountFilter(event.target.value)}>
            <option value="">{t('كل الحالات','All statuses')}</option><option value="pending">{t('بانتظار الاعتماد','Pending approval')}</option>
            <option value="active">{t('نشطة','Active')}</option><option value="disabled">{t('موقوفة','Suspended')}</option>
          </select>}
        </div>}
        {tab==='overview'&&<>
          <div className="summary-grid admin-metrics">
            {([
              ['circles',BookOpen,data.circles.length,t('الحلقات','Circles')],
              ['students',GraduationCap,data.students.length,t('الطلاب','Students')],
              ['people',Users,pendingCount,t('طلبات التسجيل','Registration requests')],
              ['links',Link2,pendingLinks,t('طلبات الربط','Family link requests')],
              ['records',ClipboardList,data.daily.length,t('سجلات التسميع','Recitation records')],
            ] as const).map(([id,Icon,count,label])=><button type="button" className="record-tile admin-metric" key={id} onClick={()=>{
              if(id==='records'){go(id);return}
              openTab(id)
              if(id==='people')setAccountFilter('pending')
            }}>
              <span className="stat-icon tint-green"><Icon size={18}/></span><strong className="big-number">{count}</strong><span>{label}</span>
            </button>)}
          </div>
          <div className="more-list">{([
            [ClipboardList,'records',t('الحفظ والمراجعة والحضور والتقارير','Recitation, attendance and reports')],
            [CalendarDays,'exams',t('إدارة الاختبارات','Manage assessments')],
            [UserCheck,'leaves',t('إدارة الاستئذانات','Manage leave')],
            [MessageCircle,'chat',t('الإشراف على المحادثات','Oversee conversations')],
          ] as const).map(([Icon,page,label])=><button className="more-row" type="button" key={page} onClick={()=>go(page)}>
            <span className="stat-icon tint-green"><Icon size={17}/></span><strong>{label}</strong>
          </button>)}</div>
        </>}
        {tab==='live'&&<AdminLive status={liveRecords} online={online}/>}
        {tab==='duplicates'&&<DuplicateAccounts/>}
        {tab==='people'&&<AdminList key={query+':'+accountFilter} empty={t('لا توجد حسابات','No accounts')} filtered={Boolean(search||accountFilter)}
          items={data.users.filter(user=>(!accountFilter||user.status===accountFilter)
            &&(includes(user.name,user.phone)||!!phone&&normalizeMobile(user.phone??'')===phone))}
          render={user=><div className="entity-row" key={user.id}>
            <div><strong>{user.name}</strong><p><RoleName role={user.role}/> {user.phone&&<bdi> · {user.phone}</bdi>}</p></div>
            <div className="chip-row"><Badge status={user.duplicateOf?'disabled':user.status} label={activeBadge(user)}/>
              {user.id!==data.user?.id&&!user.duplicateOf&&<button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void submit('account',{id:user.id,status:user.status==='active'?'disabled':'active'})}>
                {user.status==='active'?t('إيقاف','Suspend'):t('تفعيل','Activate')}
              </button>}
            </div>
          </div>}/>}
        {tab==='students'&&<AdminList key={query} empty={t('لا يوجد طلاب','No students')} filtered={Boolean(search)}
          items={data.students.filter(student=>includes(student.name,student.latin,student.phone)||!!phone&&normalizeMobile(student.phone??'')===phone)}
          render={student=><div className="entity-row" key={student.id}>
            <div className="name-line"><Avatar student={student}/><div><strong>{studentNames.get(student.id)}</strong><p>{circleNames.get(student.circleId)}</p></div></div>
            <div className="chip-row"><Badge status={student.active?'active':'disabled'}/><button className="btn btn-outline compact" type="button" onClick={()=>setEdit({kind:'student',item:student})}>{t('تعديل','Edit')}</button></div>
          </div>}/>}
        {tab==='circles'&&<AdminList key={query} empty={t('لا توجد حلقات','No circles')} filtered={Boolean(search)}
          items={data.circles.filter(circle=>includes(circle.name,userNames.get(circle.teacherId)))}
          render={circle=><div className="entity-row" key={circle.id}>
            <div><strong>{circle.name}</strong><p>{userNames.get(circle.teacherId)} · {circleSizes.get(circle.id)??0} {t('طالب','students')}</p></div>
            <button className="btn btn-outline compact" type="button" onClick={()=>setEdit({kind:'circle',item:circle})}>{t('تعديل','Edit')}</button>
          </div>}/>}
        {tab==='links'&&<AdminList empty={t('لا توجد طلبات ربط','No family link requests')} items={data.links}
          render={link=><div className="entity-row" key={link.id}>
            <div><strong>{userNames.get(link.parentId)}</strong><p>{studentNames.get(link.studentId)}</p></div>
            <div className="chip-row"><Badge status={link.status} label={link.status==='pending'?t('قيد المراجعة','Under review'):undefined}/>
              {link.status==='pending'&&<>
                <button className="btn btn-subtle compact" type="button" disabled={busy} onClick={()=>void submit('link-review',{id:link.id,status:'accepted'})}>{t('اعتماد','Approve')}</button>
                <button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void submit('link-review',{id:link.id,status:'declined'})}>{t('رفض','Decline')}</button>
              </>}
            </div>
          </div>}/>}
        {tab==='store'&&<>
          <AdminList key={'prizes:'+query} empty={t('لا توجد جوائز','No rewards')} filtered={Boolean(search)}
            items={data.prizes.filter(prize=>includes(prize.name))}
            render={prize=><div className="entity-row" key={prize.id}><div><strong>{prize.name}</strong><p>{prize.price} {t('نقطة','points')} · {prize.stock} {t('متوفر','in stock')}</p></div>
              <button className="btn btn-outline compact" type="button" onClick={()=>setEdit({kind:'prize',item:prize})}>{t('تعديل','Edit')}</button>
            </div>}/>
          <h3 className="admin-list-heading">{t('طلبات الاستبدال','Redemption orders')}</h3>
          <AdminList key={'orders:'+query} empty={t('لا توجد طلبات','No orders')} filtered={Boolean(search)}
            items={data.orders.filter(order=>includes(order.name,studentNames.get(order.studentId)))}
            render={order=><div className="entity-row" key={order.id}>
              <div><strong>{order.name}</strong><p>{studentNames.get(order.studentId)} · {order.price} {t('نقطة','points')}</p></div>
              <div className="chip-row"><Badge status={order.status} label={order.status==='pending'?t('قيد المراجعة','Under review'):undefined}/>
                {order.status!=='delivered'&&order.status!=='cancelled'&&<>
                  <button className="btn btn-subtle compact" type="button" disabled={busy} onClick={()=>void submit('order',{id:order.id,status:order.status==='pending'?'approved':order.status==='approved'?'ready':'delivered'})}>
                    {order.status==='pending'?t('اعتماد','Approve'):order.status==='approved'?t('جاهز للاستلام','Mark ready'):t('تم التسليم','Mark delivered')}
                  </button>
                  <button className="btn btn-outline compact" type="button" disabled={busy} onClick={()=>void submit('order',{id:order.id,status:'cancelled'})}>{t('إلغاء','Cancel')}</button>
                </>}
              </div>
            </div>}/>
        </>}
        {tab==='announcements'&&<AdminList empty={t('لا توجد إعلانات منشورة','No announcements published')}
          items={data.notices.filter(notice=>notice.kind==='announcement')}
          render={notice=><div className="entity-row" key={notice.id}><div><strong>{notice.title}</strong><p>{notice.body}</p></div></div>}/>}
        {tab==='settings'&&<form className="form-stack" onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);void submit('rules',{...Object.fromEntries(fields),chat:fields.has('chat')})}}>
          <div className="summary-grid">{([
            ['memorization',t('إتمام الحفظ','Memorization')],['review',t('إتمام المراجعة','Revision')],['attendance',t('الحضور','Attendance')],
          ] as const).map(([key,label])=><label key={key}>{label}<input name={key} type="number" min={0} max={100} required defaultValue={data.rules[key]}/></label>)}</div>
          <label className="check-line"><input name="chat" type="checkbox" defaultChecked={data.rules.chat}/>{t('السماح بالمحادثات بين الحسابات','Allow account messaging')}</label>
          <div><button className="btn btn-primary" disabled={busy}>{t('حفظ الإعدادات','Save settings')}</button></div>
        </form>}
        {tab==='audit'&&<AdminList key={query} empty={t('لا توجد عمليات مسجلة','No audit entries')} filtered={Boolean(search)}
          items={data.audit.filter(entry=>includes(entry.actor,entry.action))}
          render={(entry,index)=><div className="entity-row" key={entry.time+':'+index}>
            <div><strong>{entry.action}</strong><p>{entry.actor} · <time dateTime={entry.time}>{new Date(entry.time).toLocaleString(en?'en-GB':'ar-SA',{timeZone:'Asia/Riyadh'})}</time></p></div>
            {entry.before!==undefined&&<span dir="ltr">{entry.before} → {entry.after}</span>}
          </div>}/>}
      </section>
    </div>
    <nav className="admin-bottom-nav" aria-label={t('قائمة الإدارة السفلية','Administration bottom navigation')}>
      {mobileSections.map(({id,icon:Icon,label,short})=><button type="button" key={id} aria-current={tab===id?'page':undefined}
        aria-label={t(label[0],label[1])} onClick={()=>openTab(id)}><Icon size={21}/><span>{t(short[0],short[1])}</span></button>)}
      <button type="button" aria-haspopup="dialog" aria-expanded={menu} aria-current={primaryActive?undefined:'page'} onClick={()=>setMenu(true)}>
        <Ellipsis size={21}/><span>{t('المزيد','More')}</span>
      </button>
    </nav>
    {menu&&<Modal title={t('أقسام الإدارة','Administration sections')} close={()=>setMenu(false)} appearance="admin-more-dialog">
      <nav className="modal-body admin-more-links">{sectionLinks()}</nav>
    </Modal>}
    {edit&&<Modal title={({student:t('بيانات الطالب','Student details'),circle:t('بيانات الحلقة','Circle details'),prize:t('بيانات الجائزة','Reward details'),announcement:t('إعلان جديد','New announcement'),invite:t('إضافة حساب','Add account')})[edit.kind]} close={()=>{if(!busy)setEdit(undefined)}}>
      <form onSubmit={form}><div className="modal-body">
        {edit.kind==='student'&&<><label>{t('اسم الطالب','Student name')}<input name="name" required defaultValue={edit.item?.name}/></label><label>{t('الاسم بالإنجليزية','Name in English')}<input name="latin" defaultValue={edit.item?.latin}/></label><label>{t('الجوال','Mobile')}<input name="phone" type="tel" dir="ltr" defaultValue={edit.item?.phone} placeholder="+9665XXXXXXXX"/></label><label>{t('الحلقة','Circle')}<select name="circleId" required defaultValue={edit.item?.circleId}><option value="">{t('اختر حلقة','Select circle')}</option>{data.circles.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="check-line"><input type="checkbox" name="active" defaultChecked={edit.item?.active??true}/>{t('طالب نشط','Active student')}</label></>}
        {edit.kind==='circle'&&<><label>{t('اسم الحلقة','Circle name')}<input name="name" required defaultValue={edit.item?.name}/></label><label>{t('المحفّظ','Teacher')}<select name="teacherId" defaultValue={edit.item?.teacherId} required>{data.users.filter(u=>(u.role==='teacher'||u.role==='admin')&&u.status==='active').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><fieldset className="day-select"><legend>{t('أيام الحلقة','Circle days')}</legend>{(en?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']).map((day,i)=><label key={day} className="check-line"><input name="days" type="checkbox" value={i} defaultChecked={edit.item?.days.includes(i)??i<5}/>{day}</label>)}</fieldset><label>{t('تواريخ الإجازات (YYYY-MM-DD)','Holidays (YYYY-MM-DD)')}<textarea name="holidays" defaultValue={edit.item?.holidays.join('\n')}/></label></>}
        {edit.kind==='prize'&&<><label>{t('اسم الجائزة','Reward name')}<input name="name" defaultValue={edit.item?.name} required/></label><label>{t('الوصف','Description')}<textarea name="description" defaultValue={edit.item?.description} required/></label><label>{t('رابط الصورة','Image URL')}<input name="image" type="url" defaultValue={edit.item?.image}/></label><div className="field-pair"><label>{t('السعر بالنقاط','Points price')}<input name="price" type="number" min={1} defaultValue={edit.item?.price} required/></label><label>{t('الكمية','Stock')}<input name="stock" type="number" min={0} defaultValue={edit.item?.stock} required/></label></div><label className="check-line"><input name="active" type="checkbox" defaultChecked={edit.item?.active??true}/>{t('متاح للطلاب','Visible to students')}</label></>}
        {edit.kind==='announcement'&&<><label>{t('عنوان الإعلان','Announcement title')}<input name="title" required maxLength={160}/></label><label>{t('نص الإعلان','Announcement text')}<textarea name="body" required maxLength={600}/></label></>}
        {edit.kind==='invite'&&<><p className="muted">{t('يُفعّل الحساب عند أول تحقق من رقم الجوال المُعتمد.','The account activates on first verification of its approved mobile number.')}</p><label>{t('الاسم','Name')}<input name="name" required/></label><label>{t('رقم الجوال','Mobile number')}<input name="phone" type="tel" dir="ltr" required placeholder="+9665XXXXXXXX"/></label><label>{t('نوع الحساب','Account role')}<select name="role"><option value="teacher">{t('محفّظ','Teacher')}</option><option value="student">{t('طالب','Student')}</option><option value="parent">{t('ولي أمر','Guardian')}</option></select></label></>}
      </div><div className="modal-foot"><button className="btn btn-outline" type="button" disabled={busy} onClick={()=>setEdit(undefined)}>{t('إلغاء','Cancel')}</button><button className="btn btn-primary" disabled={busy}>{edit.kind==='announcement'?t('نشر الإعلان','Publish announcement'):t('حفظ','Save')}</button></div></form>
    </Modal>}
  </div>
}
