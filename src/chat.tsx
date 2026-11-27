import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, Flag, LockKeyhole, MessageCircle, Pin, Plus, Reply, Search, Send, X } from 'lucide-react'
import { idFor, type Chat } from './domain'
import { Empty, Modal, nameFor, useWorkspace } from './ui'

type Draft = { text:string; reply:string; op?:string }
const emptyDraft:Draft = {text:'',reply:''}

export function ChatPage() {
  const {data,t,en,post,tell} = useWorkspace()
  const [selected,setSelected] = useState('')
  const [drafts,setDrafts] = useState<Record<string,Draft>>({})
  const [threadQuery,setThreadQuery] = useState('')
  const [query,setQuery] = useState('')
  const [searching,setSearching] = useState(false)
  const [sending,setSending] = useState(false)
  const [choose,setChoose] = useState(false)
  const [opening,setOpening] = useState(false)
  const [target,setTarget] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const follow = useRef(true)
  const user = data.user?.id ?? ''
  const title = (chat:Chat) => data.sample&&en&&chat.id==='chat-1'?'Imam Asim Circle Group':chat.title
  const chats = data.chats.slice().sort((a,b)=>Number(b.pinnedBy.includes(user))-Number(a.pinnedBy.includes(user)) || (b.messages.at(-1)?.time ?? '').localeCompare(a.messages.at(-1)?.time ?? ''))
  const chat = chats.find(item=>item.id===selected)
  const unread = (item:Chat) => item.messages.filter(message=>message.from!==user&&!message.readBy.includes(user)).length
  const unreadCount = chat ? unread(chat) : 0
  const visible = chats.filter(item=>title(item).toLocaleLowerCase().includes(threadQuery.trim().toLocaleLowerCase()))
  const messages = chat?.messages.filter(message=>message.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []
  const draft = (chat && drafts[chat.id]) || emptyDraft
  const byMessage = new Map(chat?.messages.map(message=>[message.id,message]))
  const byUser = new Map(data.users.map(account=>[account.id,account.name]))
  const clock = new Intl.DateTimeFormat(en?'en-GB':'ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})
  const canSend = chat && data.rules.chat && !chat.locked && !chat.blocked && !chat.blockedBy.length && (chat.members.includes(user) || Boolean(chat.circleId && chat.students.some(id=>data.students.some(student=>student.id===id))))
  const openThread = (id:string) => {follow.current=true;setSelected(id);setQuery('');setSearching(false)}

  useEffect(()=>{
    if(!chat || !unreadCount)return
    const mark=()=>{if(!document.hidden)void post('chat-read',{id:chat.id}).catch(()=>{})}
    mark()
    document.addEventListener('visibilitychange',mark)
    return ()=>document.removeEventListener('visibilitychange',mark)
  },[chat?.id,unreadCount])
  useLayoutEffect(()=>{
    if(follow.current&&!query&&list.current)list.current.scrollTop=list.current.scrollHeight
  },[chat?.id,messages.length,query])

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
    if(!target||opening)return
    setOpening(true)
    try {
      const result=await act('chat-open',{studentId:target})
      if(!result)return
      const match=result.chats.find(item=>item.students.length===1&&item.students[0]===target&&item.members.includes(user))
      if(match)openThread(match.id)
      setChoose(false)
    } finally {setOpening(false)}
  }

  return <section className="messenger" data-thread={chat?'open':'closed'} aria-label={t('المحادثات','Conversations')}>
    <aside className="messenger-directory">
      <header><div><h1>{t('المحادثات','Conversations')}</h1><p>{t('رسائل الحلقات','Circle messages')}</p></div><button className="btn btn-primary icon-button" type="button" disabled={!data.students.length||!data.rules.chat} aria-label={t('محادثة جديدة','New conversation')} onClick={()=>setChoose(true)}><Plus size={21}/></button></header>
      <label className="search"><Search size={17}/><input type="search" value={threadQuery} onChange={event=>setThreadQuery(event.target.value)} placeholder={t('ابحث عن محادثة','Find a conversation')} aria-label={t('ابحث عن محادثة','Find a conversation')}/></label>
      <div className="messenger-threads">{visible.map(item=>{
        const count=unread(item)
        return <button className={'thread-button '+(chat?.id===item.id?'selected':'')} type="button" aria-current={chat?.id===item.id?'true':undefined} key={item.id} onClick={()=>openThread(item.id)}>
          <span className="stat-icon tint-green"><MessageCircle size={20}/></span><span><strong>{title(item)}</strong><small>{item.messages.at(-1)?.text || t('محادثة جديدة','New conversation')}</small></span>
          {count>0?<span className="messenger-unread">{count}</span>:item.pinnedBy.includes(user)&&<Pin size={15}/>}
        </button>
      })}{!visible.length&&<Empty title={threadQuery?t('لا توجد نتائج مطابقة','No matching conversations'):t('لا توجد محادثات بعد','No conversations yet')}/>}</div>
    </aside>
    <div className="messenger-thread">{chat ? <>
      <header className="messenger-thread-head">
        <button type="button" className="icon-button messenger-back" aria-label={t('العودة إلى المحادثات','Back to conversations')} onClick={()=>openThread('')}><ArrowLeft size={21}/></button>
        <span className="stat-icon tint-green"><MessageCircle size={20}/></span>
        <div><h2>{title(chat)}</h2><p>{chat.circleId?t('محادثة الحلقة','Circle conversation'):t('محادثة فردية','Direct conversation')}</p></div>
        <button type="button" className="icon-button" aria-pressed={searching} aria-label={t('بحث داخل المحادثة','Search conversation')} onClick={()=>{setSearching(!searching);setQuery('')}}><Search size={19}/></button>
        <details className="messenger-menu"><summary className="icon-button" aria-label={t('خيارات المحادثة','Conversation options')}>⋯</summary><div>
          <button type="button" onClick={()=>void act('chat-pin',{id:chat.id})}><Pin size={16}/>{chat.pinnedBy.includes(user)?t('إلغاء التثبيت','Unpin'):t('تثبيت المحادثة','Pin conversation')}</button>
          <button type="button" onClick={async()=>{if(window.confirm(t('إرسال بلاغ إلى الإدارة؟','Send a report to administration?'))&&await act('chat-report',{id:chat.id}))tell(t('تم إرسال البلاغ','Report sent'))}}><Flag size={16}/>{t('الإبلاغ عن المحادثة','Report conversation')}</button>
          <button type="button" onClick={()=>void act('chat-block',{id:chat.id})}><LockKeyhole size={16}/>{chat.blockedBy.includes(user)?t('إلغاء الحظر','Unblock'):t('حظر المحادثة','Block conversation')}</button>
        </div></details>
      </header>
      {searching&&<label className="search messenger-message-search"><Search size={17}/><input autoFocus type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('بحث داخل المحادثة','Search conversation')} aria-label={t('بحث داخل المحادثة','Search conversation')}/></label>}
      <div className="messenger-messages" role="log" aria-label={t('الرسائل','Messages')} ref={list} onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<96}}>
        {messages.map(message=><article className={'message '+(message.from===user?'outgoing':'incoming')} key={message.id}>
          <strong>{message.from===user?t('أنت','You'):byUser.get(message.from)??t('عضو الحلقة','Circle member')}</strong>
          {message.reply&&byMessage.has(message.reply)&&<blockquote>{byMessage.get(message.reply)?.text}</blockquote>}
          <p dir="auto">{message.text}</p><footer><time dateTime={message.time}>{clock.format(new Date(message.time))}</time>{canSend&&<button className="text-button" type="button" aria-label={t('رد','Reply')} onClick={()=>{updateDraft({reply:message.id});composer.current?.focus()}}><Reply size={15}/></button>}{message.from===user&&message.readBy.some(id=>id!==user)&&<Check aria-label={t('مقروءة','Read')} size={14}/>}</footer>
        </article>)}
        {!messages.length&&<Empty title={query?t('لا توجد رسائل مطابقة','No matching messages'):t('ابدأ أول رسالة','Start with a message')}/>}
      </div>
      <footer className="messenger-composer">
        {canSend ? <>
          {draft.reply&&<div className="messenger-reply"><Reply size={16}/><span>{byMessage.get(draft.reply)?.text}</span><button type="button" className="icon-button mini" aria-label={t('إلغاء الرد','Cancel reply')} onClick={()=>updateDraft({reply:''})}><X size={17}/></button></div>}
          <form className="compose-form" onSubmit={send}><textarea ref={composer} rows={1} dir="auto" value={draft.text} onChange={event=>updateDraft({text:event.target.value})} placeholder={t('اكتب رسالة…','Write a message…')} aria-label={t('اكتب رسالة','Write a message')} maxLength={3000}/><button className="btn btn-primary icon-button" aria-label={t('إرسال','Send')} disabled={sending||!draft.text.trim()}><Send size={20}/></button></form>
        </>:<p>{chat.locked?t('أوقفت الإدارة الإرسال في هذه المحادثة','Messaging is paused by administration'):chat.blocked||chat.blockedBy.length?t('المحادثة محظورة','Conversation blocked'):t('المحادثة للقراءة فقط','Read-only conversation')}</p>}
      </footer>
    </>:<Empty title={t('اختر محادثة','Select a conversation')} body={t('اختر محادثة من القائمة لعرض الرسائل.','Choose a conversation to view its messages.')}/>}</div>
    {choose&&<Modal title={t('محادثة جديدة','New conversation')} close={()=>{if(!opening)setChoose(false)}}><form onSubmit={openConversation}><div className="modal-body"><label>{t('الطالب','Student')}<select required value={target} onChange={event=>setTarget(event.target.value)}><option value="">{t('اختر طالبًا','Choose a student')}</option>{data.students.filter(student=>student.active).map(student=><option key={student.id} value={student.id}>{nameFor(student,en)}</option>)}</select></label></div><div className="modal-foot"><button className="btn btn-primary" disabled={!target||opening}>{t('فتح المحادثة','Open conversation')}</button></div></form></Modal>}
  </section>
}
