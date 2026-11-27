import { brandIconUrl } from './appearance'
import { LoaderCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { useWorkspace } from './ui'

export function Welcome({signIn}:{signIn:()=>void}) {
  const {t,go} = useWorkspace()
  return <section className="welcome-screen">
    <div className="welcome-content">
      <h1>{t('أهلًا بك في حلقات الخير','Welcome to Al-Khair Circles')}</h1>
      <p>{t('تابع الحفظ والمراجعة والحضور من مكان واحد.','Follow memorization, revision and attendance in one place.')}</p>
      <div className="welcome-actions">
        <button className="btn btn-primary" type="button" onClick={signIn}><Smartphone size={19}/>{t('الدخول برقم الجوال','Sign in with mobile')}</button>
        <a href="/admin" className="text-button" onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();go('admin')}}}><ShieldCheck size={16}/>{t('دخول الإدارة','Administration sign-in')}</a>
      </div>
    </div>
    <div className="welcome-visual" aria-hidden="true"/>
  </section>
}

export function Starting() {
  const {t,data} = useWorkspace()
  return <section className="starting-screen" role="status" aria-live="polite">
    <img width="64" height="64" src={brandIconUrl(data.appearance?.iconVersion)} alt=""/>
    <span><LoaderCircle className="spinner" size={17}/>{t('جارٍ تجهيز حسابك','Preparing your account')}</span>
  </section>
}
