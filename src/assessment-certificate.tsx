import { useEffect, useState } from 'react'
import { Award, BadgeCheck, ExternalLink, Printer, Share2 } from 'lucide-react'
import { brandIconUrl } from './appearance'
import type { AssessmentView } from './assessment-model'
import { dateLabel, Modal, useWorkspace } from './ui'
import './assessments.css'

export function AssessmentCertificateDialog({item,close}:{item:AssessmentView;close:()=>void}) {
  const {data,t,en,tell}=useWorkspace()
  const certificate=item.certificate!
  const [qr,setQr]=useState('')
  const [qrError,setQrError]=useState(false)
  const url=new URL('/',location.origin)
  url.searchParams.set('certificate',certificate.id)
  const link=url.href
  useEffect(()=>{
    let active=true
    void import('qrcode').then(module=>module.toDataURL(link,{margin:2,width:300,errorCorrectionLevel:'M'}))
      .then(data=>{if(active)setQr(data)}).catch(()=>{if(active)setQrError(true)})
    return ()=>{active=false}
  },[link])
  const hijri=new Intl.DateTimeFormat(en?'en-SA-u-ca-islamic-umalqura':'ar-SA-u-ca-islamic-umalqura',{dateStyle:'long',timeZone:'Asia/Riyadh'}).format(new Date(certificate.issuedAt))
  const grade=en?certificate.grade.en:certificate.grade.ar
  async function share() {
    try {
      if(navigator.share)await navigator.share({title:t('التحقق من شهادة حلقات الخير','Verify Al-Khair certificate'),url:link})
      else {await navigator.clipboard.writeText(link);tell(t('تم نسخ رابط التحقق','Verification link copied'))}
    }catch(error){if((error as Error).name!=='AbortError')tell(t('تعذرت مشاركة الرابط','Could not share the link'),true)}
  }
  return <Modal title={t('شهادة اجتياز المرحلة','Stage completion certificate')} close={close} wide appearance="assessment-certificate-dialog">
    <div className="modal-body">
      <article className="assessment-cert-document">
        <img className="assessment-cert-logo" width="55" height="55" src={brandIconUrl(data.appearance?.iconVersion)} alt=""/>
        <p>{t('حلقات جامع الخير بآل سرحان','Al-Khair Quran Circles · Al Sarhan')}</p>
        <h2>{t('شهادة اجتياز المرحلة','Stage completion certificate')}</h2>
        <strong className="assessment-cert-name" dir="auto">{certificate.studentName}</strong>
        <p>{t('المرحلة','Stage')} {item.unit} · {t('الأجزاء','Parts')} {item.parts.join('، ')}</p>
        <p><bdi>{certificate.score}/100</bdi> · {grade}</p>
        <p>{dateLabel(certificate.issuedAt.slice(0,10),en,true)} · {hijri}</p>
        <div className="assessment-cert-signatures">
          <div><small>{t('المختبر','Examiner')}</small><strong>{certificate.examiner}</strong></div>
          <div><small>{t('الاعتماد الإداري','Administration approval')}</small><strong>{certificate.approvedBy}</strong></div>
        </div>
        <div className="assessment-cert-qr">{qr&&<img src={qr} width="75" height="75" alt={t('رمز التحقق من الشهادة','Certificate verification QR code')}/>}
          <div><small>{t('الرقم التسلسلي','Serial number')}</small><bdi>{certificate.id}</bdi></div></div>
        {certificate.revokedAt&&<p className="error-box">{t('أُلغيت هذه الشهادة','This certificate was revoked')}</p>}
        {qrError&&<p>{t('استخدم رابط التحقق أدناه.','Use the verification link below.')}</p>}
      </article>
    </div>
    <div className="modal-foot">
      <a href={link} className="btn btn-outline compact" target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{t('رابط التحقق','Verification link')}</a>
      <button className="btn btn-outline compact" type="button" onClick={()=>void share()}><Share2 size={16}/>{t('مشاركة رابط التحقق','Share verification')}</button>
      <button className="btn btn-primary compact" type="button" onClick={()=>window.print()} disabled={Boolean(certificate.revokedAt)||!qr&&!qrError}><Printer size={16}/>{t('طباعة أو حفظ PDF','Print or save PDF')}</button>
    </div>
  </Modal>
}

export function PublicAssessmentCertificate({serial}:{serial:string}) {
  const en=localStorage.getItem('halaqat-language')==='en'
  const t=(ar:string,english:string)=>en?english:ar
  const [result,setResult]=useState<{status:string;serial?:string;issuedAt?:string;stage?:number;parts?:number[]}>({status:'loading'})
  useEffect(()=>{
    document.documentElement.dir=en?'ltr':'rtl'
    document.documentElement.lang=en?'en':'ar'
    document.title=t('التحقق من شهادة حلقات الخير','Verify Al-Khair certificate')
    const abort=new AbortController()
    void fetch('/api/assessment/certificate?id='+encodeURIComponent(serial),{cache:'no-store',signal:abort.signal})
      .then(response=>{if(!response.ok)throw new Error();return response.json()}).then(setResult).catch(()=>{if(!abort.signal.aborted)setResult({status:'error'})})
    return ()=>abort.abort()
  },[serial,en])
  return <main className="assessment-public"><section className="panel section-panel">
    {result.status==='valid'?<BadgeCheck size={36}/>:<Award size={36}/>}
    <h1>{t('التحقق من شهادة حلقات الخير','Al-Khair certificate verification')}</h1>
    <div role="status">
      {result.status==='loading'?t('جارٍ التحقق…','Verifying…'):result.status==='valid'?t('هذه الشهادة سارية ومعتمدة.','This certificate is valid.'):
        result.status==='revoked'?t('هذه الشهادة ملغاة.','This certificate has been revoked.'):
        result.status==='error'?t('تعذّر الاتصال بخدمة التحقق.','Could not reach the verification service.'):t('لم يُعثر على هذه الشهادة.','This certificate was not found.')}
    </div>
    {result.stage&&<dl><div><dt>{t('المرحلة','Stage')}</dt><dd>{result.stage}</dd></div><div><dt>{t('الأجزاء','Parts')}</dt><dd>{result.parts?.join('، ')}</dd></div>
      <div><dt>{t('تاريخ الإصدار','Issue date')}</dt><dd>{dateLabel(result.issuedAt?.slice(0,10)??'',en,true)}</dd></div>
      <div><dt>{t('الرقم التسلسلي','Serial number')}</dt><dd><bdi>{result.serial}</bdi></dd></div></dl>}
    <a className="btn btn-outline" href="/">{t('العودة إلى حلقات الخير','Back to Al-Khair Circles')}</a>
  </section></main>
}
import './assessments.css'
