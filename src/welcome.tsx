import { brandIconUrl } from './appearance'
import { ArrowLeft, BookOpen, LoaderCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { useWorkspace } from './ui'
import './welcome.css'

export function Welcome({signIn}:{signIn:()=>void}) {
  const {t} = useWorkspace()
  return <section className="welcome-screen" aria-labelledby="welcome-heading">
    <div className="welcome-content">
      <div className="welcome-mark" aria-hidden="true"><span><BookOpen size={27} strokeWidth={1.65}/></span></div>
      <h1 id="welcome-heading"><span>{t('أهلًا بك في','Welcome to')}</span><span>{t('حلقات الخير','Al-Khair Circles')}</span></h1>
      <p className="welcome-description">{t('تابع حفظ القرآن ومراجعته، واطّلع على الحضور والإنجاز في مكان واحد.','Follow Quran memorization, revision, attendance, and progress in one place.')}</p>
      <div className="welcome-actions">
        <button className="btn btn-primary welcome-login" type="button" onClick={signIn}>
          <span className="welcome-phone" aria-hidden="true"><Smartphone size={21}/></span>
          <span>{t('الدخول برقم الجوال','Sign in with mobile')}</span>
          <ArrowLeft className="welcome-arrow" size={20} aria-hidden="true"/>
        </button>
        <p className="welcome-verify"><ShieldCheck size={16} aria-hidden="true"/>{t('يُرسل رمز التحقق عبر رسالة نصية.','Your verification code arrives by text message.')}</p>
      </div>
    </div>
    <figure className="welcome-visual" aria-hidden="true">
      <div className="welcome-photo"><img src="/assets/hero.webp" width="1280" height="853" alt="" fetchPriority="high" decoding="async"/></div>
    </figure>
  </section>
}

export function Starting() {
  const {t,data} = useWorkspace()
  return <section className="starting-screen" role="status" aria-live="polite">
    <img width="64" height="64" src={brandIconUrl(data.appearance?.iconVersion)} alt=""/>
    <span><LoaderCircle className="spinner" size={17}/>{t('جارٍ تجهيز حسابك','Preparing your account')}</span>
  </section>
}
