import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarDays, Check, Flag, MailPlus, LockKeyhole, MessageCircle, Phone, Pin, Plus, Reply, Search, Send, Settings, Users, Video, X } from 'lucide-react'
import { callPeer, defaultCommunication, idFor, type Chat, type ChatContact, type Role } from './domain'
import { Empty, Modal, normal, RoleName, useWorkspace } from './ui'
import { useCallClock } from './lesson-call'
import { lessonClosed, lessonInAgenda } from './lessons'

import { ChatCallList, useChatCalls } from './chat-calls'

type ChatTab = 'messages'|'calls'|'contacts'|'groups'|'settings'
type Draft = { text:string; reply:string; op?:string }
const emptyDraft:Draft = {text:'',reply:''}
const contactRoles:Record<Role,[string,string]> = {
  teacher:['المحفّظ','Teacher'],student:['الطالب','Student'],parent:['ولي الأمر','Guardian'],admin:['الإدارة','Administration'],
}

export function ChatPage({showPermissions,management=false}:{showPermissions?:()=>void;management?:boolean}={}) {
  const {data,t,en,post,tell,go} = useWorkspace()
  const user = data.user?.id ?? ''
  const previewKey='halaqat-chat-preview:'+user
  const [previews,setPreviews]=useState(()=>localStorage.getItem(previewKey)!=='off')
  const [tab,setTab]=useState<ChatTab>(()=>!management&&(data.chatInvitations?.length||sessionStorage.getItem('halaqat-group-invitations'))?'groups':'messages')
  const [contactQuery,setContactQuery]=useState('')
  const [contactLimit,setContactLimit]=useState(24)
  const calling=useChatCalls()
  const [selected,setSelected] = useState('')
  const [drafts,setDrafts] = useState<Record<string,Draft>>({})
  const [threadQuery,setThreadQuery] = useState('')
  const [query,setQuery] = useState('')
  const [searching,setSearching] = useState(false)
  const [sending,setSending] = useState(false)
  const [choose,setChoose] = useState(false)
  const [opening,setOpening] = useState(false)
  const [target,setTarget] = useState('')
  const [groupEditor,setGroupEditor] = useState<{chat?:Chat}>()
  const groupAction=useRef(false)
  const [groupBusy,setGroupBusy]=useState(false)
  const list = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true)
  const accounts = new Map(data.users.map(account=>[account.id,account]))
  const title = (chat:Chat) => {
    if(data.sample&&en&&chat.id==='chat-1')return 'Imam Asim Circle Group'
    const names=chat.members.map(id=>accounts.get(id)?.name)
    if(!chat.circleId&&names.includes(chat.title))return accounts.get(chat.members.find(id=>id!==user)??'')?.name??chat.title
    return chat.title
  }
  const chats = data.chats.filter(item=>!management||!item.circleId&&item.members.includes(user)).sort((a,b)=>Number(b.pinnedBy.includes(user))-Number(a.pinnedBy.includes(user)) || (b.messages.at(-1)?.time ?? '').localeCompare(a.messages.at(-1)?.time ?? ''))
  const chat = chats.find(item=>item.id===selected)
  const callClock=useCallClock(1000,Boolean(chat))
  const appointments=chat?(data.lessons??[]).filter(lesson=>lessonInAgenda(lesson,callClock)).filter(lesson=>lesson.chatId===chat.id||!lesson.chatId&&lesson.kind==='circle'&&lesson.circleId===chat.circleId).slice(0,4):[]
  const unread = (item:Chat) => item.messages.filter(message=>message.from!==user&&!message.readBy.includes(user)).length
  const unreadCount = chat ? unread(chat) : 0
  const visible = chats.filter(item=>normal(title(item)).includes(normal(threadQuery)))
  const messages = chat?.messages.filter(message=>normal(message.text).includes(normal(query))) ?? []
  const draft = (chat && drafts[chat.id]) || emptyDraft
  const byMessage = new Map(chat?.messages.map(message=>[message.id,message]))
  const allContacts=(data.chatContacts??[]).slice().sort((a,b)=>a.name.localeCompare(b.name,en?'en':'ar'))
  const contacts=allContacts.filter(account=>normal(account.name+' '+account.circleNames.join(' ')).includes(normal(contactQuery)))
  const invites=data.chatInvitations??[]
  const groups=chats.filter(item=>Boolean(item.circleId))
  const contact=chat&&accounts.get(callPeer(chat,user)??'')
  const communication={...defaultCommunication,...data.rules.communication}
  const canUseContacts=data.rules.chat&&allContacts.length>0
  const canCreateGroup=!management&&data.user?.role==='teacher'&&data.rules.chat&&communication.circleChat&&data.circles.length>0
  const canCall=Boolean(!management&&contact?.status==='active'&&contact.role!=='admin'&&data.rules.chat&&calling.supported&&(communication.audio||communication.video))
  const otherMember=chat&&!chat.circleId?accounts.get(chat.members.find(id=>id!==user)??''):undefined
  const tabs = [
    ['messages',MessageCircle,t('المحادثات','Chats')],
    ['calls',Phone,t('المكالمات','Calls')],
    ['contacts',Users,t('جهات الاتصال','Contacts')],
    ['groups',Users,t('المجموعات','Groups')],
    ['settings',Settings,t('الإعدادات','Settings')],
  ] as const
  const clock = new Intl.DateTimeFormat(en?'en-GB':'ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})
  const canSend = chat && data.rules.chat && !chat.locked && !chat.blocked && !chat.blockedBy.length
    && (!management||allContacts.some(account=>chat.members.includes(account.id)))
  const openThread = (id:string) => {follow.current=true;setSelected(id);setQuery('');setSearching(false)}

  useEffect(()=>{
    if(management)return
    sessionStorage.removeItem('halaqat-group-invitations')
    const showInvites=()=>{sessionStorage.removeItem('halaqat-group-invitations');setTab('groups')}
    window.addEventListener('halaqat-group-invitations',showInvites)
    return ()=>window.removeEventListener('halaqat-group-invitations',showInvites)
  },[management])
  useEffect(()=>{
    if(!chat || !unreadCount || tab!=='messages')return
    const mark=()=>{if(!document.hidden)void post('chat-read',{id:chat.id}).catch(()=>{})}
    mark()
    document.addEventListener('visibilitychange',mark)
    return ()=>document.removeEventListener('visibilitychange',mark)
  },[chat?.id,unreadCount,tab])
  useLayoutEffect(()=>{
    if(follow.current&&!query&&list.current)list.current.scrollTop=list.current.scrollHeight
  },[chat?.id,messages.length,query,tab])

  const act = async (action:string,payload:Record<string,unknown>) => {
    try{return await post(action,payload)}catch(error){tell((error as Error).message,true);return null}
  }
  const updateDraft = (change:Partial<Draft>) => {
    if(chat)setDrafts(current=>({...current,[chat.id]:{...(current[chat.id] ?? emptyDraft),...change,op:undefined}}))
  }
  async function send(event:FormEvent) {
    event.preventDefault()
    if(!canSend||!chat||sending||!draft.text.trim())return
    const op=draft.op ?? idFor()
    setSending(true)
    setDrafts(current=>({...current,[chat.id]:{...draft,op}}))
    try {
      follow.current=true
      await post('message',{id:chat.id,text:draft.text,reply:draft.reply},op)
      setDrafts(current=>current[chat.id]?.op===op?{...current,[chat.id]:emptyDraft}:current)
    } catch(error) {tell((error as Error).message,true)}
    finally {setSending(false)}
  }
  async function openConversation(event:FormEvent) {
    event.preventDefault()
    await locateContact(target)
  }
  async function locateContact(targetId:string) {
    if(!targetId||opening||!canUseContacts)return
    setOpening(true)
    try {
      const result=await post('chat-open',{targetId})
      const match=result.chats.find(item=>!item.circleId&&item.members.length===2&&item.members.includes(user)&&item.members.includes(targetId))
      if(match){openThread(match.id);setTab('messages')}
      setChoose(false)
    } catch(error) {tell((error as Error).message,true)} finally {setOpening(false)}
  }
  async function manageGroup(action:string,payload:Record<string,unknown>,openId?:string) {
    if(groupAction.current)return
    groupAction.current=true
    setGroupBusy(true)
    try {
      const op=idFor()
      const result=await post(action,payload,op)
      const id=action==='group-create'?op:openId
      if(id&&result.chats.some(chat=>chat.id===id)){openThread(id);setTab('messages')}
      if(action==='group-leave'){openThread('');setTab('groups')}
      if(action==='group-create'||action==='group-settings')setGroupEditor(undefined)
      if(action==='group-invite')tell(t('أُرسلت الدعوات للأعضاء الجدد المؤهلين','Invitations sent to new eligible members'))
    } catch(error){tell((error as Error).message,true)}
    finally{groupAction.current=false;setGroupBusy(false)}
  }
  function saveGroup(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values=Object.fromEntries(new FormData(event.currentTarget))
    void manageGroup(groupEditor?.chat?'group-settings':'group-create',{...values,id:groupEditor?.chat?.id})
  }
  const contactDetails=(peer:ChatContact)=> <>
    <RoleName role={peer.role}/>{peer.circleNames.length>0&&' · '+peer.circleNames.join('، ')}
  </>

  return <div className={management?"messenger-workspace admin-inbox":"messenger-workspace"}>
    {tab==='calls'&&<>
      <div className="lesson-call-launch"><button className="btn btn-outline compact" type="button" onClick={()=>go('lessons')}><CalendarDays size={18}/>{t('جلسات التسميع والتقويم','Live sessions and calendar')}</button></div>
      <ChatCallList {...calling} openChats={()=>setTab('messages')}/>
    </>}
    {tab==='contacts'&&<section className="messenger-tab-content">
      <h2>{t('جهات اتصال الحلقة','Circle contacts')}</h2>
      <label className="search"><Search size={17}/><input type="search" aria-label={t('البحث في جهات الاتصال','Search contacts')}
        placeholder={t('ابحث بالاسم أو الحلقة','Search by name or circle')} value={contactQuery} onChange={event=>{setContactQuery(event.target.value);setContactLimit(24)}}/></label>
      {contacts.slice(0,contactLimit).map(peer=><div className="messenger-contact" key={peer.id}>
        <span className="chat-role-icon" data-role={peer.role}><Users size={18}/></span><div><strong>{peer.name}</strong><p>{contactDetails(peer)}</p></div>
        <button className="btn btn-outline compact" type="button" disabled={opening||!canUseContacts} onClick={()=>void locateContact(peer.id)}>
          <MessageCircle size={16}/>{t('محادثة','Chat')}
        </button>
      </div>)}
      {!contacts.length&&<Empty title={t('لا توجد جهات اتصال مطابقة','No matching contacts')}/>}
      {contacts.length>contactLimit&&<button className="btn btn-outline compact" type="button" onClick={()=>setContactLimit(contactLimit+24)}>{t('عرض المزيد','Show more')}</button>}
    </section>}
    {tab==='groups'&&<section className="messenger-tab-content">
      <header className="section-title"><h2>{t('مجموعات الحلقات','Circle groups')}</h2>{canCreateGroup&&
        <button className="btn btn-primary compact" type="button" onClick={()=>setGroupEditor({})}><Plus size={17}/>{t('إنشاء مجموعة','Create group')}</button>}</header>
      {invites.map(invitation=><article className="record-tile chat-invitation" key={invitation.id}>
        <span className="hint-line"><MailPlus size={17}/>{t('دعوة إلى مجموعة','Group invitation')}</span>
        <strong>{invitation.title}</strong><small>{invitation.circleName} · {invitation.posting==='staff'?t('الإرسال للمحفّظ فقط','Teacher posts only'):t('الإرسال للأعضاء','Members can post')}</small>
        <div className="chip-row">
          <button className="btn btn-primary compact" type="button" disabled={groupBusy} onClick={()=>void manageGroup('group-respond',{id:invitation.id,status:'accepted'},invitation.id)}>{t('قبول الدعوة','Accept invitation')}</button>
          <button className="btn btn-outline compact" type="button" disabled={groupBusy} onClick={()=>void manageGroup('group-respond',{id:invitation.id,status:'declined'})}>{t('رفض الدعوة','Decline invitation')}</button>
        </div>
      </article>)}
      {groups.map(group=><div className="messenger-contact" key={group.id}>
        <span className="stat-icon tint-green"><Users size={18}/></span><div><strong>{title(group)}</strong><p>{data.circles.find(circle=>circle.id===group.circleId)?.name}</p></div>
        <button className="btn btn-outline compact" type="button" onClick={()=>{openThread(group.id);setTab('messages')}}>{t('فتح المجموعة','Open group')}</button>
      </div>)}
      {!groups.length&&!invites.length&&<Empty title={t('لا توجد مجموعات أو دعوات','No groups or invitations')}/>}
    </section>}
    {tab==='settings'&&<section className="messenger-tab-content">
      <h2>{t('إعدادات الدردشة','Chat settings')}</h2>
      <div className="messenger-contact"><span className="stat-icon tint-green"><MessageCircle size={19}/></span>
        <label className="check-line"><input type="checkbox" checked={previews} onChange={event=>{
          setPreviews(event.target.checked)
          localStorage.setItem(previewKey,event.target.checked?'on':'off')
        }}/>{t('معاينة آخر رسالة في القائمة','Preview the last message in the list')}</label>
      </div>
      {showPermissions&&<button type="button" className="btn btn-outline" onClick={showPermissions}><Settings size={17}/>{t('تنبيهات وأذونات الجهاز','Device alerts and permissions')}</button>}
      {!data.rules.chat&&<p className="hint-line">{t('التواصل موقوف من الإدارة.','Messaging is paused by administration.')}</p>}
    </section>}
    {tab==='messages'&&<section className="messenger"  data-thread={chat?'open':'closed'} aria-label={t('المحادثات','Conversations')}>
    <aside className="messenger-directory">
      <header><div><h1>{t('المحادثات','Conversations')}</h1><p>{t('رسائل الحلقات','Circle messages')}</p></div><button className="btn btn-primary icon-button" type="button" disabled={!canUseContacts} aria-label={t('محادثة جديدة','New conversation')} onClick={()=>setChoose(true)}><Plus size={21}/></button></header>
      <label className="search"><Search size={17}/><input type="search" value={threadQuery} onChange={event=>setThreadQuery(event.target.value)} placeholder={t('ابحث عن محادثة','Find a conversation')} aria-label={t('ابحث عن محادثة','Find a conversation')}/></label>
      <div className="messenger-threads">{visible.map(item=>{
        const count=unread(item)
        return <button className={'thread-button '+(chat?.id===item.id?'selected':'')} type="button" aria-current={chat?.id===item.id?'true':undefined} key={item.id} onClick={()=>openThread(item.id)}>
          <span className="stat-icon tint-green"><MessageCircle size={20}/></span><span><strong>{title(item)}</strong><small>{previews&&item.messages.at(-1)?.text || (item.messages.length?t('محادثة','Conversation'):t('محادثة جديدة','New conversation'))}</small></span>
          {count>0?<span className="messenger-unread">{count}</span>:item.pinnedBy.includes(user)&&<Pin size={15}/>}
        </button>
      })}{!visible.length&&<Empty title={threadQuery?t('لا توجد نتائج مطابقة','No matching conversations'):t('لا توجد محادثات بعد','No conversations yet')}/>}</div>
    </aside>
    <div className="messenger-thread">{chat ? <>
      <header className="messenger-thread-head">
        <button type="button" className="icon-button messenger-back" aria-label={t('العودة إلى المحادثات','Back to conversations')} onClick={()=>openThread('')}><ArrowLeft size={21}/></button>
        <span className="stat-icon tint-green"><MessageCircle size={20}/></span>
        <div><h2>{title(chat)}</h2><p>{chat.circleId?t('مجموعة الحلقة','Circle group'):otherMember?<RoleName role={otherMember.role}/>:t('محادثة فردية','Direct conversation')}</p></div>
        {!management&&data.user?.role==='teacher'&&data.lessonTeacherScheduling&&<button type="button" className="icon-button" aria-label={t('جدولة جلسة','Schedule a session')} onClick={()=>{
          sessionStorage.setItem('halaqat-plan-lesson',JSON.stringify({chatId:chat.id,circleId:chat.circleId,studentId:chat.students[0]}))
          go('lessons')
        }}><CalendarDays size={17}/></button>}
        {canCall&&<span className="messenger-call-actions">
          <button type="button" className="icon-button" disabled={calling.busy||!communication.audio} aria-label={t('مكالمة صوتية','Voice call')} onClick={()=>calling.start(chat,'audio')}><Phone size={18}/></button>
          <button type="button" className="icon-button" disabled={calling.busy||!communication.video} aria-label={t('مكالمة مرئية','Video call')} onClick={()=>calling.start(chat,'video')}><Video size={18}/></button>
        </span>}
        <button type="button" className="icon-button" aria-pressed={searching} aria-label={t('بحث داخل المحادثة','Search conversation')} onClick={()=>{setSearching(!searching);setQuery('')}}><Search size={19}/></button>
        <details className="messenger-menu"><summary className="icon-button" aria-label={t('خيارات المحادثة','Conversation options')}>⋯</summary><div>
          {chat.group&&canCreateGroup&&<>
            <button type="button" onClick={()=>setGroupEditor({chat})}><Settings size={16}/>{t('إعدادات المجموعة','Group settings')}</button>
            <button type="button" disabled={groupBusy} onClick={()=>void manageGroup('group-invite',{id:chat.id})}><MailPlus size={16}/>{t('دعوة الأعضاء الجدد','Invite new members')}</button>
          </>}
          {chat.group&&!canCreateGroup&&<button type="button" disabled={groupBusy} onClick={()=>void manageGroup('group-leave',{id:chat.id})}>{t('مغادرة المجموعة','Leave group')}</button>}
          <button type="button" onClick={()=>void act('chat-pin',{id:chat.id})}><Pin size={16}/>{chat.pinnedBy.includes(user)?t('إلغاء التثبيت','Unpin'):t('تثبيت المحادثة','Pin conversation')}</button>
          <button type="button" onClick={async()=>{if(window.confirm(t('إرسال بلاغ إلى الإدارة؟','Send a report to administration?'))&&await act('chat-report',{id:chat.id}))tell(t('تم إرسال البلاغ','Report sent'))}}><Flag size={16}/>{t('الإبلاغ عن المحادثة','Report conversation')}</button>
          <button type="button" onClick={()=>void act('chat-block',{id:chat.id})}><LockKeyhole size={16}/>{chat.blockedBy.includes(user)?t('إلغاء الحظر','Unblock'):t('حظر المحادثة','Block conversation')}</button>
        </div></details>
      </header>
      {searching&&<label className="search messenger-message-search"><Search size={17}/><input autoFocus type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('بحث داخل المحادثة','Search conversation')} aria-label={t('بحث داخل المحادثة','Search conversation')}/></label>}
      <div className="messenger-messages" role="log" aria-label={t('الرسائل','Messages')} ref={list} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<96}}>
        {appointments.map(lesson=><button className="lesson-chat-card" key={lesson.id} type="button" onClick={()=>{
          sessionStorage.setItem('halaqat-open-lesson',lesson.id);go('lessons')
        }}><CalendarDays size={18}/><span><strong>{lesson.title}</strong><small>{new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-ca-gregory',{dateStyle:'medium',timeStyle:'short',timeZone:lesson.zone}).format(new Date(lesson.startsAt))} · {lesson.zone}</small><small>{lessonClosed(lesson,callClock)?t('أُغلق الموعد','Session closed'):lesson.media==='video'?t('صوت وفيديو','Audio and video'):t('صوت فقط','Audio only')} · {Math.round((Date.parse(lesson.endsAt)-Date.parse(lesson.startsAt))/60_000)} {t('دقيقة','minutes')}</small></span></button>)}
        {messages.map(message=><article className={'message '+(message.from===user?'outgoing':'incoming')} key={message.id}>
          <strong className="message-sender">{message.from===user?t('أنت','You'):accounts.get(message.from)?.name??t('عضو الحلقة','Circle member')}
            {accounts.get(message.from)&&<small className="chat-role" data-role={accounts.get(message.from)?.role}><RoleName role={accounts.get(message.from)!.role}/></small>}</strong>
          {message.reply&&byMessage.has(message.reply)&&<blockquote>{byMessage.get(message.reply)?.text}</blockquote>}
          <p dir="auto" data-allow-copy>{message.text}</p><footer><time dateTime={message.time}>{clock.format(new Date(message.time))}</time>{canSend&&<button className="text-button" type="button" aria-label={t('رد','Reply')} onClick={()=>{updateDraft({reply:message.id});composer.current?.focus()}}><Reply size={15}/></button>}{message.from===user&&message.readBy.some(id=>id!==user)&&<Check aria-label={t('مقروءة','Read')} size={14}/>}</footer>
        </article>)}
        {!messages.length&&<Empty title={query?t('لا توجد رسائل مطابقة','No matching messages'):t('ابدأ أول رسالة','Start with a message')}/>}
      </div>
      <footer className="messenger-composer">
        {canSend ? <>
          {draft.reply&&<div className="messenger-reply"><Reply size={16}/><span>{byMessage.get(draft.reply)?.text}</span><button type="button" className="icon-button mini" aria-label={t('إلغاء الرد','Cancel reply')} onClick={()=>updateDraft({reply:''})}><X size={17}/></button></div>}
          <form className="compose-form" onSubmit={send}><textarea ref={composer} rows={1} dir="auto" value={draft.text} onChange={event=>updateDraft({text:event.target.value})} placeholder={t('اكتب رسالة…','Write a message…')} aria-label={t('اكتب رسالة','Write a message')} maxLength={3000}/><button className="btn btn-primary icon-button" aria-label={t('إرسال','Send')} disabled={sending||!draft.text.trim()}><Send size={20}/></button></form>
        </>:<p>{chat.group?.posting==='staff'&&data.user?.role!=='teacher'?t('الإرسال في هذه المجموعة للمحفّظ فقط.','Only the teacher can post in this group.')
          :chat.blocked||chat.blockedBy.length?t('المحادثة محظورة','Conversation blocked'):t('المحادثة للقراءة فقط','Read-only conversation')}</p>}
      </footer>
    </>:<Empty title={t('اختر محادثة','Select a conversation')} body={t('اختر محادثة من القائمة لعرض الرسائل.','Choose a conversation to view its messages.')}/>}</div>
    {choose&&<Modal title={t('محادثة جديدة','New conversation')} close={()=>{if(!opening)setChoose(false)}}><form onSubmit={openConversation}><div className="modal-body"><label>{t('المستلم','Recipient')}<select required value={target} onChange={event=>setTarget(event.target.value)}><option value="">{t('اختر جهة الاتصال','Choose a contact')}</option>
      {allContacts.map(peer=><option key={peer.id} value={peer.id}>{peer.name} · {t(...contactRoles[peer.role])}</option>)}</select></label></div><div className="modal-foot"><button className="btn btn-primary" disabled={!target||opening}>{t('فتح المحادثة','Open conversation')}</button></div></form></Modal>}
  </section>}
    <nav className="messenger-tabs" aria-label={t('أقسام الدردشة','Messaging sections')}>
      {tabs.filter(([id])=>!management||id==='messages'||id==='contacts').map(([id,Icon,label])=><button key={id} type="button" aria-current={id===tab?'page':undefined} onClick={()=>setTab(id)}>
        <Icon size={19}/><span>{label}</span>{id==='groups'&&invites.length>0&&<small className="messenger-unread">{invites.length}</small>}
      </button>)}
    </nav>
    {groupEditor&&<Modal title={groupEditor.chat?t('إعدادات المجموعة','Group settings'):t('إنشاء مجموعة حلقة','Create a circle group')} close={()=>{if(!groupBusy)setGroupEditor(undefined)}}>
      <form onSubmit={saveGroup}><div className="modal-body">
        <label>{t('اسم المجموعة','Group name')}<input name="title" maxLength={80} defaultValue={groupEditor.chat?.title} required/></label>
        {!groupEditor.chat&&<>
          <label>{t('الحلقة','Circle')}<select name="circleId" required defaultValue={data.circles.length===1?data.circles[0].id:''}>
            <option value="">{t('اختر الحلقة','Select a circle')}</option>{data.circles.map(circle=><option key={circle.id} value={circle.id}>{circle.name}</option>)}
          </select></label>
          <label>{t('المدعوون','Invitees')}<select name="audience"><option value="circle">{t('طلاب الحلقة وأولياء أمورهم','Circle students and their guardians')}</option>
            <option value="students">{t('طلاب الحلقة فقط','Circle students only')}</option></select></label>
        </>}
        <label>{t('من يستطيع الإرسال؟','Who can post?')}<select name="posting" defaultValue={groupEditor.chat?.group?.posting??'everyone'}>
          <option value="everyone">{t('كل عضو وافق على الانضمام','All members who joined')}</option><option value="staff">{t('المحفّظ فقط','Teacher only')}</option>
        </select></label>
        <p className="hint-line">{t('المجموعة خاصة، ويظهر محتواها للعضو بعد قبول الدعوة.','The group is private. Members can see messages after accepting the invitation.')}</p>
      </div><div className="modal-foot"><button className="btn btn-primary" disabled={groupBusy}>{groupEditor.chat?t('حفظ الإعدادات','Save settings'):t('إنشاء وإرسال الدعوات','Create and send invitations')}</button></div></form>
    </Modal>}
    {calling.dialog}
  </div>
}
