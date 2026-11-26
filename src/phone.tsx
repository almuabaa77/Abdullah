import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import { browserLocalPersistence, getAuth, initializeRecaptchaConfig, onIdTokenChanged, PhoneAuthProvider, setPersistence, signInWithCredential, signInWithPhoneNumber, signOut, type Auth } from 'firebase/auth'
import { Modal, useWorkspace, type Tr } from './ui'
import { asciiDigits, normalizeMobile } from './phone-number'
import { BrowserCheckError, prepareSmsVerifier } from './sms-verifier'

export type PhoneAuth = Auth
export type PhoneAvailability = 'loading'|'disabled'|'ready'|'unavailable'
export async function connectPhone(config:FirebaseOptions, receive:(token:string, uid:string)=>void) {
  const app = getApps().some(app=>app.name==='halaqat-phone') ? getApp('halaqat-phone') : initializeApp(config,'halaqat-phone')
  const auth = getAuth(app)
  await auth.authStateReady()
  // Migrate sessions from the previous session-only setting. The SDK stores and rotates credentials.
  await setPersistence(auth,browserLocalPersistence).catch(()=>{})
  const current = auth.currentUser
  receive(await current?.getIdToken() || '',current?.uid || '')
  const unsubscribe=onIdTokenChanged(auth,user=>{
    if(!user){receive('','');return}
    void user.getIdToken().then(token=>{if(auth.currentUser===user)receive(token,user.uid)}).catch(()=>{})
  })
  return {auth,unsubscribe}
}
const cooldownKey='halaqat-last-sms-request'
const pendingKey='halaqat-pending-sms'
const numberKey='halaqat-sms-number'
const cooldownMs=60_000
const recoveryMs=10*cooldownMs
type Captcha = ReturnType<typeof prepareSmsVerifier>
type PendingSms = {destination:string; verificationId:string; requestedAt:number}

function lastSmsRequest() {
  try {
    const last=Number(sessionStorage.getItem(cooldownKey))
    return last>0&&last<=Date.now()?last:0
  } catch {return 0}
}

function recoverSms():PendingSms|undefined {
  try {
    const pending=JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null')
    const age=Date.now()-pending?.requestedAt
    if(age>=0&&age<recoveryMs&&typeof pending.destination==='string'&&normalizeMobile(pending.destination)===pending.destination&&typeof pending.verificationId==='string'&&pending.verificationId)return pending
    sessionStorage.removeItem(pendingKey)
  } catch {/* Storage may be unavailable. */}
}

function rememberSms(pending?:PendingSms) {
  try {
    if(pending)sessionStorage.setItem(pendingKey,JSON.stringify(pending))
    else sessionStorage.removeItem(pendingKey)
  } catch {/* Verification still works without session storage. */}
}

function rememberNumber(destination?:string) {
  try {
    if(destination)sessionStorage.setItem(numberKey,JSON.stringify({destination,time:Date.now()}))
    else sessionStorage.removeItem(numberKey)
  } catch {/* The page can keep the number in memory. */}
}

function recoverNumber() {
  try {
    const saved=JSON.parse(sessionStorage.getItem(numberKey) ?? 'null')
    const age=Date.now()-saved?.time
    if(age>=0&&age<recoveryMs&&typeof saved.destination==='string')return normalizeMobile(saved.destination) ?? ''
    sessionStorage.removeItem(numberKey)
  } catch {/* Storage may be unavailable. */}
  return ''
}

function writeSmsTime(time:number) {
  try {
    if(time)sessionStorage.setItem(cooldownKey,String(time))
    else sessionStorage.removeItem(cooldownKey)
  } catch {/* The countdown still works in memory. */}
}

function errorCode(error:unknown) {
  return typeof error==='object'&&error!==null&&'code' in error ? error.code : ''
}

function browserCheckRejected(error:unknown) {
  return error instanceof BrowserCheckError || [
    'auth/captcha-check-failed','auth/invalid-app-credential','auth/missing-app-credential','auth/missing-recaptcha-token',
  ].includes(String(errorCode(error)))
}

