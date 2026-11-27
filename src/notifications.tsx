import { useEffect, useState } from 'react'
import { Bell, ChevronDown, Timer } from 'lucide-react'
import { noticeExpiresAt, type Notice } from './domain'
import { Empty, useWorkspace } from './ui'

export function useNoticeTime(items:Notice[],ticking:boolean) {
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{
    let timer:number|undefined
    const update=()=>{
      window.clearTimeout(timer)
      const current=Date.now()
      setNow(current)
      const nearest=items.reduce((expires,notice)=>{
        if(notice.announcement&&(!notice.announcement.publishedAt||notice.announcement.withdrawn))return expires
        const at=noticeExpiresAt(notice)
        return at>current?Math.min(expires,at):expires
      },Infinity)
      if(Number.isFinite(nearest))timer=window.setTimeout(update,ticking?Math.min(1000,nearest-current):nearest-current)
    }
    update()
    document.addEventListener('visibilitychange',update)
    return ()=>{
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange',update)
    }
  },[items,ticking])
  return now
}

export function activeNotices(items:Notice[],now:number) {
  return items.filter(notice=>(!notice.announcement||notice.announcement.publishedAt&&!notice.announcement.withdrawn)
    &&noticeExpiresAt(notice)>now).sort((left,right)=>
    (right.announcement?.publishedAt??right.time).localeCompare(left.announcement?.publishedAt??left.time))
}

function RemainingTime({notice,now}:{notice:Notice;now:number}) {
  const {t}=useWorkspace()
  const seconds=Math.max(0,Math.ceil((noticeExpiresAt(notice)-now)/1000))
  const time=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60]
    .map(part=>String(part).padStart(2,'0')).join(':')
  const urgency=seconds<3600?'urgent':seconds<6*3600?'soon':'fresh'
  return <span className="notice-timer" data-urgency={urgency} aria-label={t('الوقت المتبقي','Time remaining')+' '+time}>
    <Timer size={13} aria-hidden="true"/><bdi>{time}</bdi>
  </span>
}

const pageSize=4
export function NotificationList({items,now,open,permissions}:{items:Notice[];now:number;open:(notice:Notice)=>void;permissions?:()=>void}) {
  const {data,t,en,post,tell}=useWorkspace()
  const [limit,setLimit]=useState(pageSize)
  const remaining=items.length-limit
  return <div className="popover notifications">
    <div className="section-title"><h2>{t('الإشعارات','Notifications')}</h2>{items.some(item=>!item.readBy.includes(data.user?.id??''))&&
      <button className="text-button" type="button" onClick={()=>void post('notice-read').catch(error=>tell(error.message,true))}>{t('تحديد الكل كمقروء','Mark all read')}</button>}</div>
    {items.slice(0,limit).map(item=><button key={item.id} type="button" className={'notice-row '+(!item.readBy.includes(data.user?.id??'')?'unread':'')} onClick={()=>open(item)}>
      <span className="stat-icon tint-green"><Bell size={16}/></span>
      <span className="notice-copy"><strong>{en&&item.en?item.en:item.title}</strong><small>{en&&item.bodyEn?item.bodyEn:item.body}</small>
        {item.recordReminder&&<small className="notice-record-action">{t('فتح سجل الطالب','Open student record')}</small>}
        <RemainingTime notice={item} now={now}/>
      </span>
    </button>)}
    {!items.length&&<Empty title={t('لا توجد إشعارات','No notifications')}/>}
    {remaining>0&&<button type="button" className="btn btn-outline compact notice-more" onClick={()=>setLimit(value=>value+pageSize)}>
      <ChevronDown size={16}/>{t('المزيد','More')} <span className="count-pill">{remaining}</span>
    </button>}
    {permissions&&<button className="text-button notification-permissions" type="button" onClick={permissions}>{t('أذونات وتنبيهات الجهاز','Device permissions and alerts')}</button>}
  </div>
}
