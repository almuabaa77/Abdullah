import { useRef, useState } from 'react'
import { Activity, RadioTower, ShieldCheck } from 'lucide-react'
import type { LessonRtcStatus } from './lessons'
import { probeAgoraConnection, type ConnectionProbe } from './lesson-agora-client'
import { useWorkspace } from './ui'

type StatusResult={mode:LessonRtcStatus['mode'];rest:LessonRtcStatus['rest'];probe?:ConnectionProbe}
export function LessonAgoraStatus() {
  const {data,t,lessonRtcStatus}=useWorkspace()
  const running=useRef(false)
  const [status,setStatus]=useState<StatusResult>()
  const [loading,setLoading]=useState(false)
  const [failure,setFailure]=useState('')
  async function run(){
    if(running.current)return
    running.current=true;setLoading(true);setFailure('');setStatus(undefined)
    try{
      const {mode,rest,probe}=await lessonRtcStatus()
      setStatus({mode,rest,probe:probe?await probeAgoraConnection(probe):undefined})
    }catch(error){setFailure((error as Error).message||t('تعذر فحص الاتصال','Connection check failed'))}
    finally{running.current=false;setLoading(false)}
  }
  const result=status?.probe
  return <section className="lesson-agora" aria-label={t('فحص Agora','Agora diagnostics')}>
    <div className="lesson-agora-top"><div><RadioTower size={18}/><strong>{t('اتصال Agora','Agora connection')}</strong>
      {!!data.lessonHealth?.rtcConfigured&&<span className="badge status-active"><ShieldCheck size={13}/>{data.lessonHealth.encryptedMode?t('اتصال مشفّر','Encrypted connection'):t('اتصال موقّع','Signed connection')}</span>}</div>
      <button className="btn btn-outline compact" type="button" disabled={loading} onClick={()=>void run()}>
        <Activity size={16}/>{loading?t('جارٍ فحص الاتصال الحالي…','Checking current connection…'):t('فحص اتصال Agora','Check Agora connection')}
      </button>
    </div>
    {failure&&<p className="error-text" role="alert">{failure}</p>}
    {status&&<div className="lesson-agora-results" role="status">
      {result?.state==='connected'?<>
        <strong>{t('نجح الاتصال بخادم Agora','Connected to the Agora server')}</strong>
        <p>{t('مدة الانضمام','Join time')} <bdi>{result.elapsedMs}</bdi> {t('مللي ثانية','ms')}
          {result.rtt>0&&<> · {t('زمن الاستجابة','Round-trip time')} <bdi>{result.rtt}</bdi> {t('مللي ثانية','ms')}</>}
        </p>
      </>:<p>{!result?t('إعداد الاتصال الحالي غير مكتمل.','The current connection is not configured.')
          :result.state==='unsupported'?t('بيئة المتصفح الحالية لا تدعم اتصال Agora.','This browser environment does not support the Agora connection.')
          :result.state==='timeout'?t('لم يكتمل الانضمام إلى Agora في الوقت المحدد.','The Agora join timed out.')
          :t('تعذّر الانضمام إلى Agora بإعداد الاتصال الحالي.','Could not join Agora with the current connection setup.')}</p>}
      {status.mode==='signed'&&status.rest!=='accepted'&&<p className="error-text">{t('تعذّر التحقق من واجهة Agora لإدارة الاتصال والحضور.','The Agora presence and moderation API could not be verified.')}</p>}
    </div>}
  </section>
}
