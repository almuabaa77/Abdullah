import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { View } from './domain'
import { useWorkspace } from './ui'

export function AccountAccess({status,signOut}:{status:NonNullable<View['accountAccess']>;signOut:()=>Promise<void>}) {
  const {t,post} = useWorkspace()
  const [closing,setClosing] = useState(false)
  const [error,setError] = useState('')
  const requiresConfirmation = status==='closure-pending'
  const closed = status==='closed'
  const complete = async () => {
    setClosing(true);setError('')
    try {
      if (requiresConfirmation) await post('duplicate-close',{confirmed:true})
      else await signOut()
    } catch (failure) { setError((failure as Error).message) }
    finally { setClosing(false) }
  }
  return <section className="panel section-panel intro-card account-access" aria-labelledby="account-access-title">
    <span className="stat-icon tint-orange"><ShieldAlert size={23}/></span>
    <h1 id="account-access-title">{closed?t('أُغلق الحساب','Account closed'):t('رقم الجوال مكرر','Duplicate mobile number')}</h1>
    {requiresConfirmation ? <p>{t('سيُلغى حسابك نهائيًا بسبب مخالفة سياسة الحسابات والخصوصية التي تشترط رقم جوال واحدًا لكل حساب. اضغط تأكيد الإنهاء لحذف حسابك من المنصة وتسجيل الخروج.','Your account will be permanently closed under the account and privacy policy requiring a unique mobile number. Confirm closure to delete your platform account and sign out.')}</p>
      : <p>{closed?t('حُذف حسابك من المنصة.','Your platform account has been deleted.'):t('تعرّفنا على أكثر من ارتباط بهذا الرقم. يلزم أن تتحقق الإدارة من الحساب الذي سيبقى قبل متابعة الدخول.','This number has multiple account associations. Administration must verify which account to keep before you can continue.')}</p>}
    {error&&<p className="error-box" role="alert">{error}</p>}
    <button className="btn btn-primary" disabled={closing} onClick={()=>void complete()}>{requiresConfirmation?t('تأكيد الإنهاء والحذف','Confirm closure and deletion'):t('تسجيل الخروج','Sign out')}</button>
  </section>
}
