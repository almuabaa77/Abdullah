import { useEffect, useState } from 'react'
import { Check, Copy, Download, Ellipsis, Share, Smartphone, SquarePlus } from 'lucide-react'
import { brandIconUrl } from './appearance'
import { Modal, useWorkspace } from './ui'
import './app-install.css'

type InstallPrompt = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}

function installedApp() {
  return (navigator as Navigator&{standalone?:boolean}).standalone===true
    || matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches&&!document.fullscreenElement
}

function appleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1
}

export function useAppInstall() {
  const [installed,setInstalled]=useState(installedApp)
  const [prompt,setPrompt]=useState<InstallPrompt>()
  const [guide,setGuide]=useState(false)
  useEffect(()=>{
    const display=matchMedia('(display-mode: standalone)')
    const update=()=>setInstalled(installedApp())
    const capture=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt)}
    const complete=()=>{setInstalled(true);setGuide(false);setPrompt(undefined)}
    window.addEventListener('beforeinstallprompt',capture)
    window.addEventListener('appinstalled',complete)
    display.addEventListener('change',update)
    return ()=>{
      window.removeEventListener('beforeinstallprompt',capture)
      window.removeEventListener('appinstalled',complete)
      display.removeEventListener('change',update)
    }
  },[])
  function openInstall() {
    if(installed)return
    if(!prompt){setGuide(true);return}
    setPrompt(undefined)
    void prompt.prompt().then(()=>prompt.userChoice).then(choice=>{
      if(choice.outcome==='accepted')setInstalled(true)
    }).catch(()=>setGuide(true))
  }
  return {canInstall:!installed,guide,openInstall,closeInstall:()=>setGuide(false)}
}

export function InstallGuide({close}:{close:()=>void}) {
  const {data,t}=useWorkspace()
  const apple=appleMobile()
  const [copied,setCopied]=useState(false)
  const [showLink,setShowLink]=useState(false)
  const link=new URL('/',location.origin).href
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {setShowLink(true)}
  }
  const steps:readonly (readonly [typeof Share,string,string])[]=apple?[
    [Share,t('افتح قائمة المشاركة','Open the Share menu'),t('افتح الموقع في Safari، ثم اضغط «مشاركة». قد تجدها داخل قائمة «المزيد».','Open the site in Safari, then tap Share. It may be inside the More menu.')],
    [SquarePlus,t('إضافة إلى الشاشة الرئيسية','Add to Home Screen'),t('اختر «إضافة إلى الشاشة الرئيسية». إذا لم يظهر الخيار، ابحث عنه في «تعديل الإجراءات».','Choose Add to Home Screen. If you do not see it, find it under Edit Actions.')],
    [Check,t('أضف التطبيق','Add the app'),t('فعّل «فتح كتطبيق ويب» إذا ظهر، ثم اضغط «إضافة». افتح التطبيق من أيقونته على الشاشة الرئيسية.','Enable Open as Web App if shown, then tap Add. Launch the app from its Home Screen icon.')],
  ]:[
    [Ellipsis,t('افتح قائمة المتصفح','Open your browser menu'),t('استخدم Chrome أو Edge، أو افتح الموقع في متصفح جهازك إذا كنت داخل تطبيق آخر.','Use Chrome or Edge, or open the site in your browser if you are inside another app.')],
    [Download,t('اختر تثبيت التطبيق','Choose Install app'),t('اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» إذا ظهر الخيار في القائمة.','Choose Install app or Add to Home Screen if your browser offers it.')],
  ]
  return <Modal title={t('تثبيت تطبيق حلقات الخير','Install Al-Khair Circles')} close={close} appearance="install-guide">
    <div className="modal-body">
      <div className="install-guide-intro">
        <img src={brandIconUrl(data.appearance?.iconVersion)} alt="" width="48" height="48"/>
        <div><strong>{apple?t('التثبيت على الآيفون والآيباد','Install on iPhone or iPad'):t('التثبيت على جهازك','Install on your device')}</strong>
          <p><Smartphone size={14} aria-hidden="true"/>{t('افتح حلقات الخير من الأيقونة على شاشتك الرئيسية.','Open Al-Khair Circles from the icon on your Home Screen.')}</p></div>
      </div>
      <ol className="install-steps">{steps.map(([Icon,title,detail],index)=><li key={title}><span className="install-step-icon"><Icon size={19} aria-hidden="true"/></span>
          <div><strong>{index+1}. {title}</strong><p>{detail}</p></div>
        </li>)}</ol>
      {showLink&&<label>{t('رابط التطبيق','App link')}<input dir="ltr" value={link} readOnly onFocus={event=>event.currentTarget.select()}/></label>}
    </div>
    <div className="modal-foot">
      <button className="btn btn-outline compact" type="button" onClick={()=>void copyLink()}><Copy size={16}/>{t('نسخ رابط التطبيق','Copy app link')}</button>
      {copied&&<span className="install-link-status" role="status">{t('تم نسخ الرابط','Link copied')}</span>}
      <button className="btn btn-primary compact" type="button" onClick={close}>{t('تم','Done')}</button>
    </div>
  </Modal>
}
