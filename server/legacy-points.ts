import { balanceFor, type State } from '../src/domain'
import { ApiError } from './errors'

export function approveLegacyPoints(state:State,id:string,credit:number,reason:string,actor:string) {
  const target=state.students.find(item=>item.id===id)
  const review=state.legacyPointReviews?.find(item=>item.studentId===id)
  if(!target||!review)throw new ApiError('تسوية الرصيد غير متاحة',404)
  if(review.decision)return false
  if(!Number.isSafeInteger(credit)||credit<0||credit>1_000_000||!reason.trim())throw new ApiError('سجّل مقدارًا صحيحًا وسبب التسوية')
  const before=balanceFor(target,state)
  target.startingPoints+=credit
  const time=new Date().toISOString()
  review.decision={credit,reason,time,actor}
  state.audit.push({time,actor,action:'تسوية نقاط Base44 · '+reason,target:target.id,before,after:balanceFor(target,state)})
  return true
}
