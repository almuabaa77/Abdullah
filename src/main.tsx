import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, Bell, BookOpen, CalendarDays, Check, ChevronDown, CircleAlert, ClipboardList, Ellipsis, Globe, Home, LogIn, LogOut, MessageCircle, ShieldCheck, ShoppingBag, Sparkles, Smartphone, UserCheck, WifiOff, X } from 'lucide-react'
import { idFor, type Daily, type Student, type View } from './domain'
import { Context, Brand, Empty, RoleName, type Page, type Tr, type WizardMode } from './ui'
import { Dashboard, StudentHome } from './dashboard'
import { EntryWizard } from './wizard'
import { Assistant } from './assistant'
import { Records } from './records'
import { ChatPage, Exams, Leaves, More, Store } from './features'
import { AccountAccess } from './account-access'
import type { PhoneAuth, PhoneAvailability } from './phone'
import './styles.css'
import './workbench.css'

type InstallEvent = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
const pages = ['home','assistant','records','chat','more','admin','store','exams','leaves']
const currentPage = ():Page => {
  if (location.pathname === '/admin' || location.pathname === '/admin/') return 'admin'
  const fragment = location.hash.slice(1)
  return pages.includes(fragment) ? fragment as Page : 'home'
}
const emptyData:View = {
  user:null,date:'',revision:0,phoneEnabled:false,sample:false,students:[],users:[],circles:[],daily:[],closed:[],notices:[],links:[],prizes:[],orders:[],exams:[],leaves:[],rules:{memorization:4,review:4,attendance:2,chat:true},chats:[],audit:[],
}
const PhoneSignIn = lazy(()=>import('./phone').then(m=>({default:m.PhoneSignIn})))
const Admin = lazy(()=>import('./admin').then(m=>({default:m.Admin})))
async function request(token:string,role:string,body?:Record<string,unknown>,signal?:AbortSignal):Promise<View> {
  const response = await fetch('/api/workspace',{method:body?'POST':'GET',headers:{
    ...(body?{'Content-Type':'application/json'}:{}),
    ...(token?{'Authorization':'Bearer '+token}:{'X-Preview-Role':role}),
  },body:body?JSON.stringify(body):undefined,signal,cache:'no-store'})
  const value = await response.json() as View & {error?:string}
  if(!response.ok || value.error) throw new Error(value.error || 'Unable to load the workspace')
  return value
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
  const [token,setToken] = useState('')
  const [loadedToken,setLoadedToken] = useState('')
  const [data,setData] = useState<View>(emptyData)
  const [loading,setLoading] = useState(true)
  const [loadError,setLoadError] = useState('')
  const [openPanel,setOpenPanel] = useState<'notices'|'profile'|''>('')
  const [phone,setPhone] = useState(false)
  const [toast,setToast] = useState<{text:string;error:boolean}>()
  const [wizard,setWizard] = useState<{student?:Student;mode:WizardMode;preset?:Partial<Daily>;circleId?:string}>()
  const [online,setOnline] = useState(navigator.onLine)
  const seenNotices = useRef<{user:string;ids:Set<string>}>(undefined)
  const routedAdmin = useRef<string>(undefined)
  const [install,setInstall] = useState<InstallEvent|null>(null)
  const [registering,setRegistering] = useState(false)
  const [recheck,setRecheck] = useState(0)
  const [unregistered,setUnregistered] = useState(false)
  const t:Tr = (ar,english)=>en?english:ar
  const go = useCallback((p:Page,replace=false) => {
    const url = p==='admin' ? '/admin' : p==='home' ? '/' : '/#'+p
    if (location.pathname+location.hash!==url) {
      if (replace) history.replaceState(null,'',url)
      else history.pushState(null,'',url)
    }
    setPage(p);setOpenPanel('');setPhone(false)
    window.scrollTo({top:0,behavior:'instant'})
  },[])
  const tell = useCallback((text:string,error=false)=>setToast({text,error}),[])
  const changeLanguage = ()=>setEn(!en)
  useEffect(()=>{document.documentElement.lang=en?'en':'ar';document.documentElement.dir=en?'ltr':'rtl';localStorage.setItem('halaqat-language',en?'en':'ar')},[en])
  useEffect(()=>{
    const nav=()=>{
      const next=currentPage()
      if(next==='admin'&&location.pathname!=='/admin')history.replaceState(null,'','/admin')
      setPage(next);setOpenPanel('')
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
    setPhoneAvailability('loading')
    const receive=(next:string)=>{if(active)setToken(next)}
    const setup=async ()=>{
      try {
        const response=await fetch('/api/config',{signal:controller.signal})
        if(!response.ok)throw new Error()
        const {firebase}=await response.json()
        if(!active)return
        if(!firebase){setPhoneAvailability('disabled');return}
        const {connectPhone}=await import('./phone')
        const result=await connectPhone(firebase,receive)
        if(!active){result.unsubscribe();return}
        unsubscribe=result.unsubscribe
        setAuth(result.auth);setPhoneAvailability('ready')
      } catch {if(active)setPhoneAvailability('unavailable')}
      finally {if(active)setAuthReady(true)}
    }
    void setup()
    return ()=>{active=false;controller.abort();unsubscribe?.()}
  },[phoneAttempt])
  useEffect(()=>{
    if(!authReady)return
    const controller=new AbortController()
    let active = true
    setLoading(true);setLoadError('')
    const pull = async (initial = false) => {
      try {
        const result=await request(token,role,undefined,controller.signal)
        if(!active)return
        setData(previous=>initial||previous.user?.id!==result.user?.id||previous.revision<=result.revision?result:previous)
        setUnregistered(Boolean(token&&!result.user&&!result.accountAccess))
        setLoadError('')
        const adminId = token&&result.user?.role==='admin'&&result.user.status==='active' ? result.user.id : undefined
        if(adminId&&adminId!==routedAdmin.current&&currentPage()!=='admin')go('admin',true)
        routedAdmin.current=adminId
      } catch(e){
        if(active&&initial)setLoadError((e as Error).message)
      } finally{if(active&&initial){setLoadedToken(token);setLoading(false)}}
    }
    void pull(true)
    const timer=window.setInterval(()=>{if(navigator.onLine&&(document.visibilityState==='visible'||'Notification'in window&&Notification.permission==='granted'))void pull()},6500)
    const refresh=()=>{if(navigator.onLine)void pull()}
    window.addEventListener('online',refresh);window.addEventListener('focus',refresh)
    return ()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh)}
  },[authReady,token,role,recheck,go])
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
    setData(previous=>previous.user?.id!==result.user?.id||previous.revision<=result.revision?result:previous)
    setUnregistered(Boolean(token&&!result.user&&!result.accountAccess))
    return result
  }
  const open = (student?:Student,mode:WizardMode='recite',preset?:Partial<Daily>,circleId?:string) => setWizard({student,mode,preset,circleId})
  const teacher = data.user?.role==='teacher'||data.user?.role==='admin'
  const student=data.user?.role==='student'
  const notices=data.notices.filter(n=>!n.readBy.includes(data.user?.id||''))
  useEffect(()=>{
    const user=data.user?.id
    if(!user)return
    const seen=seenNotices.current
    if(!seen||seen.user!==user){seenNotices.current={user,ids:new Set(data.notices.map(n=>n.id))};return}
    const incoming=data.notices.filter(n=>!seen.ids.has(n.id)&&!n.readBy.includes(user))
    for(const n of data.notices)seen.ids.add(n.id)
    if(!incoming.length||document.visibilityState!=='hidden'||!('Notification'in window)||Notification.permission!=='granted'||!('serviceWorker'in navigator))return
    void navigator.serviceWorker.getRegistration().then(reg=>reg?.showNotification(en?'Al-Khair Quran Circles':'حلقات جامع الخير',{
      body:en?'You have new notifications.':'لديك إشعارات جديدة.',
      icon:'/assets/icon-192.png',tag:'halaqat-updates',
    })).catch(()=>{})
  },[data.notices,data.user?.id,en])

  const loadingView = loading||!authReady||loadedToken!==token
  const show = !loadingView&&!loadError&&data.user?.status==='active'
  const adminPage = page==='admin'
  const workspaceVisible=show&&!adminPage
  const adminAccess=show&&data.user?.role==='admin'
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
    ['exams',CalendarDays,t('الاختبارات','Assessments')],['leaves',UserCheck,t('الاستئذانات','Leave requests')],
    ...(data.user?.role==='admin'?[['admin',ShieldCheck,t('لوحة الإدارة','Administration')]] as const:[]),
  ] as const
  const assistantOpen=Boolean(show&&teacher&&page==='assistant')
  const label=[...nav,...extras].find(([p])=>p===page)?.[2]||t('الرئيسية','Home')
  const userName=data.sample&&en?({admin:'Abdulrahman Al-Sarhan',teacher:'Abdulrahman Al-Sarhan',student:'Abdullah Al-Shehri',parent:'Student guardian'} as Record<string,string>)[role]:data.user?.name
  const workspace = {data,en,t,post,go,tell,open}
  const signOut = useCallback(async (next:Page) => {
    if(!auth)return
    const {endPhone}=await import('./phone')
    await endPhone(auth)
    setData(emptyData);setToken('');setUnregistered(false);setWizard(undefined)
    routedAdmin.current=undefined
    go(next)
  },[auth,go])
  const exit = () => signOut(adminPage?'admin':'home')
  useEffect(()=>{
    if(data.accountAccess!=='closed'||!token||!auth)return
    void signOut('home').then(()=>tell(en?'Your platform account has been deleted.':'حُذف حسابك من المنصة وأُغلقت الجلسة.')).catch(error=>tell(error.message,true))
  },[data.accountAccess,token,auth,en,signOut,tell])
  const openPhone = () => { if(adminPage)go('home'); setPhone(true) }
  const loadingLabel=t('جارٍ التحميل','Loading')
  const phoneProps={auth,availability:phoneAvailability,retry:()=>retryPhone(n=>n+1)}
  const adminContent = adminAccess
    ? <Suspense fallback={<div className="loading-layout" aria-label={loadingLabel}><div/><div/><div/></div>}><Admin/></Suspense>
    : token||data.user
      ? <div className="panel"><Empty title={t('صلاحية الإدارة مطلوبة','Administration access required')} body={t('يمكنك المتابعة باستخدام حساب مدير معتمد.','Use an authorized administration account to continue.')} action={token?<button className="btn btn-outline" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button>:undefined}/></div>
      : <Suspense fallback={<div className="loading-layout" aria-label={loadingLabel}><div/></div>}><PhoneSignIn {...phoneProps} administration/></Suspense>
  return <Context.Provider value={workspace}>
    <div className={['app-shell',workspaceVisible?'':'intro-shell',assistantOpen?'assistant-shell':''].filter(Boolean).join(' ')}>
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
          <div className="topbar-title">{workspaceVisible?<><div className="mobile-brand"><Brand small/></div><div className="breadcrumbs"><span><Home size={15}/>{t('مساحة العمل','Workspace')}</span><i>/</i><strong>{page==='home'&&teacher?t('لوحة المحفّظ','Teacher dashboard'):label}</strong></div></>:<Brand/>}</div>
          <div className="topbar-actions">
            {adminPage&&<button className="icon-button" onClick={()=>go('home')} aria-label={t('العودة إلى المنصة','Back to the platform')} title={t('العودة إلى المنصة','Back to the platform')}><Home size={19}/></button>}
            <button className="lang-button" onClick={changeLanguage} aria-label={t('التبديل إلى الإنجليزية','Switch to Arabic')}><Globe size={17}/><span>{t('English','العربية')}</span></button>
            {(workspaceVisible||adminAccess)&&<>
              {!token&&<button type="button" className="phone-topbar" onClick={openPhone} aria-label={t('الدخول أو التسجيل بالجوال','Sign in or register by phone')}><Smartphone size={17}/><span>{t('الدخول بالجوال','Mobile sign-in')}</span></button>}
              <div className="topbar-rule" />
              <div className="relative"><button className="icon-button notification-trigger" onClick={()=>setOpenPanel(openPanel==='notices'?'':'notices')} aria-label={t('الإشعارات','Notifications')} aria-expanded={openPanel==='notices'}><Bell size={21}/>{notices.length>0&&<i/>}</button>
              {openPanel==='notices'&&<div className="popover notifications"><div className="section-title"><h2>{t('الإشعارات','Notifications')}</h2><button className="text-button" onClick={()=>void post('notice-read').catch(e=>tell(e.message,true))}>{t('تحديد الكل كمقروء','Mark all read')}</button></div>
                {data.notices.slice(0,30).map(n=><button key={n.id} className={'notice-row '+(!n.readBy.includes(data.user?.id||'')?'unread':'')} onClick={()=>void post('notice-read',{id:n.id}).catch(e=>tell(e.message,true))}><span className="stat-icon tint-green"><Bell size={16}/></span><span><strong>{en&&n.en?n.en:n.title}</strong><small>{en&&n.bodyEn?n.bodyEn:n.body}</small></span></button>)}
                {!data.notices.length&&<Empty title={t('لا توجد إشعارات','No notifications')}/>}
              </div>}</div>
              <div className="relative"><button className="profile-trigger" onClick={()=>setOpenPanel(openPanel==='profile'?'':'profile')} aria-expanded={openPanel==='profile'} aria-label={t('الحساب','Account')}><span className="profile-avatar">{en?'A':'ع'}</span><ChevronDown size={15}/></button>
              {openPanel==='profile'&&<div className="popover profile-pop"><strong>{userName}</strong><small><RoleName role={data.user?.role||''}/></small><button onClick={()=>go('more')}>{t('إعدادات الحساب','Account settings')}</button>{token?<button onClick={()=>void exit()}><LogOut size={16}/>{t('تسجيل الخروج','Sign out')}</button>:<button onClick={()=>{setOpenPanel('');openPhone()}}><LogIn size={16}/>{t('الدخول بالجوال','Mobile sign-in')}</button>}</div>}
              </div>
            </>}
          </div>
        </header>
        <main className={'main-content'+(assistantOpen?' assistant-content':'')} id="main">
          {!online&&<div className="offline-banner"><WifiOff size={17}/>{t('أنت غير متصل. سيستأنف حفظ العمليات المفتوحة عند عودة الاتصال.','You are offline. Open changes can resume on reconnection.')}</div>}
          {loadingView?<div className="loading-layout" aria-label={loadingLabel}><div/><div/><div/></div>:loadError?<div className="panel"><Empty title={t('تعذر تحميل المنصة','Could not load the workspace')} body={loadError} action={<button className="btn btn-primary" onClick={()=>setRecheck(n=>n+1)}>{t('إعادة المحاولة','Retry')}</button>}/></div>:data.accountAccess?<AccountAccess status={data.accountAccess} signOut={exit}/>:adminPage?adminContent:unregistered?<section className="panel section-panel intro-card signup-card"><div className="signup-verified"><Check size={16}/>{t('تم التحقق من رقم الجوال','Phone number verified')}</div><h1>{t('إكمال طلب التسجيل','Complete your registration')}</h1><p>{t('عرّفنا بنفسك واختر نوع الحساب. تراجع إدارة الحلقات الطلب قبل التفعيل.','Tell us about yourself and choose an account type. Administration reviews the request before activation.')}</p><form className="form-stack" onSubmit={async e=>{e.preventDefault();setRegistering(true);try{await post('register',Object.fromEntries(new FormData(e.currentTarget)))}catch(e){tell((e as Error).message,true)}finally{setRegistering(false)}}}><label>{t('الاسم الكامل','Full name')}<input name="name" autoComplete="name" maxLength={90} required/></label><label>{t('نوع الحساب','Account type')}<select name="role"><option value="teacher">{t('محفّظ','Teacher')}</option><option value="student">{t('طالب','Student')}</option><option value="parent">{t('ولي أمر','Guardian')}</option></select></label><button className="btn btn-primary" disabled={registering}>{t('إرسال طلب التسجيل','Submit registration')}</button></form><button className="text-button" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button></section>:data.user?.status==='pending'||data.user?.status==='disabled'?<div className="panel"><Empty title={data.user.status==='pending'?t('طلبك بانتظار الاعتماد','Registration is pending') : t('الحساب موقوف','Account suspended')} body={t('تواصل مع إدارة الحلقات للاستفسار.','Contact the circle administration for details.')} action={<button className="btn btn-outline" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button>}/></div>:!show?<section className="panel section-panel intro-card"><Brand/><h1>{t('مرحبًا بك في حلقات الخير','Welcome to Al-Khair Quran Circles')}</h1><p>{t('سجّل الدخول لمتابعة الحفظ والمراجعة والحضور.','Sign in to follow recitation, revision and attendance.')}</p><button className="btn btn-primary" onClick={()=>setPhone(true)}><LogIn size={18}/>{t('الدخول برقم الجوال','Sign in with mobile')}</button><a className="text-button" href="/admin" onClick={e=>{if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();go('admin')}}}>{t('دخول الإدارة','Administration sign-in')}</a></section>:
          <div className={'screen'+(assistantOpen?' assistant-screen':'')} key={page+role}>{page==='assistant'&&teacher?<Assistant/>:page==='records'?<Records/>:page==='chat'?<ChatPage/>:page==='more'?<More changeLanguage={changeLanguage} install={install} currentRole={role} switchRole={r=>{setRole(r);go('home')}}/>:page==='store'&&student?<Store/>:page==='exams'?<Exams/>:page==='leaves'?<Leaves/>:teacher?<Dashboard/>:<StudentHome/>}</div>}
        </main>
      </div>
      {workspaceVisible&&<nav className="mobile-nav" aria-label={t('القائمة الرئيسية','Main navigation')}>{nav.map(([p,Icon,label])=><button key={p} className={p===page?'active':''} aria-current={p===page?'page':undefined} onClick={()=>go(p)}><Icon size={21}/><span>{label}</span></button>)}</nav>}
    </div>
    {wizard&&workspaceVisible&&teacher&&<EntryWizard {...wizard} close={()=>setWizard(undefined)}/>}
    {phone&&!adminPage&&<Suspense fallback={null}><PhoneSignIn {...phoneProps} close={()=>setPhone(false)}/></Suspense>}
    {toast&&<div className={'toast '+(toast.error?'toast-error':'')} role={toast.error?'alert':'status'}>{toast.error?<CircleAlert size={19}/>:<Check size={19}/>}<span>{toast.text}</span><button className="icon-button mini" onClick={()=>setToast(undefined)} aria-label={t('إغلاق','Close')}><X size={16}/></button></div>}
  </Context.Provider>
}
createRoot(document.getElementById('root')!).render(<App/>)
if(import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{})})
}
