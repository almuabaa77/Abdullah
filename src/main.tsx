import { activeNotices, NotificationList, useNoticeTime } from './notifications'
import { LessonCenter } from './lesson-center'
import type { LessonCredentials } from './lessons'
import { AnnouncementFeed } from './announcements'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, Bell, BookOpen, CalendarDays, Check, ChevronDown, CircleAlert, ClipboardList, Ellipsis, Globe, Home, LogIn, LogOut, Menu, MessageCircle, ShieldCheck, ShoppingBag, Sparkles, Smartphone, UserCheck, WifiOff, X } from 'lucide-react'
import { callState, idFor, type Daily, type Notice, type ReminderField, type Student, type View } from './domain'
import { Context, Brand, Empty, Modal, RoleName, type Page, type Tr, type WizardMode } from './ui'
import { Dashboard, StudentHome } from './dashboard'
import { EntryWizard } from './wizard'
import { Assistant } from './assistant'
import { Records } from './records'
import { Exams, Leaves, More, Store } from './features'
import { ChatPage } from './chat'
import { DevicePermissions } from './device-permissions'
import { disableDevicePush } from './device-push'
import { Registration } from './enrollment-form'
import { AccountAccess } from './account-access'
import { subscribeRecordRevisions, type RecordStreamStatus } from './live-records'
import { Starting, Welcome } from './welcome'
import { applyAppUpdate, watchAppUpdates } from './app-updates'
import type { PhoneAuth, PhoneAvailability } from './phone'
import './styles.css'
import './workbench.css'

type InstallEvent = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
const pages = ['home','assistant','records','chat','more','admin','store','exams','leaves','lessons']
const currentPage = ():Page => {
  if (location.pathname === '/admin' || location.pathname === '/admin/') return 'admin'
  const fragment = location.hash.slice(1)
  return pages.includes(fragment) ? fragment as Page : 'home'
}
const phoneRequested = () => new URLSearchParams(location.search).get('signin')==='phone'
const requestedReminder = () => new URLSearchParams(location.search).get('reminder')
const emptyData:View = {
  user:null,date:'',revision:0,phoneEnabled:false,sample:false,students:[],users:[],circles:[],daily:[],closed:[],notices:[],links:[],prizes:[],orders:[],exams:[],leaves:[],rules:{memorization:4,review:4,attendance:2,chat:true},chats:[],audit:[],
}
const PhoneSignIn = lazy(()=>import('./phone').then(m=>({default:m.PhoneSignIn})))
const Admin = lazy(()=>import('./admin').then(m=>({default:m.Admin})))
class WorkspaceError extends Error {
  constructor(message:string, readonly status:number) {super(message)}
}
async function request(token:string,role:string,body?:Record<string,unknown>,signal?:AbortSignal):Promise<View> {
  const response = await fetch('/api/workspace',{method:body?'POST':'GET',headers:{
    ...(body?{'Content-Type':'application/json'}:{}),
    ...(token?{'Authorization':'Bearer '+token}:{'X-Preview-Role':role}),
  },body:body?JSON.stringify(body):undefined,signal,cache:'no-store'})
  return readView(response)
}
async function readView(response:Response):Promise<View> {
  const value = await response.json() as View & {error?:string}
  if(!response.ok || value.error) throw new WorkspaceError(value.error || 'Unable to load the workspace',response.status)
  return value
}
async function refreshView(token:string,role:string,signal:AbortSignal,known?:Pick<View,'revision'|'date'>) {
  const bounded=typeof AbortSignal.any==='function'&&typeof AbortSignal.timeout==='function'
    ? AbortSignal.any([signal,AbortSignal.timeout(14_000)]) : signal
  if(!known)return request(token,role,undefined,bounded)
  const query=new URLSearchParams({since:String(known.revision),date:known.date})
  const response=await fetch('/api/workspace?'+query,{headers:{Authorization:'Bearer '+token},signal:bounded,cache:'no-store'})
  return response.status===204?null:readView(response)
}
function retryWhenOnline() {
  return new Promise<void>((resolve,reject)=>{
    const online = () => { clearTimeout(timer);resolve() }
    const timer = window.setTimeout(()=>{window.removeEventListener('online',online);reject(new Error('الاتصال غير متاح الآن، حاول مرة أخرى عند عودته.'))},45000)
    window.addEventListener('online',online,{once:true})
  })
}

