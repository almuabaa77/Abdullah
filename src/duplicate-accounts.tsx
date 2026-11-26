import { useState } from 'react'
import { Search, ShieldAlert } from 'lucide-react'
import { asciiDigits, groupAccountsByPhone, normalizeMobile } from './phone-number'
import { Empty, Modal, RoleName, useWorkspace } from './ui'

export function DuplicateAccounts() {
  const {data,t,post,tell} = useWorkspace()
  const [search,setSearch] = useState('')
  const [selection,setSelection] = useState('')
  const [busy,setBusy] = useState(false)
  const duplicates = [...groupAccountsByPhone(data.users)].filter(([,accounts])=>accounts.length>1)
  const digits = asciiDigits(search).replace(/\D/g,'')
  const number = normalizeMobile(search)
  const query = search.trim().toLowerCase()
  const visible = duplicates.filter(([phone,accounts])=>!query || phone===number || (digits && phone.includes(digits)) || accounts.some(account=>account.name.toLowerCase().includes(query)))
  const group = duplicates.find(([,accounts])=>accounts.some(account=>account.id===selection))?.[1] ?? []
  const selected = group.find(account=>account.id===selection)
  const isInvite = Boolean(selected?.id.startsWith('invite:'))
  const change = async (action:string, values:Record<string,unknown>) => {
    setBusy(true)
    try { await post(action, values); setSelection(''); tell(t('تم حفظ القرار','Decision saved')) }
    catch (error) { tell((error as Error).message,true) }
    finally { setBusy(false) }
  }

  return <div className="page-stack">
    <label className="search"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={t('ابحث بالرقم أو اسم الحساب','Search by number or account name')} aria-label={t('البحث عن رقم مكرر','Find a duplicate number')}/></label>
    {visible.map(([phone,accounts])=><section className="duplicate-group" key={phone}>
      <h3><ShieldAlert size={17}/><bdi>{phone}</bdi><span className="count-pill">{accounts.length}</span></h3>
      {accounts.map(account=><div className="entity-row" key={account.id}>
        <div><strong>{account.name}</strong><p><RoleName role={account.role}/>{account.duplicateOf&&<> · {t('بانتظار تأكيد الإنهاء','Awaiting closure confirmation')}</>}</p></div>
        {account.duplicateOf ? <button className="btn btn-outline compact" disabled={busy} onClick={()=>void change('duplicate-cancel',{id:account.id})}>{t('إلغاء طلب الإنهاء','Cancel closure')}</button>
          : account.id!==data.user?.id&&<button className="btn btn-outline compact" disabled={busy} onClick={()=>setSelection(account.id)}>{t('مراجعة الإنهاء','Review closure')}</button>}
      </div>)}
    </section>)}
    {!visible.length&&<Empty title={duplicates.length?t('لا توجد نتائج مطابقة','No matching results'):t('لا توجد أرقام مكررة','No duplicate numbers')}/>}
    {selected&&<Modal title={t('مراجعة حساب مكرر','Review a duplicate account')} close={()=>{if(!busy)setSelection('')}}>
      <form onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);void change('duplicate-review',{id:selection,keepId:fields.get('keepId'),confirmed:fields.get('confirmed')==='on'})}}>
        <div className="modal-body">
          <p>{t('الحساب المحدد للإنهاء','Account selected for closure')} · <strong>{selected.name}</strong></p>
          <label>{t('الحساب الذي سيبقى','Account to keep')}<select name="keepId" required defaultValue=""><option value="" disabled>{t('اختر الحساب الصحيح','Select the verified account')}</option>{group.filter(account=>account.id!==selection&&!account.duplicateOf).map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="check-line"><input type="checkbox" name="confirmed" required/>{isInvite?t('أؤكد حذف الدعوة المكررة نهائيًا.','I confirm permanent deletion of the duplicate invitation.'):t('تحققت من الحساب الصحيح وأوافق على طلب إنهاء الحساب المكرر.','I verified which account to keep and approve requesting closure of the duplicate.')}</label>
        </div>
        <div className="modal-foot"><button className="btn btn-outline" type="button" disabled={busy} onClick={()=>setSelection('')}>{t('رجوع','Back')}</button><button className="btn btn-primary" disabled={busy}>{isInvite?t('حذف الدعوة','Delete invitation'):t('اعتماد طلب الإنهاء','Approve closure request')}</button></div>
      </form>
    </Modal>}
  </div>
}
