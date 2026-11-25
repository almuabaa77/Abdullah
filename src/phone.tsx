import { useEffect, useRef, useState } from 'react'
import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { browserSessionPersistence, getAuth, onIdTokenChanged, RecaptchaVerifier, setPersistence, signInWithPhoneNumber, signOut, type ConfirmationResult } from 'firebase/auth'
import { Modal, useWorkspace } from './ui'

export async function connectPhone(setToken:(token:string)=>void) {
  const response = await fetch('/api/config')
  if (!response.ok) throw new Error('تعذر الاتصال بخدمة تسجيل الدخول')
  const { firebase } = await response.json() as { firebase:FirebaseOptions | null }
  if (!firebase) return null
  const auth = getAuth(initializeApp(firebase))
  await setPersistence(auth,browserSessionPersistence)
  onIdTokenChanged(auth,async user=>setToken(user?await user.getIdToken():''))
  return auth
}
export type PhoneAuth = NonNullable<Awaited<ReturnType<typeof connectPhone>>>
export function PhoneModal({auth,close}:{auth:PhoneAuth|null,close:()=>void}) {
  const {t} = useWorkspace()
  const [phone,setPhone] = useState('')
  const [code,setCode] = useState('')
  const [confirm,setConfirm] = useState<ConfirmationResult>()
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [last,setLast] = useState(0)
  const container=useRef<HTMLDivElement>(null)
  const captcha=useRef<RecaptchaVerifier|null>(null)
  useEffect(()=>()=>captcha.current?.clear(),[])
  return <Modal title={t('الدخول برقم الجوال','Sign in by mobile number')} close={close}><form onSubmit={async e=>{
    e.preventDefault();if(!auth||!container.current)return
    setBusy(true);setError('')
    try{
      if(confirm){await confirm.confirm(code.trim());close()}
      else {
        if(Date.now()-last<60000)throw new Error(t('انتظر دقيقة قبل طلب رمز جديد.','Wait a minute before requesting a new code.'))
        const normalized=phone.trim().replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[ -]/g,'').replace(/^05/,'+9665')
        if(!/^\+[1-9]\d{7,14}$/.test(normalized))throw new Error(t('أدخل رقم الجوال مع رمز الدولة.','Enter the mobile number with its country code.'))
        captcha.current?.clear()
        captcha.current=new RecaptchaVerifier(auth,container.current,{size:'invisible'})
        setLast(Date.now())
        setConfirm(await signInWithPhoneNumber(auth,normalized,captcha.current))
      }
    }catch(err){setError((err as Error).message)}finally{setBusy(false)}
  }}><div className="modal-body">
    {!auth?<div className="hint-line">{t('خدمة التحقق بالجوال بانتظار ربط مشروع Firebase.','Mobile verification is awaiting a Firebase project connection.')}</div>:confirm?<label>{t('رمز التحقق','Verification code')}<input autoFocus dir="ltr" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required/></label>:<label>{t('رقم الجوال','Mobile number')}<input autoFocus type="tel" dir="ltr" placeholder="+966 5X XXX XXXX" value={phone} onChange={e=>setPhone(e.target.value)} autoComplete="tel" required/></label>}
    <div ref={container}/>{error&&<div className="error-box" role="alert">{error}</div>}
  </div><div className="modal-foot">{confirm&&<button className="btn btn-outline" type="button" onClick={()=>setConfirm(undefined)}>{t('تغيير الرقم','Change number')}</button>}<button className="btn btn-primary" disabled={busy||!auth}>{confirm?t('تحقق','Verify'):t('إرسال الرمز','Send code')}</button></div></form></Modal>
}
export const endPhone = signOut
