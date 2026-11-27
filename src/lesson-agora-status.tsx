import { lazy, Suspense, useState } from 'react'
import { CheckCircle2, CircleAlert, RadioTower } from 'lucide-react'
import type { LessonRtcStatus } from './lessons'
import { useWorkspace } from './ui'

const AgoraAppIdTest=lazy(()=>import('./lesson-agora-test').then(module=>({default:module.AgoraAppIdTest})))

export function LessonAgoraStatus() {
  const {t,lessonRtcStatus}=useWorkspace()
  const [status,setStatus]=useState<LessonRtcStatus>()
  const [loading,setLoading]=useState(false)
  const [failure,setFailure]=useState('')
  const [testing,setTesting]=useState(()=>new URLSearchParams(location.search).has('agoraTest'))
  async function run(){
    setLoading(true);setFailure('')
    try{setStatus(await lessonRtcStatus())}
    catch(error){setFailure((error as Error).message)}
    finally{setLoading(false)}
  }
  const fields=status&&[
    {key:'AGORA_APP_ID',present:Boolean(status.appId)},
    {key:'AGORA_APP_CERTIFICATE',present:status.certificate},
    {key:'AGORA_CUSTOMER_ID',present:status.customerId},
    {key:'AGORA_CUSTOMER_SECRET',present:status.customerSecret},
    {key:'AGORA_COHOST_AUTH_ENABLED',present:status.coHostConfirmed},
  ]
  return <section className="lesson-agora" aria-label={t('فحص Agora','Agora diagnostics')}>
    <div className="lesson-agora-top"><div><RadioTower size={18}/><strong>{t('اتصال Agora','Agora connection')}</strong></div>
      <div className="chip-row">
        <button className="btn btn-primary compact" type="button" onClick={()=>setTesting(true)}>{t('تجربة Agora بمعرّف التطبيق','Test Agora with App ID')}</button>
        <button className="btn btn-outline compact" type="button" disabled={loading} onClick={()=>void run()}>
          {loading?t('جارٍ الفحص…','Checking…'):t('فحص اتصال Agora','Check Agora connection')}
        </button>
      </div>
    </div>
    {failure&&<p className="error-text" role="alert">{failure}</p>}
    {status&&<div className="lesson-agora-results" role="status">
      {status.appId&&<p><strong>{t('معرّف المشروع','Project ID')}</strong> <code dir="ltr">{status.appId}</code></p>}
      <ul>{fields?.map(({key,present})=><li key={key}>{present?<CheckCircle2 size={15}/>:<CircleAlert size={15}/>}
        <code dir="ltr">{key}</code><span>{present?t('مُعدّ','Set'):t('ناقص أو غير صالح','Missing or invalid')}</span></li>)}</ul>
      <p>{status.rest==='accepted'?t('قبل Agora طلب الفحص. اختبر مكالمة بحسابين للتحقق من الشهادة وصلاحيات النشر.','Agora accepted the request. Test a call with two accounts to verify the certificate and publishing permissions.')
        :status.rest==='rejected'?t('رفض Agora طلب الفحص. تحقّق من مفاتيح REST وانتماء المشروع إلى الحساب نفسه.','Agora rejected the request. Check the REST keys and make sure the project belongs to the same account.')
        :status.rest==='unavailable'?t('تعذر الاتصال بخدمة Agora الآن. أعد الفحص بعد قليل.','The Agora service could not be reached. Try again shortly.')
        :t('يبدأ فحص الخادم بعد إضافة معرّف المشروع ومفاتيح REST.','The server checks the connection after you add the project ID and REST keys.')}</p>
    </div>}
    {testing&&<Suspense fallback={<p className="hint-line" role="status">{t('جارٍ فتح غرفة الاختبار…','Opening the test room…')}</p>}>
      <AgoraAppIdTest close={()=>setTesting(false)}/>
    </Suspense>}
  </section>
}
