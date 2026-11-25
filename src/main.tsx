import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, Bell, BookOpen, CalendarDays, Check, ChevronDown, CircleAlert, ClipboardList, Ellipsis, Globe, Home, LogIn, LogOut, MessageCircle, ShieldCheck, ShoppingBag, Sparkles, UserCheck, WifiOff, X } from 'lucide-react'
import { idFor, type Daily, type Student, type View } from './domain'
import { Context, Brand, Empty, RoleName, type Page, type Tr, type WizardMode } from './ui'
import { Dashboard, StudentHome } from './dashboard'
import { EntryWizard } from './wizard'
import { Assistant } from './assistant'
import { Records } from './records'
import { ChatPage, Exams, Leaves, More, Store } from './features'
import { Admin } from './admin'
import type { PhoneAuth } from './phone'
import './styles.css'

type InstallEvent = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}
const pages = ['home','assistant','records','chat','more','admin','store','exams','leaves']
const currentPage = ():Page => pages.includes(location.hash.slice(1)) ? location.hash.slice(1) as Page : 'home'
const emptyData:View = {
  user:null,date:'',revision:0,phoneEnabled:false,sample:false,students:[],users:[],circles:[],daily:[],closed:[],notices:[],links:[],prizes:[],orders:[],exams:[],leaves:[],rules:{memorization:4,review:4,attendance:2,chat:true},chats:[],audit:[],
}
const PhoneModal = lazy(()=>import('./phone').then(m=>({default:m.PhoneModal})))
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
  const [token,setToken] = useState('')
  const [data,setData] = useState<View>(emptyData)
  const [loading,setLoading] = useState(true)
  const [loadError,setLoadError] = useState('')
  const [openPanel,setOpenPanel] = useState<'notices'|'profile'|''>('')
  const [phone,setPhone] = useState(false)
  const [toast,setToast] = useState<{text:string;error:boolean}>()
  const [wizard,setWizard] = useState<{student?:Student;mode:WizardMode;preset?:Partial<Daily>}>()
  const [online,setOnline] = useState(navigator.onLine)
  const [install,setInstall] = useState<InstallEvent|null>(null)
  const [registering,setRegistering] = useState(false)
  const [recheck,setRecheck] = useState(0)
  const [unregistered,setUnregistered] = useState(false)
  const t:Tr = (ar,english)=>en?english:ar
  const go = (p:Page) => { setPage(p);setOpenPanel(''); if(currentPage()!==p)location.hash=p==='home'?'home':p;window.scrollTo({top:0,behavior:'instant'}) }
  const tell = useCallback((text:string,error=false)=>setToast({text,error}),[])
  const changeLanguage = ()=>setEn(!en)
  useEffect(()=>{document.documentElement.lang=en?'en':'ar';document.documentElement.dir=en?'ltr':'rtl';localStorage.setItem('halaqat-language',en?'en':'ar')},[en])
  useEffect(()=>{
    const nav=()=>setPage(currentPage())
    const change=()=>setOnline(navigator.onLine)
    const capture=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent)}
    window.addEventListener('hashchange',nav);window.addEventListener('online',change);window.addEventListener('offline',change)
    window.addEventListener('beforeinstallprompt',capture)
    return ()=>{window.removeEventListener('hashchange',nav);window.removeEventListener('online',change);window.removeEventListener('offline',change);window.removeEventListener('beforeinstallprompt',capture)}
  },[])
  useEffect(()=>{
    let active=true
    if(!navigator.onLine){setAuthReady(true);return}
    fetch('/api/config').then(async res=>res.ok?await res.json() as {firebase?:unknown}:{}).then(async config=>{
      if(!config.firebase||!active)return
      const {connectPhone}=await import('./phone')
      const next=await connectPhone(setToken)
      if(active)setAuth(next)
    }).catch(()=>{}).finally(()=>{if(active)setAuthReady(true)})
    return ()=>{active=false}
  },[])
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
        setUnregistered(Boolean(token&&!result.user))
        setLoadError('')
      } catch(e){
        if(active&&initial)setLoadError((e as Error).message)
      } finally{if(active&&initial)setLoading(false)}
    }
    void pull(true)
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)void pull()},6500)
    const refresh=()=>{if(navigator.onLine)void pull()}
    window.addEventListener('online',refresh);window.addEventListener('focus',refresh)
    return ()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh)}
  },[authReady,token,role,recheck])
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
    setUnregistered(Boolean(token&&!result.user))
    return result
  }
  const open = (student?:Student,mode:WizardMode='recite',preset?:Partial<Daily>) => setWizard({student,mode,preset})
  const teacher = data.user?.role==='teacher'||data.user?.role==='admin'
  const student=data.user?.role==='student'
  const notices=data.notices.filter(n=>!n.readBy.includes(data.user?.id||''))
  const show = !loading&&!loadError&&data.user?.status==='active'
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
  const label=[...nav,...extras].find(([p])=>p===page)?.[2]||t('الرئيسية','Home')
  const userName=data.sample&&en?({admin:'Abdulrahman Al-Sarhan',teacher:'Abdulrahman Al-Sarhan',student:'Abdullah Al-Shehri',parent:'Student guardian'} as Record<string,string>)[role]:data.user?.name
  const workspace = {data,en,t,post,go,tell,open}
  const exit = async () => {if(auth){const {endPhone}=await import('./phone');await endPhone(auth);setToken('');go('home')}}
  return <Context.Provider value={workspace}>
    <div className={'app-shell '+(show?'':'intro-shell')}>
      {show&&<aside className="sidebar">
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
          <div className="topbar-title">{show?<><div className="mobile-brand"><Brand small/></div><div className="breadcrumbs"><span><Home size={15}/>{t('مساحة العمل','Workspace')}</span><i>/</i><strong>{page==='home'&&teacher?t('لوحة المحفّظ','Teacher dashboard'):label}</strong></div></>:<Brand/>}</div>
          <div className="topbar-actions">
            <button className="lang-button" onClick={changeLanguage} aria-label={t('التبديل إلى الإنجليزية','Switch to Arabic')}><Globe size={17}/><span>{t('English','العربية')}</span></button>
            {show&&<>
              <div className="topbar-rule" />
              <div className="relative"><button className="icon-button notification-trigger" onClick={()=>setOpenPanel(openPanel==='notices'?'':'notices')} aria-label={t('الإشعارات','Notifications')} aria-expanded={openPanel==='notices'}><Bell size={21}/>{notices.length>0&&<i/>}</button>
              {openPanel==='notices'&&<div className="popover notifications"><div className="section-title"><h2>{t('الإشعارات','Notifications')}</h2><button className="text-button" onClick={()=>void post('notice-read').catch(e=>tell(e.message,true))}>{t('تحديد الكل كمقروء','Mark all read')}</button></div>
                {data.notices.slice(0,30).map(n=><button key={n.id} className={'notice-row '+(!n.readBy.includes(data.user?.id||'')?'unread':'')} onClick={()=>void post('notice-read',{id:n.id}).catch(e=>tell(e.message,true))}><span className="stat-icon tint-green"><Bell size={16}/></span><span><strong>{en&&n.en?n.en:n.title}</strong><small>{en&&n.bodyEn?n.bodyEn:n.body}</small></span></button>)}
                {!data.notices.length&&<Empty title={t('لا توجد إشعارات','No notifications')}/>}
              </div>}</div>
              <div className="relative"><button className="profile-trigger" onClick={()=>setOpenPanel(openPanel==='profile'?'':'profile')} aria-expanded={openPanel==='profile'} aria-label={t('الحساب','Account')}><span className="profile-avatar">{en?'A':'ع'}</span><ChevronDown size={15}/></button>
              {openPanel==='profile'&&<div className="popover profile-pop"><strong>{userName}</strong><small><RoleName role={data.user?.role||''}/></small><button onClick={()=>go('more')}>{t('إعدادات الحساب','Account settings')}</button>{token?<button onClick={()=>void exit()}><LogOut size={16}/>{t('تسجيل الخروج','Sign out')}</button>:<button onClick={()=>{setOpenPanel('');setPhone(true)}}><LogIn size={16}/>{t('الدخول بالجوال','Mobile sign-in')}</button>}</div>}
              </div>
            </>}
          </div>
        </header>
        <main className="main-content" id="main">
          {!online&&<div className="offline-banner"><WifiOff size={17}/>{t('أنت غير متصل. سيستأنف حفظ العمليات المفتوحة عند عودة الاتصال.','You are offline. Open changes can resume on reconnection.')}</div>}
          {loading||!authReady?<div className="loading-layout" aria-label={t('جارٍ التحميل','Loading')}><div/><div/><div/></div>:loadError?<div className="panel"><Empty title={t('تعذر تحميل المنصة','Could not load the workspace')} body={loadError} action={<button className="btn btn-primary" onClick={()=>setRecheck(n=>n+1)}>{t('إعادة المحاولة','Retry')}</button>}/></div>:unregistered?<section className="panel section-panel intro-card"><h1>{t('إنشاء حساب','Create an account')}</h1><p>{t('أرسل طلبك إلى إدارة الحلقات لاعتماد الحساب.','Submit your request for approval.')}</p><form className="form-stack" onSubmit={async e=>{e.preventDefault();setRegistering(true);try{await post('register',Object.fromEntries(new FormData(e.currentTarget)))}catch(e){tell((e as Error).message,true)}finally{setRegistering(false)}}}><label>{t('الاسم الكامل','Full name')}<input name="name" maxLength={90} required/></label><label>{t('نوع الحساب','Account type')}<select name="role"><option value="teacher">{t('محفّظ','Teacher')}</option><option value="student">{t('طالب','Student')}</option><option value="parent">{t('ولي أمر','Guardian')}</option></select></label><button className="btn btn-primary" disabled={registering}>{t('إرسال طلب التسجيل','Submit registration')}</button></form><button className="text-button" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button></section>:data.user?.status==='pending'||data.user?.status==='disabled'?<div className="panel"><Empty title={data.user.status==='pending'?t('طلبك بانتظار الاعتماد','Registration is pending') : t('الحساب موقوف','Account suspended')} body={t('تواصل مع إدارة الحلقات للاستفسار.','Contact the circle administration for details.')} action={<button className="btn btn-outline" onClick={()=>void exit()}>{t('تسجيل الخروج','Sign out')}</button>}/></div>:!show?<section className="panel section-panel intro-card"><Brand/><h1>{t('مرحبًا بك في حلقات الخير','Welcome to Al-Khair Quran Circles')}</h1><p>{t('سجّل الدخول لمتابعة الحفظ والمراجعة والحضور.','Sign in to follow recitation, revision and attendance.')}</p><button className="btn btn-primary" onClick={()=>setPhone(true)}><LogIn size={18}/>{t('الدخول برقم الجوال','Sign in with mobile')}</button></section>:
          <div className="screen" key={page+role}>{page==='assistant'&&teacher?<Assistant/>:page==='records'?<Records/>:page==='chat'?<ChatPage/>:page==='more'?<More changeLanguage={changeLanguage} install={install} currentRole={role} switchRole={r=>{setRole(r);go('home')}}/>:page==='admin'&&data.user?.role==='admin'?<Admin/>:page==='store'&&student?<Store/>:page==='exams'?<Exams/>:page==='leaves'?<Leaves/>:teacher?<Dashboard/>:<StudentHome/>}</div>}
        </main>
      </div>
      {show&&<nav className="mobile-nav" aria-label={t('القائمة الرئيسية','Main navigation')}>{nav.map(([p,Icon,label])=><button key={p} className={p===page?'active':''} aria-current={p===page?'page':undefined} onClick={()=>go(p)}><Icon size={21}/><span>{label}</span></button>)}</nav>}
    </div>
    {wizard&&show&&teacher&&<EntryWizard {...wizard} close={()=>setWizard(undefined)}/>}
    {phone&&<Suspense fallback={null}><PhoneModal auth={auth} close={()=>setPhone(false)}/></Suspense>}
    {toast&&<div className={'toast '+(toast.error?'toast-error':'')} role={toast.error?'alert':'status'}>{toast.error?<CircleAlert size={19}/>:<Check size={19}/>}<span>{toast.text}</span><button className="icon-button mini" onClick={()=>setToast(undefined)} aria-label={t('إغلاق','Close')}><X size={16}/></button></div>}
  </Context.Provider>
}
createRoot(document.getElementById('root')!).render(<App/>)
if(import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{})})
}
