import { useEffect, useState } from 'react'
import { Bell, BellOff, Send } from 'lucide-react'
import { devicePushStatus, disableDevicePush, enableDevicePush, sendDeviceTest, supportsDevicePush } from './device-push'
import { Modal, useWorkspace } from './ui'

export function DevicePermissions({token,close}:{token:string;close:()=>void}) {
  const {t,en,tell}=useWorkspace()
  const supported=supportsDevicePush()
  const [permission,setPermission]=useState(()=>supported?Notification.permission:'default')
  const [enabled,setEnabled]=useState<boolean>()
  const [busy,setBusy]=useState(false)

  useEffect(()=>{
    let active=true
    devicePushStatus(token).then(value=>{if(active)setEnabled(value)}).catch(()=>{if(active)setEnabled(false)})
    return ()=>{active=false}
  },[token])

  async function toggle() {
    setBusy(true)
    try {
      if(enabled){await disableDevicePush(token);setEnabled(false)}
      else {
        setEnabled(await enableDevicePush(token,en))
        setPermission(Notification.permission)
      }
    } catch(error) {
      tell(en?'Could not update background notifications.':(error as Error).message,true)
    } finally {setBusy(false)}
  }
  async function test() {
    setBusy(true)
    try {
      await sendDeviceTest(token)
      tell(t('طُلب إرسال تنبيه تجريبي','A test notification was requested'))
    } catch(error) {
      tell(en?'Could not send the test notification.':(error as Error).message,true)
    } finally {setBusy(false)}
  }

  return <Modal title={t('الأذونات والتنبيهات','Permissions & notifications')} close={close}>
    <div className="modal-body permission-settings">
      <div className="permission-summary">
        <span className="stat-icon tint-green"><Bell size={21}/></span>
        <div><h3>{t('الإشعارات في الخلفية','Background notifications')}</h3><p>{t('استقبل التنبيهات عند إغلاق التطبيق على الأجهزة المدعومة.','Receive alerts with the app closed on supported devices.')}</p></div>
      </div>
      {!supported?<p className="hint-line">{t('على iPhone وiPad، أضف التطبيق إلى الشاشة الرئيسية وافتحه من هناك لتفعيل التنبيهات.','On iPhone and iPad, add the app to your Home Screen, then enable notifications from the installed app.')}</p>
        :<p className="hint-line" role="status">{enabled?t('التنبيهات مفعّلة لهذا الحساب على هذا الجهاز','Notifications are enabled for this account on this device')
          :permission==='denied'?t('إذن الإشعارات محظور. يمكنك تغييره من إعدادات المتصفح أو الجهاز.','Notifications are blocked. Change the permission in browser or device settings.')
          :enabled===undefined?t('جارٍ التحقق من الاشتراك…','Checking subscription…'):t('التنبيهات غير مفعّلة على هذا الجهاز','Background notifications are off for this device')}</p>}
      {supported&&<div className="chip-row">
        <button className={'btn '+(enabled?'btn-outline':'btn-primary')} type="button"
          disabled={busy||enabled===undefined||!enabled&&permission==='denied'} onClick={()=>void toggle()}>
          {enabled?<BellOff size={17}/>:<Bell size={17}/>}
          {enabled?t('إيقاف التنبيهات','Turn off alerts'):t('تفعيل التنبيهات','Turn on alerts')}
        </button>
        {enabled&&<button className="btn btn-outline" type="button" disabled={busy} onClick={()=>void test()}><Send size={16}/>{t('تنبيه تجريبي','Send test alert')}</button>}
      </div>}
      <p className="small-text">{t('يطلب المتصفح إذن الكاميرا والميكروفون إذا احتاجتهما ميزة تستخدمها. اختيار الملفات يتم من نافذة الجهاز.','The browser requests camera or microphone access when a feature needs it. Files are chosen through the system picker.')}</p>
    </div>
  </Modal>
}