function smsError(error:unknown,t:Tr) {
  if(browserCheckRejected(error))return t('تعذر إكمال فحص المتصفح. اطلب الرمز مجددًا لإعادة الفحص.','The browser check could not finish. Request the code again to restart the check.')
  switch(errorCode(error)) {
    case 'auth/invalid-phone-number': return t('تحقق من رقم الجوال ورمز الدولة.','Check the mobile number and its country code.')
    case 'auth/invalid-verification-code': return t('الرمز غير صحيح. تحقق من الرسالة وحاول مجددًا.','That code is incorrect. Check the message and try again.')
    case 'auth/code-expired':
    case 'auth/session-expired': return t('انتهت صلاحية الرمز. اطلب رمزًا جديدًا.','That code expired. Request a new one.')
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded': return t('وصلت إلى حد طلبات الرموز مؤقتًا. حاول لاحقًا.','The temporary SMS limit was reached. Try again later.')
    case 'auth/network-request-failed': return t('تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.','Check your internet connection and try again.')
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
    case 'auth/billing-not-enabled':
    case 'auth/app-not-authorized': return t('خدمة الرسائل بحاجة إلى ضبط المشروع أو تفويض هذا النطاق في Firebase.','The SMS service needs Firebase configuration or domain authorization.')
    default: return t('تعذر إتمام التحقق الآن. أعد المحاولة.','Verification could not be completed. Try again.')
  }
}