function App() {
  const [en,setEn] = useState(()=>localStorage.getItem('halaqat-language')==='en')
  const [page,setPage] = useState<Page>(currentPage)
  const [role,setRole] = useState('admin')
  const [auth,setAuth] = useState<PhoneAuth|null>(null)
  const [authReady,setAuthReady] = useState(false)
  const [phoneAvailability,setPhoneAvailability] = useState<PhoneAvailability>('loading')
  const [phoneAttempt,retryPhone] = useState(0)
  const [session,setSession] = useState({token:'',uid:''})
  const {token,uid} = session
  const activeUid = useRef(uid)
  activeUid.current = uid
  const [loadedUid,setLoadedUid] = useState<string>()
  const [data,setData] = useState<View>(emptyData)
  const latestView=useRef(data)
  latestView.current=data
  const [loading,setLoading] = useState(true)
  const [loadError,setLoadError] = useState('')
  const [sessionExpired,setSessionExpired] = useState(false)
  const [availableUpdate,setAvailableUpdate] = useState<string>()
  const [openPanel,setOpenPanel] = useState<'notices'|'profile'|'navigation'|''>('')
  const [phone,setPhone] = useState(phoneRequested)
  const [toast,setToast] = useState<{text:string;error:boolean}>()
  const [wizard,setWizard] = useState<{student?:Student;mode:WizardMode;preset?:Partial<Daily>;circleId?:string;focus?:ReminderField}>()
  const [reminderId,setReminderId] = useState(requestedReminder)
  const [online,setOnline] = useState(navigator.onLine)
  const [permissions,setPermissions] = useState(false)
  const [install,setInstall] = useState<InstallEvent|null>(null)
  const [registering,setRegistering] = useState(false)
  const [recheck,setRecheck] = useState(0)
  const [unregistered,setUnregistered] = useState(false)
  const [liveRecords,setLiveRecords] = useState<RecordStreamStatus>('connecting')
  const lastStreamMessage = useRef(0)
  const announcedRevision = useRef(0)
  const lastWorkspaceSync = useRef(0)
  const refreshWorkspace = useRef<()=>void>(()=>{})
  const refreshedUid = useRef('')
  const t:Tr = (ar,english)=>en?english:ar
  const go = useCallback((p:Page,replace=false) => {
    const url = p==='admin' ? '/admin' : p==='home' ? '/' : '/#'+p
    if (location.pathname+location.hash!==url||phoneRequested()) {
      if (replace) history.replaceState(null,'',url)
      else history.pushState(null,'',url)
    }
    setPage(p);setOpenPanel('');setPhone(false)
    window.scrollTo({top:0,behavior:'instant'})
  },[])
  const changePhone = useCallback((open:boolean) => {
    const url=new URL(location.href)
    if(open)url.searchParams.set('signin','phone')
    else url.searchParams.delete('signin')
    if(url.href!==location.href)history.replaceState(history.state,'',url)
    setPhone(open)
  },[])
  useEffect(()=>{if(phone&&token)changePhone(false)},[phone,token,changePhone])
  const tell = useCallback((text:string,error=false)=>setToast({text,error}),[])
  const changeLanguage = ()=>setEn(!en)
  useEffect(()=>{document.documentElement.lang=en?'en':'ar';document.documentElement.dir=en?'ltr':'rtl';localStorage.setItem('halaqat-language',en?'en':'ar')},[en])
  useEffect(()=>watchAppUpdates(setAvailableUpdate),[])
  useEffect(()=>{
    const desktop=matchMedia('(min-width: 851px)')
    const closeMenu=()=>{if(desktop.matches)setOpenPanel(current=>current==='navigation'?'':current)}
    desktop.addEventListener('change',closeMenu)
    return ()=>desktop.removeEventListener('change',closeMenu)
  },[])
  useEffect(()=>{
    const nav=()=>{
      const next=currentPage()
      if(next==='admin'&&location.pathname!=='/admin')history.replaceState(null,'','/admin')
      setPage(next);setOpenPanel('');setPhone(phoneRequested());setReminderId(requestedReminder())
    }
    nav()
    const change=()=>setOnline(navigator.onLine)
    const capture=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent)}
    window.addEventListener('hashchange',nav);window.addEventListener('popstate',nav);window.addEventListener('online',change);window.addEventListener('offline',change)
    window.addEventListener('beforeinstallprompt',capture)
    return ()=>{window.removeEventListener('hashchange',nav);window.removeEventListener('popstate',nav);window.removeEventListener('online',change);window.removeEventListener('offline',change);window.removeEventListener('beforeinstallprompt',capture)}
  },[])
  useEffect(()=>{
    let active=true
    let unsubscribe:(()=>void)|undefined
    const controller=new AbortController()
    const timeout=window.setTimeout(()=>controller.abort(),12000)
    setPhoneAvailability('loading')
    const receive=(next:string,userId:string)=>{if(active)setSession(current=>current.token===next&&current.uid===userId?current:{token:next,uid:userId})}
    const setup=async ()=>{
      try {
        const [response,{connectPhone}]=await Promise.all([fetch('/api/config',{signal:controller.signal}),import('./phone')])
        if(!response.ok)throw new Error()
        const {firebase}=await response.json()
        if(!active)return
        if(!firebase){setPhoneAvailability('disabled');return}
        const result=await connectPhone(firebase,receive)
        if(!active){result.unsubscribe();return}
        unsubscribe=result.unsubscribe
        setAuth(result.auth);setPhoneAvailability('ready')
      } catch {if(active)setPhoneAvailability('unavailable')}
      finally {window.clearTimeout(timeout);if(active)setAuthReady(true)}
    }
    void setup()
    return ()=>{active=false;window.clearTimeout(timeout);controller.abort();unsubscribe?.()}
  },[phoneAttempt])
  useEffect(()=>{
    if(phoneAvailability!=='unavailable')return
    const reconnect=()=>retryPhone(value=>value+1)
    window.addEventListener('online',reconnect)
    return ()=>window.removeEventListener('online',reconnect)
  },[phoneAvailability])
  useEffect(()=>{
    if(!authReady)return
    const controller=new AbortController()
    let active = true
    let pulling = false
    let queued = false
    const pending = loadedUid!==uid || Boolean(loadError)
    if(pending){setLoading(true);setLoadError('')}
    const pull = async (initial = false) => {
      if(pulling){queued=true;return}
      pulling=true
      let retrying = false
      try {
        const current=latestView.current
        const known=!initial&&token&&current.user?.id===uid&&current.user?.role==='admin'&&current.user.status==='active'?current:undefined
        const result=await refreshView(token,role,controller.signal,known)
        if(!active)return
        lastWorkspaceSync.current=Date.now()
        if(!result)return
        setData(previous=>initial||previous.user?.id!==result.user?.id||previous.revision<=result.revision?result:previous)
        setUnregistered(Boolean(token&&!result.user&&!result.accountAccess))
        setLoadError('')
        setSessionExpired(false)
        refreshedUid.current=''
        const adminId = token&&result.user?.role==='admin'&&result.user.status==='active' ? result.user.id : undefined
        if(adminId&&currentPage()!=='admin')go('admin',true)
      } catch(e){
        const expired = e instanceof WorkspaceError&&e.status===401
        const revoked = e instanceof WorkspaceError&&e.status===403
        if(active&&expired&&uid&&auth?.currentUser?.uid===uid&&refreshedUid.current!==uid) {
          refreshedUid.current=uid
          const renewed=await auth.currentUser.getIdToken(true).catch(()=>undefined)
          if(active&&renewed&&renewed!==token){retrying=true;setSession({token:renewed,uid});return}
        }
        if(active&&(initial||revoked))setData(emptyData)
        if(active&&(initial||expired||revoked)){setSessionExpired(expired);setLoadError((e as Error).message)}
      } finally {
        pulling=false
        if(active&&initial&&!retrying){setLoadedUid(uid);setLoading(false)}
        if(active&&queued&&!retrying){queued=false;void pull()}
      }
    }
    const refresh=()=>{if(navigator.onLine)void pull()}
    refreshWorkspace.current=refresh
    void pull(pending)
    const timer=window.setInterval(()=>{
      const now=Date.now()
      if((now-lastStreamMessage.current>14000||now-lastWorkspaceSync.current>75000||announcedRevision.current>latestView.current.revision)
        &&document.visibilityState==='visible')refresh()
    },6500)
    window.addEventListener('online',refresh);window.addEventListener('focus',refresh)
    return ()=>{active=false;refreshWorkspace.current=()=>{};controller.abort();clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh)}
  },[authReady,auth,token,uid,role,recheck,go])
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(undefined),4700);return()=>clearTimeout(timer)},[toast])
  const post = async (action:string,values:Record<string,unknown>={},op:string=idFor()) => {
    const body={...values,action,op}
    if(!navigator.onLine){tell(t('سيُستأنف الحفظ عند عودة الاتصال.','Saving will resume when you reconnect.'));await retryWhenOnline()}
    let result:View
    try{ result=await request(token,role,body) } catch(e) {
      if(!(e instanceof TypeError))throw e
      if(!navigator.onLine)await retryWhenOnline()
      result=await request(token,role,body)
    }
    if(activeUid.current===uid){
      setData(previous=>previous.user?.id!==result.user?.id||previous.revision<=result.revision?result:previous)
      setUnregistered(Boolean(token&&!result.user&&!result.accountAccess))
    }
    return result
  }
  const open = (student?:Student,mode:WizardMode='recite',preset?:Partial<Daily>,circleId?:string,focus?:ReminderField) => setWizard({student,mode,preset,circleId,focus})
  const teacher = data.user?.role==='teacher'||data.user?.role==='admin'
  const student=data.user?.role==='student'
  const noticeTime=useNoticeTime(data.notices,openPanel==='notices')
  const availableNotices=activeNotices(data.notices,noticeTime)
  const notices=availableNotices.filter(n=>!n.readBy.includes(data.user?.id||''))
  const loadingView = loading||!authReady||loadedUid!==uid
  useEffect(()=>{
    if(availableUpdate&&page==='home'&&!loadingView&&!loadError&&!token&&!data.user&&!data.accountAccess&&!phone) applyAppUpdate(availableUpdate,true)
  },[availableUpdate,page,loadingView,loadError,token,data.user,data.accountAccess,phone])
  const show = !loadingView&&!loadError&&data.user?.status==='active'
  const adminAccess=show&&data.user?.role==='admin'
  const manager=Boolean(adminAccess&&token)
  const adminPage = page==='admin'||manager
  const workspaceVisible=show&&!adminPage
  const receivingReminders = Boolean(workspaceVisible&&data.user?.role==='teacher'&&token&&online)
  useEffect(()=>{
    if(!receivingReminders)return
    return subscribeRecordRevisions(token,revision=>{
      if(revision>latestView.current.revision)refreshWorkspace.current()
    },()=>{},true)
  },[receivingReminders,token])
  const openNotice = (notice:Notice) => {
    if(notice.recordReminder&&data.user?.role==='teacher') {
      const {studentId,circleId,date,field}=notice.recordReminder
      const target=data.students.find(student=>student.id===studentId&&student.active&&student.circleId===circleId)
      if(!target){tell(t('سجل الطالب غير متاح لهذا الحساب.','This student record is unavailable to this account.'),true);return}
      const record=data.daily.find(entry=>entry.studentId===studentId&&entry.date===date)
      const mode=field==='attendance'?'attendance':record?.[field].length?'edit':field==='review'?'review':'recite'
      go('records')
      open(target,mode,{date},circleId,field)
    }
    if(notice.lesson){
      sessionStorage.setItem('halaqat-open-lesson',notice.lesson.id)
      if(adminAccess){
        history.pushState(null,'','/admin?section=lessons&lesson='+encodeURIComponent(notice.lesson.id))
        window.dispatchEvent(new PopStateEvent('popstate'))
      } else if(workspaceVisible)go('lessons')
      window.dispatchEvent(new Event('halaqat-open-lesson'))
    }
    if(notice.kind==='group-invitation'&&workspaceVisible){
      sessionStorage.setItem('halaqat-group-invitations','1')
      window.dispatchEvent(new Event('halaqat-group-invitations'))
      go('chat')
    }
    if(notice.kind==='message'){
      if(workspaceVisible)go('chat')
      else if(adminAccess){
        history.pushState(null,'','/admin?section=chats&inbox=1')
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    }
    if(notice.kind==='exam'&&workspaceVisible)go('exams')
    if(notice.kind==='link'&&data.user?.role==='parent')go('more')
    if(!notice.readBy.includes(data.user?.id||''))void post('notice-read',{id:notice.id}).catch(e=>tell(e.message,true))
  }
  useEffect(()=>{
    if(!reminderId||!workspaceVisible||data.user?.role!=='teacher')return
    const url=new URL(location.href)
    if(url.searchParams.has('reminder')){
      url.searchParams.delete('reminder')
      history.replaceState(history.state,'',url)
    }
    setReminderId(null)
    const notice=availableNotices.find(item=>item.id===reminderId&&item.recordReminder)
    if(notice)openNotice(notice)
    else tell(t('هذا التنبيه غير متاح لهذا الحساب.','This reminder is unavailable to this account.'),true)
  },[reminderId,workspaceVisible,data.user,data.notices,openNotice,tell,t])
  useEffect(()=>{if(manager&&page!=='admin')go('admin',true)},[manager,page,go])
  const streamEnabled = Boolean(adminPage&&adminAccess&&token&&online)
  useEffect(()=>{
    if(!streamEnabled)return
    const stop=subscribeRecordRevisions(token,revision=>{
      announcedRevision.current=revision
      if(revision!==latestView.current.revision)refreshWorkspace.current()
    },status=>{
      const wasLive=lastStreamMessage.current>0
      lastStreamMessage.current=status==='live'?Date.now():0
      setLiveRecords(status)
      if(status==='polling'&&wasLive)refreshWorkspace.current()
    })
    return ()=>{stop();lastStreamMessage.current=0;announcedRevision.current=0}
  },[streamEnabled,token])
  useEffect(()=>{
    document.title = adminPage
      ? en?'Administration | Al-Khair Quran Circles':'لوحة الإدارة | حلقات جامع الخير'
      : en?'Al-Khair Quran Circles':'حلقات جامع الخير بآل سرحان'
  },[adminPage,en])
  const nav = [
    ['home',Home,t('الرئيسية','Home')],
    ...(teacher?[['assistant',Sparkles,t('المساعد الذكي','Smart assistant')]] as const:[]),
    ['records',ClipboardList,teacher?t('السجل','Records'):t('إنجازاتي','Achievements')],
    ...(student?[['store',ShoppingBag,t('المتجر','Store')]] as const:[]),
    ['chat',MessageCircle,t('المحادثات','Conversations')],
    ['more',Ellipsis,t('المزيد','More')],
  ] as const
  const extras = [
    ['lessons',CalendarDays,t('جلسات التسميع','Live sessions')],['exams',CalendarDays,t('الاختبارات','Assessments')],['leaves',UserCheck,t('الاستئذانات','Leave requests')],
  ] as const
  const assistantOpen=Boolean(workspaceVisible&&teacher&&page==='assistant')
  const chatOpen=workspaceVisible&&page==='chat'
  const focusedWorkspace=assistantOpen||chatOpen
  const teacherNavigation=workspaceVisible&&data.user?.role==='teacher'&&!focusedWorkspace
  const incomingCall=workspaceVisible&&!chatOpen&&data.calls?.some(call=>call.to===data.user?.id&&callState(call)==='ringing')
  const incomingReminder=workspaceVisible&&data.user?.role==='teacher'&&!chatOpen&&!wizard&&notices.find(notice=>notice.recordReminder)
  const activeChatCall=chatOpen&&data.calls?.some(call=>{
    const status=callState(call)
    return status==='ringing'||status==='accepted'&&Date.now()-Date.parse(call.updatedAt)<30_000
  })
  useEffect(()=>{if(chatOpen)refreshWorkspace.current()},[chatOpen])
  useEffect(()=>{
    if(!activeChatCall)return
    const timer=window.setInterval(()=>refreshWorkspace.current(),1750)
    return ()=>window.clearInterval(timer)
  },[activeChatCall])
  const label=[...nav,...extras].find(([p])=>p===page)?.[2]||t('الرئيسية','Home')
  const userName=data.sample&&en?({admin:'Abdulrahman Al-Sarhan',teacher:'Abdulrahman Al-Sarhan',student:'Abdullah Al-Shehri',parent:'Student guardian'} as Record<string,string>)[role]:data.user?.name
  async function lessonRtc(id:string):Promise<LessonCredentials> {
    const result=await fetch('/api/lesson-rtc',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id})})
    const value=await result.json()
    if(!result.ok)throw new Error(value.error||t('تعذر الوصول إلى غرفة الوسائط','Could not access the media room'))
    return value
  }
  const workspace = {data,en,t,post,go,tell,open,lessonRtc,refresh:()=>refreshWorkspace.current()}
  const signOut = useCallback(async (next:Page) => {
    if(!auth)return
    const {endPhone}=await import('./phone')
    if(token)await disableDevicePush(token).catch(()=>{})
    await endPhone(auth)
    setPermissions(false)
    setData(emptyData);setSession({token:'',uid:''});setUnregistered(false);setWizard(undefined);setSessionExpired(false);setLoadError('')
    refreshedUid.current=''
    go(next)
  },[auth,go,token])
  const exit = () => signOut(adminPage?'admin':'home')
  useEffect(()=>{
    if(data.accountAccess!=='closed'||!token||!auth)return
    void signOut('home').then(()=>tell(en?'Your platform account has been deleted.':'حُذف حسابك من المنصة وأُغلقت الجلسة.')).catch(error=>tell(error.message,true))
  },[data.accountAccess,token,auth,en,signOut,tell])
  const openPhone = () => { if(adminPage)go('home'); changePhone(true) }
  const loadingLabel=t('جارٍ التحميل','Loading')
  const phoneProps={auth,availability:phoneAvailability,retry:()=>retryPhone(n=>n+1)}
  const adminContent = adminAccess
    ? <Suspense fallback={<div className="loading-layout" aria-label={loadingLabel}><div/><div/><div/></div>}><Admin liveRecords={liveRecords} online={online}/></Suspense>
    : token||data.user
      ? <div className="panel"><Empty title={t('صلاحية الإدارة مطلوبة','Administration access required')} body={t('يمكنك المتابعة باستخدام حساب مدير معتمد.','Use an authorized administration account to continue.')} action={token?<button className="btn btn-outline" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button>:undefined}/></div>
      : <Suspense fallback={<div className="loading-layout" aria-label={loadingLabel}><div/></div>}><PhoneSignIn {...phoneProps} administration/></Suspense>
  return <Context.Provider value={workspace}>
    <div data-role={show?data.user?.role:undefined} className={['app-shell',workspaceVisible?'':'intro-shell',assistantOpen?'assistant-shell':'',chatOpen?'chat-shell':'',teacherNavigation?'teacher-navigation':'',adminPage&&adminAccess?'admin-shell':''].filter(Boolean).join(' ')}>
      {workspaceVisible&&<aside className="sidebar">
        <button className="brand-button" onClick={()=>go('home')} aria-label={t('الصفحة الرئيسية','Home')}><Brand/></button>
        <div className="sidebar-divider"/>
        <nav aria-label={t('القائمة الرئيسية','Main navigation')}>
          <p className="sidebar-label">{t('مساحة العمل','Workspace')}</p>
          {nav.map(([p,Icon,label])=><button key={p} onClick={()=>go(p)} className={'nav-item '+(p===page?'active':'')} aria-current={p===page?'page':undefined}><Icon size={20} strokeWidth={1.8}/><span>{label}</span>{p===page&&<i/>}</button>)}
          <p className="sidebar-label second-label">{t('إدارة الحلقة','Circle activities')}</p>
          {extras.map(([p,Icon,label])=><button key={p} onClick={()=>go(p)} className={'nav-item '+(p===page?'active':'')} aria-current={p===page?'page':undefined}><Icon size={19} strokeWidth={1.8}/><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className="install-tile" onClick={()=>{if(install)void install.prompt();else go('more')}}><span><ArrowDownToLine size={18}/></span><div><strong>{t('تثبيت التطبيق','Install app')}</strong><small>{t('وصول أسرع من جهازك','Quick access from your device')}</small></div></button>
          <div className="sidebar-divider"/>
          <div className="sidebar-profile"><span className="profile-avatar">{en?'A':'ع'}</span><div><strong>{userName}</strong><small><RoleName role={data.sample&&role==='admin'?'teacher':data.user?.role||''}/></small></div><button className="icon-button mini" aria-label={t('إعدادات الحساب','Account settings')} onClick={()=>go('more')}><Ellipsis size={18}/></button></div>
        </div>
      </aside>}
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-title">{focusedWorkspace?<>
            <button className="workspace-home" type="button" onClick={()=>go('home')}
              aria-label={t('العودة إلى الرئيسية','Return to home')}><Home size={17}/><span>{t('الرئيسية','Home')}</span></button>
            <strong className="workspace-section-title">{label}</strong>
          </>:workspaceVisible?<><div className="mobile-brand"><Brand small/></div><div className="breadcrumbs"><span><Home size={15}/>{t('مساحة العمل','Workspace')}</span><i>/</i><strong>{page==='home'&&teacher?t('لوحة المحفّظ','Teacher dashboard'):label}</strong></div></>:<Brand/>}</div>
          <div className="topbar-actions">
            {workspaceVisible&&!teacherNavigation&&!focusedWorkspace&&<button className="icon-button mobile-menu-trigger" type="button" aria-label={t('فتح قائمة التنقّل','Open navigation menu')} aria-haspopup="dialog" aria-expanded={openPanel==='navigation'} onClick={()=>setOpenPanel('navigation')}><Menu size={21}/></button>}
            <button className="lang-button" onClick={changeLanguage} aria-label={t('التبديل إلى الإنجليزية','Switch to Arabic')}><Globe size={17}/><span>{t('English','العربية')}</span></button>
            {(workspaceVisible||adminAccess)&&<>
              {!token&&<button type="button" className="phone-topbar" onClick={openPhone} aria-label={t('الدخول أو التسجيل بالجوال','Sign in or register by phone')}><Smartphone size={17}/><span>{t('الدخول بالجوال','Mobile sign-in')}</span></button>}
              <div className="topbar-rule" />
              <div className="relative"><button className="icon-button notification-trigger" onClick={()=>setOpenPanel(openPanel==='notices'?'':'notices')} aria-label={t('الإشعارات','Notifications')} aria-expanded={openPanel==='notices'}><Bell size={21}/>{notices.length>0&&<i/>}</button>
              {openPanel==='notices'&&<NotificationList items={availableNotices} now={noticeTime} open={openNotice}
                permissions={token?()=>{setOpenPanel('');setPermissions(true)}:undefined}/>}</div>
              <div className="relative"><button className="profile-trigger" onClick={()=>setOpenPanel(openPanel==='profile'?'':'profile')} aria-expanded={openPanel==='profile'} aria-label={t('الحساب','Account')}><span className="profile-avatar">{en?'A':'ع'}</span><ChevronDown size={15}/></button>
              {openPanel==='profile'&&<div className="popover profile-pop"><strong>{userName}</strong><small><RoleName role={data.user?.role||''}/></small>{adminAccess&&!adminPage&&<button onClick={()=>go('admin')}><ShieldCheck size={16}/>{t('لوحة الإدارة','Administration')}</button>}{adminPage?<button onClick={()=>{setOpenPanel('');setPermissions(true)}}><Bell size={16}/>{t('أذونات وتنبيهات الجهاز','Device permissions and alerts')}</button>
                :<button onClick={()=>go('more')}>{t('إعدادات الحساب','Account settings')}</button>}{token?<button onClick={()=>void exit()}><LogOut size={16}/>{t('تسجيل الخروج','Sign out')}</button>:<button onClick={()=>{setOpenPanel('');openPhone()}}><LogIn size={16}/>{t('الدخول بالجوال','Mobile sign-in')}</button>}</div>}
              </div>
            </>}
          </div>
        </header>
        <main className={'main-content'+(assistantOpen?' assistant-content':'')+(chatOpen?' chat-main':'')} id="main">
          {availableUpdate&&!phone&&(!adminPage||token)&&<div className="update-banner" role="status"><span>{t('يتوفر تحديث للتطبيق','An app update is available')}</span><button className="btn btn-outline compact" type="button" onClick={()=>applyAppUpdate(availableUpdate)}>{t('تحديث الآن','Update now')}</button></div>}
          {incomingCall&&<div className="update-banner" role="status"><span>{t('لديك مكالمة واردة','You have an incoming call')}</span>
            <button className="btn btn-outline compact" type="button" onClick={()=>go('chat')}>{t('فتح الدردشة','Open chat')}</button></div>}
          {workspaceVisible&&!chatOpen&&page!=='assistant'&&<AnnouncementFeed key={data.user?.id}/>}
          {incomingReminder&&<div className="update-banner record-reminder-banner" role="status">
            <span>{en&&incomingReminder.bodyEn?incomingReminder.bodyEn:incomingReminder.body}</span>
            <button className="btn btn-outline compact" type="button" onClick={()=>openNotice(incomingReminder)}>{t('فتح سجل الطالب','Open student record')}</button>
            <button className="icon-button mini" type="button" aria-label={t('تحديد التنبيه كمقروء','Mark reminder read')} onClick={()=>void post('notice-read',{id:incomingReminder.id}).catch(e=>tell(e.message,true))}><X size={16}/></button>
          </div>}
          {!online&&<div className="offline-banner"><WifiOff size={17}/>{t('أنت غير متصل. سيستأنف حفظ العمليات المفتوحة عند عودة الاتصال.','You are offline. Open changes can resume on reconnection.')}</div>}
          {loadingView?<Starting/>:loadError?<div className="panel"><Empty title={t('تعذر تحميل المنصة','Could not load the workspace')} body={loadError} action={sessionExpired?<button className="btn btn-primary" onClick={()=>void exit()}>{t('تسجيل الدخول مجددًا','Sign in again')}</button>:<button className="btn btn-primary" onClick={()=>setRecheck(n=>n+1)}>{t('إعادة المحاولة','Retry')}</button>}/></div>:data.accountAccess?<AccountAccess status={data.accountAccess} signOut={exit}/>:adminPage?adminContent:unregistered?<Registration busy={registering} exit={()=>void exit()} submit={async event=>{
            event.preventDefault()
            setRegistering(true)
            try{await post('register',Object.fromEntries(new FormData(event.currentTarget)))}
            catch(error){tell((error as Error).message,true)}
            finally{setRegistering(false)}
          }}/>:data.user?.status==='pending'||data.user?.status==='disabled'?<div className="panel"><Empty title={data.user.status==='pending'?t('طلبك بانتظار الاعتماد','Registration is pending') : t('الحساب موقوف','Account suspended')} body={t('تواصل مع إدارة الحلقات للاستفسار.','Contact the circle administration for details.')} action={<button className="btn btn-outline" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button>}/></div>:!show?<Welcome signIn={openPhone}/>:
          <div className={'screen'+(assistantOpen?' assistant-screen':'')+(chatOpen?' chat-screen':'')} key={page+role}>{page==='assistant'&&teacher?<Assistant/>:page==='records'?<Records/>:page==='chat'?<ChatPage showPermissions={token?()=>setPermissions(true):undefined}/>:page==='more'?<More showPermissions={()=>setPermissions(true)} changeLanguage={changeLanguage} install={install} currentRole={role} switchRole={r=>{setRole(r);go('home')}}/>:page==='store'&&student?<Store/>:page==='lessons'?<LessonCenter/>:page==='exams'?<Exams/>:page==='leaves'?<Leaves/>:teacher?<Dashboard/>:<StudentHome/>}</div>}
        </main>
      </div>
      {teacherNavigation&&<nav className="teacher-bottom-nav" aria-label={t('قائمة المحفّظ السفلية','Teacher bottom navigation')}>
        {nav.map(([item,Icon,title])=><button key={item} type="button" aria-current={item===page?'page':undefined} aria-label={title} onClick={()=>go(item)}>
          <Icon size={21}/><span>{item==='assistant'?t('المساعد','Assistant'):title}</span>
        </button>)}
      </nav>}
      {workspaceVisible&&openPanel==='navigation'&&<Modal title={t('القائمة الرئيسية','Main navigation')} close={()=>setOpenPanel('')} appearance="mobile-menu"><nav className="modal-body mobile-menu-links">{[...nav,...extras].map(([p,Icon,title])=><button type="button" key={p} aria-current={p===page?'page':undefined} onClick={()=>go(p)}><Icon size={19}/>{title}</button>)}</nav></Modal>}
    </div>
    {permissions&&show&&token&&<DevicePermissions token={token} close={()=>setPermissions(false)}/>}
    {wizard&&teacher&&(workspaceVisible||adminPage&&adminAccess)&&<EntryWizard {...wizard} close={()=>setWizard(undefined)}/>}
    {phone&&!adminPage&&!token&&<Suspense fallback={null}><PhoneSignIn {...phoneProps} close={()=>changePhone(false)}/></Suspense>}
    {toast&&<div className={'toast '+(toast.error?'toast-error':'')} role={toast.error?'alert':'status'}>{toast.error?<CircleAlert size={19}/>:<Check size={19}/>}<span>{toast.text}</span><button className="icon-button mini" onClick={()=>setToast(undefined)} aria-label={t('إغلاق','Close')}><X size={16}/></button></div>}
  </Context.Provider>
}
createRoot(document.getElementById('root')!).render(<App/>)
