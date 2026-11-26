import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import { browserSessionPersistence, getAuth, onIdTokenChanged, RecaptchaVerifier, setPersistence, signInWithPhoneNumber, signOut, type Auth, type ConfirmationResult } from 'firebase/auth'
import { Modal, useWorkspace, type Tr } from './ui'
import { asciiDigits, normalizeMobile } from './phone-number'

export type PhoneAuth = Auth
export type PhoneAvailability = 'loading'|'disabled'|'ready'|'unavailable'
export async function connectPhone(config:FirebaseOptions, receive:(token:string)=>void) {
  const app = getApps().some(app=>app.name==='halaqat-phone') ? getApp('halaqat-phone') : initializeApp(config,'halaqat-phone')
  const auth = getAuth(app)
  await setPersistence(auth,browserSessionPersistence)
  await auth.authStateReady()
  receive(await auth.currentUser?.getIdToken() || '')
  const unsubscribe=onIdTokenChanged(auth,user=>{
    if(!user){receive('');return}
    void user.getIdToken().then(token=>{if(auth.currentUser===user)receive(token)}).catch(()=>{})
  })
  return {auth,unsubscribe}
}
const cooldownKey='halaqat-last-sms-request'

function smsError(error:unknown,t:Tr) {
  const code=typeof error==='object'&&error!==null&&'code' in error ? error.code : ''
  switch(code) {
    case 'auth/invalid-phone-number': return t('تحقق من رقم الجوال ورمز الدولة.','Check the mobile number and its country code.')
    case 'auth/invalid-verification-code': return t('الرمز غير صحيح. تحقق من الرسالة وحاول مجددًا.','That code is incorrect. Check the message and try again.')
    case 'auth/code-expired':
    case 'auth/session-expired': return t('انتهت صلاحية الرمز. اطلب رمزًا جديدًا.','That code expired. Request a new one.')
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded': return t('وصلت إلى حد طلبات الرموز مؤقتًا. حاول لاحقًا.','The temporary SMS limit was reached. Try again later.')
    case 'auth/network-request-failed': return t('تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.','Check your internet connection and try again.')
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
    case 'auth/invalid-app-credential':
    case 'auth/app-not-authorized': return t('خدمة الرسائل بحاجة إلى ضبط المشروع أو تفويض هذا النطاق في Firebase.','The SMS service needs Firebase configuration or domain authorization.')
    case 'auth/captcha-check-failed':
    case 'auth/missing-app-credential': return t('تعذر التحقق من المتصفح. أعد المحاولة.','Browser verification failed. Try again.')
    default: return t('تعذر إتمام التحقق الآن. أعد المحاولة.','Verification could not be completed. Try again.')
  }
}

