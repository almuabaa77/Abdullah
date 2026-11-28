import { useState, type FormEvent } from 'react'
import { balanceFor, type LegacyPointReview } from './domain'
import { Empty, Modal, useWorkspace } from './ui'

export function AdminPointsReview() {
  const {data,t,post,tell}=useWorkspace()
  const [selected,setSelected]=useState<LegacyPointReview>()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [showDone,setShowDone]=useState(false)
  const reviews=data.legacyPointReviews??[]
  const selectedStudent=data.students.find(student=>student.id===selected?.studentId)
  async function approve(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(busy||!selected)return
    const form=new FormData(event.currentTarget)
    setBusy(true);setError('')
    try {
      await post('legacy-points-approve',{id:selected.studentId,credit:form.get('credit'),reason:form.get('reason')})
      setSelected(undefined)
      tell(t('حُفظت التسوية في سجل النقاط','Adjustment recorded'))
    } catch(e) {setError((e as Error).message)}
    finally {setBusy(false)}
  }
  return <div className="page-stack">
    <p>{t('راجع الرصيد القديم وصافي الحركات. تُضاف النقاط المعتمدة مرة واحدة إلى الرصيد الحالي للطالب.',
      'Review the old balance and the net of movements. Approved credits are added once to the student’s current balance.')}</p>
    <label className="check-line"><input type="checkbox" checked={showDone} onChange={event=>setShowDone(event.target.checked)}/>{t('إظهار التسويات المعتمدة','Show approved adjustments')}</label>
    <div className="admin-list">
      {!reviews.some(review=>!review.decision||showDone)&&<Empty title={t('لا توجد تسويات في هذا العرض','No adjustments in this view')}/>}
      {reviews.filter(review=>!review.decision||showDone).map(review=>{
        const student=data.students.find(item=>item.id===review.studentId)
        return <div className="entity-row" key={review.studentId}>
          <div><strong>{student?.name}</strong><p>{t('الرصيد القديم','Old balance')} <bdi>{review.stored}</bdi> · {t('صافي الحركات','Net movements')} <bdi>{review.ledger}</bdi> · {review.movements} {t('حركة','movements')}</p>
          {review.decision&&<p>{t('المعتمد','Approved')} <bdi>{review.decision.credit}</bdi> · {review.decision.reason}</p>}</div>
          {!review.decision&&<button type="button" className="btn btn-outline compact" onClick={()=>{setError('');setSelected(review)}}>{t('مراجعة الرصيد','Review balance')}</button>}
        </div>
      })}
    </div>
    {selected&&selectedStudent&&<Modal title={t('اعتماد تسوية النقاط','Approve adjustment')} close={()=>{if(!busy)setSelected(undefined)}}>
      <form onSubmit={approve}>
        <div className="modal-body">
          <strong>{selectedStudent.name}</strong>
          <p>{t('الرصيد الحالي القابل للصرف','Current spendable balance')} <bdi>{balanceFor(selectedStudent,data)}</bdi></p>
          <p>{t('الرصيد القديم','Old balance')} <bdi>{selected.stored}</bdi> · {t('صافي الحركات','Net movements')} <bdi>{selected.ledger}</bdi></p>
          <label>{t('النقاط المثبتة للإضافة','Verified points to add')}<input type="number" name="credit" required min="0" max="1000000" step="1" inputMode="numeric"/></label>
          <label>{t('سبب اعتماد هذا المقدار','Reason for this amount')}<textarea required name="reason" maxLength={240}/></label>
          {error&&<p className="error-box" role="alert">{error}</p>}
        </div>
        <div className="modal-foot"><button className="btn btn-primary" disabled={busy}>{t('اعتماد الإضافة','Approve credit')}</button></div>
      </form>
    </Modal>}
  </div>
}
