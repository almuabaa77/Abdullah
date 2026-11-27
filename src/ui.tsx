import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'
import { BookOpen, CalendarDays, Check, CircleCheck, CircleMinus, CircleX, Clock3, Star, X } from 'lucide-react'
import type { LessonCredentials } from './lessons'
import { segmentLabel, statusFor, type Daily, type ReminderField, type Student, type View } from './domain'

export type Tr = (ar: string, en: string) => string
export type Action = (action: string, values?: Record<string, unknown>, op?: string) => Promise<View>
export type Page = 'home' | 'assistant' | 'records' | 'chat' | 'more' | 'admin' | 'store' | 'exams' | 'leaves' | 'lessons'
export type WizardMode = 'recite' | 'review' | 'attendance' | 'schedule' | 'points' | 'edit'
export type Workspace = {
  data: View; en: boolean; t: Tr; post: Action; go: (page:Page) => void; tell: (message:string, error?:boolean) => void;
  refresh:()=>void; lessonRtc:(id:string)=>Promise<LessonCredentials>;
  open: (student?:Student,mode?:WizardMode,preset?:Partial<Daily>,circleId?:string,focus?:ReminderField) => void
}
export const Context = createContext<Workspace | null>(null)
export function useWorkspace() { const c = useContext(Context); if (!c) throw new Error('Workspace unavailable'); return c }
export function Brand({ small = false }: { small?:boolean }) {
  const {t} = useWorkspace()
  return <div className={'brand' + (small ? ' brand-small' : '')}><img src="/assets/icon-64.png" alt="" width="44" height="44" /><div><strong>{t('حلقات جامع الخير','Al-Khair Quran Circles')}</strong><span>{t('بآل سرحان','Al Sarhan')}</span></div></div>
}
export function Avatar({ student, size = '' }: { student:Student; size?:string }) {
  const {en} = useWorkspace()
  const name = en && student.latin ? student.latin : student.name
  return <span className={`avatar avatar-${student.color % 5} ${size}`} aria-hidden="true">{name.trim().split(/\s+/).slice(0,2).map(p => p[0]).join(' ')}</span>
}
export const nameFor = (student:Student,en:boolean) => en && student.latin ? student.latin : student.name
export const normal = (value:string) => value.toLocaleLowerCase().replace(/[أإآ]/g,'ا').replace(/[\u064B-\u065F\u0640]/g,'').replace(/ى/g,'ي').trim()
export const matches = (s:Student,q:string) => normal(s.name + ' ' + (s.latin || '')).includes(normal(q))
export function statusText(status:string,t:Tr) {
  return ({
    complete:t('مكتمل','Complete'), partial:t('مكتمل جزئيًا','Partial'), pending:t('لم يسجل بعد','Not yet recorded'),
    absent:t('غائب','Absent'), leave:t('مستأذن','On leave'), excused:t('غياب بعذر','Excused'), present:t('حاضر','Present'),
    accepted:t('معتمد','Accepted'), declined:t('مرفوض','Declined'), approved:t('تم الاعتماد','Approved'),
    ready:t('جاهز للاستلام','Ready'), delivered:t('تم التسليم','Delivered'), cancelled:t('ملغي','Cancelled'),
    active:t('مفعّل','Active'), disabled:t('موقوف','Disabled'), none:t('لم يسجل','Not recorded'),
  } as Record<string,string>)[status] || status
}
export function RoleName({ role }: {role:string}) {
  const {t} = useWorkspace()
  return <>{({teacher:t('المحفّظ','Teacher'),student:t('الطالب','Student'),parent:t('ولي الأمر','Guardian'),admin:t('الإدارة','Administration')} as Record<string,string>)[role]}</>
}
export function Badge({ status, label }: {status:string,label?:string}) {
  const {t}=useWorkspace()
  return <span className={'badge status-' + status}><span className="badge-dot" />{label || statusText(status,t)}</span>
}
export function Empty({ title, body, action }: { title:string; body?:string; action?:ReactNode }) {
  return <div className="empty"><div className="empty-icon"><BookOpen size={22} /></div><strong>{title}</strong>{body && <p>{body}</p>}{action}</div>
}
export function Modal({ title, children, close, wide = false, appearance = '' }: {
  title:string; children:ReactNode; close:()=>void; wide?:boolean; appearance?:string
}) {
  const {t} = useWorkspace()
  const panel = useRef<HTMLElement>(null)
  const heading = useId()
  useEffect(()=>{
    const previous=document.activeElement
    const overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const dialog=panel.current
    if(dialog&&!dialog.contains(previous)) dialog.focus()
    return ()=>{document.body.style.overflow=overflow;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()}
  },[])
  return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)close()}}>
    <section ref={panel} tabIndex={-1} className={['modal',wide?'modal-wide':'',appearance].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby={heading}
      onKeyDown={e=>{
        if(e.key==='Escape'){e.stopPropagation();close();return}
        if(e.key!=='Tab')return
        const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')].filter(el=>el.getClientRects().length)
        const first=items[0],last=items.at(-1)
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===e.currentTarget)){e.preventDefault();last?.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
      }}>
      <div className="modal-head"><h2 id={heading}>{title}</h2><button className="icon-button" type="button" onClick={close} aria-label={t('إغلاق','Close')}><X size={20}/></button></div>
      {children}
    </section>
  </div>
}
export function dateLabel(date:string, en:boolean, wide = false) {
  if (!date) return '—'
  return new Intl.DateTimeFormat(en ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', {weekday:wide?'long':undefined,day:'numeric',month:'long',year:wide?'numeric':undefined,timeZone:'Asia/Riyadh'}).format(new Date(date + 'T12:00:00Z'))
}
export function StudentIndicators({ record }: {record?:Daily}) {
  const {t,en} = useWorkspace()
  const detail = [
    { name:t('الحفظ','Memorization'), icon:BookOpen, status:record?.memorizationStatus || 'none', detail:segmentLabel(record?.memorization || [],en) },
    { name:t('المراجعة','Revision'), icon:Clock3, status:record?.reviewStatus || 'none', detail:segmentLabel(record?.review || [],en) },
    { name:t('الجدولة','Schedule'), icon:CalendarDays, status:record?.nextMemorization.length || record?.nextReview.length ? 'complete' : 'none', detail:record?.nextDate },
    { name:t('النقاط','Points'), icon:Star, status:record?.points ? 'complete' : 'none', detail:record?.points ? String(record.points) : '' },
    { name:t('الحضور','Attendance'), icon:record?.attendance === 'absent' ? CircleX : CircleCheck, status:record?.attendance || 'pending', detail:'' }
  ]
  return <div className="indicators">{detail.map(({icon:Icon,name,status,detail})=><span key={name} title={detail || statusText(status,t)} className={'indicator status-' + status}><Icon size={13}/>{name}{status === 'complete' || status === 'present' ? <Check size={12} className="tiny-check"/> : status === 'none' ? <CircleMinus size={10} className="tiny-check"/> : null}</span>)}</div>
}
export const completion = (record?:Daily) => statusFor(record) === 'complete'