export function PhoneSignIn({auth,availability,retry,close,administration=false}:{auth:PhoneAuth|null;availability:PhoneAvailability;retry:()=>void;close?:()=>void;administration?:boolean}) {
  const {t,en} = useWorkspace()
  const [phone,setPhone] = useState('')
  const [number,setNumber] = useState('')
  const [code,setCode] = useState('')
  const [confirm,setConfirm] = useState<ConfirmationResult>()
  const [error,setError] = useState('')
  const [busy,setBusy] = useState<'send'|'verify'|''>('')
  const [last,setLast] = useState(()=>Number(sessionStorage.getItem(cooldownKey))||0)
  const [now,setNow] = useState(Date.now)
  const captchaHost=useRef<HTMLDivElement>(null)
  const captcha=useRef<RecaptchaVerifier|null>(null)
  const codeField=useRef<HTMLInputElement>(null)
  const phoneField=useRef<HTMLInputElement>(null)
  const seconds=Math.min(60,Math.max(0,Math.ceil((last+60000-now)/1000)))
  useEffect(()=>()=>captcha.current?.clear(),[])
  useEffect(()=>{if(confirm)codeField.current?.focus();else if(availability==='ready')phoneField.current?.focus()},[confirm,availability])
  useEffect(()=>{
    if(seconds<=0)return
    const timer=window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(timer)
  },[seconds>0])

  async function send(value:string) {
    if(!auth||!captchaHost.current||busy||seconds)return
    const target=normalizeMobile(value)
    if(!target){setError(t('أدخل رقم جوال سعوديًا مثل 05XXXXXXXX أو رقمًا مع رمز الدولة.','Enter a Saudi mobile number such as 05XXXXXXXX or an international number.'));return}
    setBusy('send');setError('')
    try {
      auth.languageCode=en?'en':'ar'
      captcha.current?.clear()
      captcha.current=new RecaptchaVerifier(auth,captchaHost.current,{size:'invisible'})
      const result=await signInWithPhoneNumber(auth,target,captcha.current)
      const sent=Date.now()
      setLast(sent);setNow(sent);sessionStorage.setItem(cooldownKey,String(sent))
      setNumber(target);setCode('');setConfirm(result)
    } catch(err) {setError(smsError(err,t))}
    finally {captcha.current?.clear();captcha.current=null;setBusy('')}
  }

  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if(busy)return
    if(!confirm){await send(phone);return}
    if(code.length!==6)return
    setError('');setBusy('verify')
    try{await confirm.confirm(code);close?.()}
    catch(err){setError(smsError(err,t))}
    finally{setBusy('')}
  }

  const Heading = administration ? 'h1' : 'h3'
  const form = <form onSubmit={submit}>
      <div className="modal-body">
        <div className="phone-progress" aria-label={t('خطوات التحقق','Verification steps')}>
          <span className={confirm?'done':'active'}>{confirm?<Check size={15}/>:<Smartphone size={15}/>} {t('رقم الجوال','Mobile number')}</span>
          <i/><span className={confirm?'active':''}><KeyRound size={15}/> {t('رمز التحقق','Security code')}</span>
        </div>
        <div className="phone-intro"><span className="phone-icon">{confirm?<KeyRound size={27}/>:administration?<ShieldCheck size={27}/>:<Smartphone size={27}/>}</span><Heading>{confirm?t('أدخل رمز التحقق','Enter the security code'):administration?t('دخول الإدارة','Administration sign-in'):t('الدخول أو إنشاء حساب','Sign in or create an account')}</Heading>
          {confirm?<p>{t('أرسلنا رمزًا من 6 أرقام إلى','A 6-digit code was sent to')} <bdi>{number}</bdi></p>:<p>{administration?t('أدخل رقم جوال حساب الإدارة للتحقق برسالة نصية.','Verify the administration account’s mobile number by SMS.'):t('تحقّق من رقم جوالك لمتابعة الدخول أو طلب حساب جديد.','Verify your number to sign in or request a new account.')}</p>}
        </div>
        {availability==='loading'?<p className="hint-line"><LoaderCircle className="spinner" size={17}/>{t('جارٍ الاتصال بخدمة التحقق…','Connecting to phone verification…')}</p>:availability==='disabled'?
          <p className="hint-line"><ShieldCheck size={17}/>{t('تفعيل الرسائل النصية بانتظار إعداد مشروع Firebase للمنصة.','SMS verification is awaiting the platform’s Firebase setup.')}</p>:availability==='unavailable'?
          <div className="error-box"><span>{t('تعذر الاتصال بخدمة التحقق.','Could not connect to verification.')}</span><button type="button" className="text-button" onClick={retry}>{t('إعادة المحاولة','Try again')}</button></div>
        :confirm?<><label>{t('الرمز المكوّن من 6 أرقام','6-digit code')}<input ref={codeField} className="code-field" dir="ltr" value={code} onChange={e=>{setCode(asciiDigits(e.target.value).replace(/\D/g,'').slice(0,6));setError('')}} inputMode="numeric" autoComplete="one-time-code" maxLength={12} required/></label>
          <div className="phone-controls"><button className="text-button" type="button" disabled={!!busy} onClick={()=>{setConfirm(undefined);setError('');setCode('')}}>{t('تعديل الرقم','Edit number')}</button><button className="text-button" type="button" disabled={!!busy||seconds>0} onClick={()=>void send(number)}>{seconds?t(`إعادة الإرسال بعد ${seconds} ث`,`Resend in ${seconds}s`):t('إعادة إرسال الرمز','Resend code')}</button></div>
        </>:<label>{t('رقم الجوال','Mobile number')}<input ref={phoneField} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={28} value={phone} onChange={e=>{setPhone(e.target.value);setError('')}} placeholder="05X XXX XXXX" required/></label>}
        <div ref={captchaHost} className="recaptcha-host"/>
        {error&&<p className="error-box" role="alert">{error}</p>}
        {availability==='ready'&&!confirm&&!administration&&<p className="phone-privacy"><ShieldCheck size={16}/>{t('تتحقق Firebase من الرقم، وتراجع الإدارة طلبات الحسابات الجديدة.','Firebase verifies the number. Administration reviews new account requests.')}</p>}
      </div>
      {availability==='ready'&&<div className="modal-foot phone-foot"><button type="submit" className="btn btn-primary full" disabled={!!busy||(confirm?code.length!==6:!phone.trim()||seconds>0)}>
        {busy?<LoaderCircle className="spinner" size={18}/>:confirm?<Check size={18}/>:<Smartphone size={18}/>}
        {busy?t('جارٍ التحقق…','Verifying…'):confirm?t('تحقّق ومتابعة','Verify and continue'):seconds?t(`طلب رمز بعد ${seconds} ث`,`Request a code in ${seconds}s`):t('إرسال رمز التحقق','Send verification code')}
      </button></div>}
    </form>
  return administration ? <section className="panel intro-card phone-dialog">{form}</section>
    : <Modal title={t('حساب حلقات الخير','Al-Khair account')} close={()=>{if(!busy)close?.()}} appearance="phone-dialog">{form}</Modal>
}
export const endPhone = signOut