export function PhoneSignIn({auth,availability,retry,close,administration=false}:{auth:PhoneAuth|null;availability:PhoneAvailability;retry:()=>void;close?:()=>void;administration?:boolean}) {
  const {t,en} = useWorkspace()
  const [phone,setPhone] = useState(recoverNumber)
  const [code,setCode] = useState('')
  const [pending,setPending] = useState(recoverSms)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState<'send'|'verify'|''>('')
  const [last,setLast] = useState(()=>Math.max(lastSmsRequest(),pending?.requestedAt??0))
  const [now,setNow] = useState(Date.now)
  const [slow,setSlow] = useState(false)
  const [stage,setStage] = useState<'browser'|'manual'|'provider'>('browser')
  const captchaHost=useRef<HTMLDivElement>(null)
  const captcha=useRef<Captcha|null>(null)
  const activeCaptcha=useRef<Captcha|null>(null)
  const inFlight=useRef(false)
  const codeField=useRef<HTMLInputElement>(null)
  const phoneField=useRef<HTMLInputElement>(null)
  const seconds=Math.ceil(Math.max(0,last+cooldownMs-now)/1000)
  const target=normalizeMobile(phone)
  useEffect(()=>{
    const host=captchaHost.current
    if(!auth||availability!=='ready'||!host)return
    auth.languageCode=en?'en':'ar'
    void initializeRecaptchaConfig(auth).catch(()=>{})
    const prepared=prepareSmsVerifier(auth,host)
    captcha.current=prepared
    return ()=>{
      const current=captcha.current
      captcha.current=null
      if(current&&current!==activeCaptcha.current)current.clear()
    }
  },[auth,availability,en])
  useEffect(()=>{if(pending)codeField.current?.focus();else if(availability==='ready'&&matchMedia('(pointer:fine)').matches)phoneField.current?.focus()},[pending,availability])
  useEffect(()=>{
    if(seconds<=0)return
    const timer=window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[seconds>0])
  useEffect(()=>{
    if(busy!=='send'||stage!=='browser')return
    const timer=window.setTimeout(()=>setSlow(true),5000)
    return ()=>window.clearTimeout(timer)
  },[busy,stage])

  async function send(value:string) {
    const host=captchaHost.current
    const destination=normalizeMobile(value)
    const previousLast=Math.max(last,lastSmsRequest())
    if(!auth||!host||!destination||inFlight.current||previousLast+cooldownMs>Date.now())return
    inFlight.current=true
    setBusy('send');setStage('browser');setSlow(false);setError('')
    rememberNumber(destination)
    let dispatchedAt=0
    const recordDispatch=()=>{dispatchedAt=Date.now();writeSmsTime(dispatchedAt);setStage('provider')}
    const clearDispatch=()=>{if(dispatchedAt&&lastSmsRequest()===dispatchedAt)writeSmsTime(previousLast);dispatchedAt=0}
    const request=async (check:Captcha)=>{
      activeCaptcha.current=check
      check.verifier.onVerified=recordDispatch
      try {return await signInWithPhoneNumber(auth,destination,check.verifier)}
      finally {
        check.verifier.onVerified=undefined
        activeCaptcha.current=null
        if(captcha.current!==check)check.clear()
      }
    }
    try {
      let result
      const automatic=captcha.current ?? prepareSmsVerifier(auth,host)
      captcha.current=automatic
      try {result=await request(automatic)}
      catch(err) {
        if(!browserCheckRejected(err)||captcha.current!==automatic||!host.isConnected)throw err
        clearDispatch()
        captcha.current=null
        automatic.clear()
        const manual=prepareSmsVerifier(auth,host,true)
        captcha.current=manual
        setStage('manual')
        try {result=await request(manual)}
        finally {
          if(captcha.current===manual){manual.clear();captcha.current=null}
        }
      }
      const sent=Date.now()
      setLast(sent);setNow(sent)
      const next={destination,verificationId:result.verificationId,requestedAt:sent}
      setPending(next);setCode('');rememberSms(next)
      writeSmsTime(sent)
    } catch(err) {
      if(errorCode(err)==='auth/network-request-failed') {
        const uncertain=dispatchedAt||Date.now()
        writeSmsTime(uncertain);setLast(uncertain);setNow(Date.now())
        setError(t('لم يصل تأكيد إرسال الرمز. يمكنك طلب رمز جديد بعد انتهاء العدّاد.','SMS dispatch could not be confirmed. You can request another code when the timer ends.'))
      } else {
        clearDispatch()
        setError(smsError(err,t))
      }
    } finally {inFlight.current=false;setBusy('')}
  }

  function editNumber() {
    if(pending)setPhone(pending.destination)
    setPending(undefined);setCode('');setError('');rememberSms()
  }

  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if(inFlight.current)return
    if(!pending){await send(phone);return}
    if(!auth||code.length!==6)return
    inFlight.current=true
    setError('');setBusy('verify')
    try {
      await signInWithCredential(auth,PhoneAuthProvider.credential(pending.verificationId,code))
      rememberSms();rememberNumber();close?.()
    }
    catch(err){
      const reason=errorCode(err)
      if(reason==='auth/code-expired'||reason==='auth/session-expired')editNumber()
      setError(smsError(err,t))
    }
    finally{inFlight.current=false;setBusy('')}
  }

  const Heading = administration ? 'h1' : 'h3'
  const form = <form onSubmit={submit}>
      <div className="modal-body">
        <div className="phone-progress" aria-label={t('خطوات التحقق','Verification steps')}>
          <span className={pending?'done':'active'}>{pending?<Check size={15}/>:<Smartphone size={15}/>} {t('رقم الجوال','Mobile number')}</span>
          <i/><span className={pending?'active':''}><KeyRound size={15}/> {t('رمز التحقق','Security code')}</span>
        </div>
        <div className="phone-intro"><span className="phone-icon">{pending?<KeyRound size={27}/>:administration?<ShieldCheck size={27}/>:<Smartphone size={27}/>}</span><Heading>{pending?t('أدخل رمز التحقق','Enter the security code'):administration?t('دخول الإدارة','Administration sign-in'):t('الدخول أو إنشاء حساب','Sign in or create an account')}</Heading>
          {pending?<p>{t('طُلب إرسال رمز من 6 أرقام إلى','A 6-digit code was requested for')} <bdi>{pending.destination}</bdi></p>:<p>{administration?t('أدخل رقم جوال حساب الإدارة للتحقق برسالة نصية.','Verify the administration account’s mobile number by SMS.'):t('تحقّق من رقم جوالك لمتابعة الدخول أو طلب حساب جديد.','Verify your number to sign in or request a new account.')}</p>}
        </div>
        {availability==='loading'?<p className="hint-line"><LoaderCircle className="spinner" size={17}/>{t('جارٍ الاتصال بخدمة التحقق…','Connecting to phone verification…')}</p>:availability==='disabled'?
          <p className="hint-line"><ShieldCheck size={17}/>{t('تفعيل الرسائل النصية بانتظار إعداد مشروع Firebase للمنصة.','SMS verification is awaiting the platform’s Firebase setup.')}</p>:availability==='unavailable'?
          <div className="error-box"><span>{t('تعذر الاتصال بخدمة التحقق.','Could not connect to verification.')}</span><button type="button" className="text-button" onClick={retry}>{t('إعادة المحاولة','Try again')}</button></div>
        :pending?<><label className="otp-label" htmlFor="phone-otp">{t('الرمز المكوّن من 6 أرقام','6-digit code')}</label>
          <div className="otp-entry" dir="ltr">
            <input id="phone-otp" name="one-time-code" pattern="[0-9]{6}" ref={codeField} value={code} onChange={e=>{setCode(asciiDigits(e.target.value).replace(/\D/g,'').slice(0,6));setError('')}} inputMode="numeric" autoComplete="one-time-code" maxLength={12} aria-invalid={!!error} aria-describedby={error?'phone-error':undefined} required/>
            <div className="otp-slots" aria-hidden="true">{Array.from({length:6},(_,index)=><span className={code[index]?'filled':index===code.length?'current':''} key={index}>{code[index]||'·'}</span>)}</div>
          </div>
          <div className="phone-controls"><button className="text-button" type="button" disabled={!!busy} onClick={editNumber}>{t('تعديل الرقم','Edit number')}</button><button className="text-button" type="button" disabled={!!busy||seconds>0} onClick={()=>void send(pending.destination)}>{seconds?t(`إعادة الإرسال بعد ${seconds} ث`,`Resend in ${seconds}s`):t('إعادة إرسال الرمز','Resend code')}</button></div>
        </>:<label>{t('رقم الجوال','Mobile number')}<input ref={phoneField} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={28} readOnly={!!busy} value={phone} onChange={e=>{setPhone(e.target.value);setError('')}} placeholder="05X XXX XXXX" required/></label>}
        <div ref={captchaHost} className="recaptcha-host"/>
        {error&&<p id="phone-error" className="error-box" role="alert">{error}</p>}
        {busy==='send'&&stage==='browser'&&slow&&<div className="hint-line sms-progress"><span role="status">{t('فحص المتصفح يستغرق وقتًا أطول.', 'The browser check is taking longer.')}</span><button type="button" className="text-button" onClick={()=>activeCaptcha.current?.verifier.useManualCheck()}>{t('عرض مربع التحقق','Show verification checkbox')}</button></div>}
        {busy==='send'&&stage==='manual'&&<p className="hint-line" role="status">{t('أكمل مربع التحقق هنا وسيُطلب الرمز تلقائيًا.', 'Complete the checkbox here. Your code will be requested automatically.')}</p>}
        {availability==='ready'&&!pending&&!administration&&<p className="phone-privacy"><ShieldCheck size={16}/>{t('ستبقى جلسة الدخول محفوظة على هذا الجهاز بعد التحقق.','Your sign-in stays on this device after verification.')}</p>}
      </div>
      {availability==='ready'&&<div className="modal-foot phone-foot"><button type="submit" className="btn btn-primary full" disabled={!!busy||(pending?code.length!==6:!target||seconds>0)}>
        {busy?<LoaderCircle className="spinner" size={18}/>:pending?<Check size={18}/>:<Smartphone size={18}/>}
        {busy==='send'?(stage==='provider'?t('جارٍ طلب إرسال الرمز…','Requesting your code…'):t('جارٍ فحص المتصفح…','Checking your browser…')):busy==='verify'?t('جارٍ التحقق من الرمز…','Verifying the code…'):pending?t('تحقّق ومتابعة','Verify and continue'):seconds?t(`طلب رمز بعد ${seconds} ث`,`Request a code in ${seconds}s`):t('إرسال رمز التحقق','Send verification code')}
      </button></div>}
    </form>
  return administration ? <section className="panel intro-card phone-dialog">{form}</section>
    : <Modal title={t('حساب حلقات الخير','Al-Khair account')} close={()=>{if(!busy)close?.()}} appearance="phone-dialog">{form}</Modal>
}
export const endPhone = signOut
