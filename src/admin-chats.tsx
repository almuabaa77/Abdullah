import { useState } from 'react'
import { ArrowLeft, Flag, LockKeyhole, MessageCircle, Search, ShieldCheck } from 'lucide-react'
import type { Chat, Message } from './domain'
import { Empty, Modal, normal, useWorkspace } from './ui'

type Decision = 'lock'|'unlock'|'resolve'|'hide'|'restore'
const labels:Record<Decision,[string,string]> = {
  lock:['إيقاف الإرسال','Pause messaging'],
  unlock:['إعادة فتح الإرسال','Resume messaging'],
  resolve:['إغلاق البلاغات','Resolve reports'],
  hide:['إخفاء الرسالة','Hide message'],
  restore:['إظهار الرسالة','Restore message'],
}

export function AdminChats() {
  const {data,t,en,post,tell}=useWorkspace()
  const [query,setQuery]=useState('')
  const [filter,setFilter]=useState('')
  const [selected,setSelected]=useState('')
  const [threadQuery,setThreadQuery]=useState('')
  const [limit,setLimit]=useState(25)
  const [messageLimit,setMessageLimit]=useState(35)
  const [change,setChange]=useState<{chat:Chat;decision:Decision;message?:Message}>()
  const [busy,setBusy]=useState(false)
  const names=new Map(data.users.map(user=>[user.id,user.name]))
  const circles=new Map(data.circles.map(circle=>[circle.id,circle.name]))
  const chat=data.chats.find(chat=>chat.id===selected)
  const search=normal(query)
  const term=normal(threadQuery)
  const threads=data.chats.filter(item=>{
    const matchesFilter=!filter||filter==='reported'&&item.reports.length>0||filter==='locked'&&item.locked
    return matchesFilter&&normal([item.title,circles.get(item.circleId??''),...item.members.map(id=>names.get(id))].join(' ')).includes(search)
  }).sort((a,b)=>Number(b.reports.length>0)-Number(a.reports.length>0)||(b.messages.at(-1)?.time??'').localeCompare(a.messages.at(-1)?.time??''))
  const messages=chat?.messages.filter(message=>!term||normal(message.text+' '+(names.get(message.from)??'')).includes(term))??[]
  const history=chat?data.audit.filter(entry=>entry.target===chat.id).slice(0,8):[]
  const clock=new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-ca-gregory',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Riyadh'})
  const date=(time:string)=>clock.format(new Date(time))
  function select(id:string) {setSelected(id);setThreadQuery('');setMessageLimit(35)}
  async function moderate() {
    if(!change||busy)return
    setBusy(true)
    try {
      await post('chat-moderate',{id:change.chat.id,decision:change.decision,messageId:change.message?.id})
      setChange(undefined)
      tell(t('حُفظ إجراء الإشراف','Moderation action saved'))
    } catch(error) {tell((error as Error).message,true)}
    finally {setBusy(false)}
  }

  return <div className="admin-chat-layout" data-thread={chat?'open':'closed'}>
    <section className="admin-chat-directory" aria-label={t('قائمة المحادثات','Conversation list')}>
      <label className="search"><Search size={17}/><input type="search" placeholder={t('ابحث بالعنوان أو اسم المشارك','Find by title or participant')}
        aria-label={t('البحث في المحادثات','Search conversations')} value={query} onChange={event=>{setQuery(event.target.value);setLimit(25)}}/></label>
      <select aria-label={t('حالة المحادثة','Conversation status')} value={filter} onChange={event=>{setFilter(event.target.value);setLimit(25)}}>
        <option value="">{t('كل المحادثات','All conversations')}</option>
        <option value="reported">{t('بها بلاغات مفتوحة','With open reports')}</option>
        <option value="locked">{t('الإرسال موقوف','Messaging paused')}</option>
      </select>
      <div className="admin-chat-threads">
        {threads.slice(0,limit).map(item=><button type="button" className="thread-button" key={item.id}
          aria-current={chat?.id===item.id?'true':undefined} onClick={()=>select(item.id)}>
          <span className="stat-icon tint-green"><MessageCircle size={19}/></span>
          <span><strong>{item.title}</strong><small>{item.messages.at(-1)?.time?date(item.messages.at(-1)!.time):t('لا رسائل بعد','No messages yet')}</small></span>
          {item.locked&&<LockKeyhole size={16} aria-label={t('الإرسال موقوف','Messaging paused')}/>}
          {item.reports.length>0&&<span className="badge status-absent"><Flag size={13}/>{item.reports.length}</span>}
        </button>)}
        {!threads.length&&<Empty title={t('لا توجد محادثات مطابقة','No matching conversations')}/>}
        {threads.length>limit&&<button type="button" className="btn btn-outline" onClick={()=>setLimit(limit+25)}>{t('عرض المزيد','Show more')}</button>}
      </div>
    </section>
    <section className="admin-chat-thread" aria-label={t('تفاصيل المحادثة','Conversation details')}>
      {chat?<>
        <header className="admin-chat-head">
          <button className="icon-button admin-chat-back" type="button" aria-label={t('العودة للمحادثات','Back to conversations')} onClick={()=>select('')}><ArrowLeft size={19}/></button>
          <div><h3>{chat.title}</h3><p>{circles.get(chat.circleId??'')||t('محادثة فردية','Direct conversation')} · {chat.messages.length} {t('رسالة','messages')}</p></div>
          {chat.locked&&<span className="badge status-absent">{t('الإرسال موقوف','Messaging paused')}</span>}
        </header>
        <div className="admin-chat-controls">
          <p>{t('الأعضاء','Members')} · {chat.members.map(id=>names.get(id)??t('حساب سابق','Former account')).join('، ')||'—'}</p>
          {chat.reports.length>0&&<p><Flag size={15}/> {chat.reports.length} {t('بلاغ مفتوح','open reports')} · {chat.reports.map(id=>names.get(id)??t('حساب سابق','Former account')).join('، ')}</p>}
          <div className="chip-row">
            <button type="button" className="btn btn-outline compact" onClick={()=>setChange({chat,decision:chat.locked?'unlock':'lock'})}><LockKeyhole size={16}/>{t(...labels[chat.locked?'unlock':'lock'])}</button>
            {chat.reports.length>0&&<button type="button" className="btn btn-subtle compact" onClick={()=>setChange({chat,decision:'resolve'})}><ShieldCheck size={17}/>{t(...labels.resolve)}</button>}
          </div>
          {history.length>0&&<details className="admin-chat-history">
            <summary>{t('سجل الإشراف','Moderation history')}</summary>
            <ul>{history.map((entry,index)=><li key={entry.time+':'+index}>{entry.action} · {entry.actor} · <time dateTime={entry.time}>{date(entry.time)}</time></li>)}</ul>
          </details>}
        </div>
        <label className="search admin-thread-search"><Search size={17}/><input type="search" aria-label={t('البحث في رسائل المحادثة','Search messages')}
          placeholder={t('ابحث في الرسائل','Find messages')} value={threadQuery} onChange={event=>{setThreadQuery(event.target.value);setMessageLimit(35)}}/></label>
        <div className="admin-chat-messages">
          {messages.slice(-messageLimit).reverse().map(message=><article key={message.id} className="admin-chat-message" data-hidden={Boolean(message.hiddenAt)}>
            <div><strong>{names.get(message.from)??t('عضو سابق','Former member')}</strong><small><time dateTime={message.time}>{date(message.time)}</time>{message.hiddenAt&&' · '+t('مخفية عن الأعضاء','Hidden from members')}</small></div>
            <p dir="auto">{message.text}</p>
            <button type="button" className="text-button" onClick={()=>setChange({chat,message,decision:message.hiddenAt?'restore':'hide'})}>{t(...labels[message.hiddenAt?'restore':'hide'])}</button>
          </article>)}
          {messages.length>messageLimit&&<button type="button" className="btn btn-outline compact" onClick={()=>setMessageLimit(messageLimit+35)}>{t('عرض رسائل أقدم','Show older messages')}</button>}
          {!messages.length&&<Empty title={t('لا توجد رسائل مطابقة','No matching messages')}/>}
        </div>
      </>:<Empty title={t('اختر محادثة لمراجعتها','Select a conversation to review')}/>}
    </section>
    {change&&<Modal title={t(...labels[change.decision])} close={()=>{if(!busy)setChange(undefined)}}>
      <div className="modal-body"><strong>{change.chat.title}</strong>
        {change.message&&<p dir="auto">{change.message.text}</p>}
      </div>
      <div className="modal-foot"><button className="btn btn-outline" type="button" disabled={busy} onClick={()=>setChange(undefined)}>{t('إلغاء','Cancel')}</button>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={()=>void moderate()}>{t('تأكيد الإجراء','Confirm action')}</button></div>
    </Modal>}
  </div>
}
