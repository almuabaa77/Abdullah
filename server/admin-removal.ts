import { accountFingerprint, removeDuplicateAccount } from './account-phones'
import { ApiError } from './errors'
import type { State } from '../src/domain'

type Removal = 'parent' | 'student' | 'circle'

export async function removeSchoolEntry(state:State,kind:Removal,id:string,confirmation:string,reason:string,actor:string) {
  const target=kind==='parent'?state.users.find(item=>item.id===id&&item.role==='parent'):
    kind==='student'?state.students.find(item=>item.id===id):state.circles.find(item=>item.id===id)
  if(!target)return false
  if(confirmation.trim()!==target.name.trim()||!reason.trim())throw new ApiError('طابق الاسم وسجّل سبب الحذف')
  if(kind==='circle'&&(state.students.some(item=>item.circleId===id)||state.users.some(item=>item.enrollmentCircleId===id))){
    throw new ApiError('انقل الطلاب وطلبات التسجيل إلى حلقة أخرى قبل حذف الحلقة',409)
  }
  if(kind==='student'&&state.orders.some(item=>item.studentId===id&&['pending','approved','ready'].includes(item.status))){
    throw new ApiError('سوِّ طلبات الاستبدال المعلقة قبل حذف الطالب',409)
  }
  const accounts=kind==='parent'?[target.id]:kind==='student'?state.users.filter(item=>item.role==='student'&&item.studentId===id).map(item=>item.id):[]
  const removedAccounts=new Set(accounts)
  if(state.users.some(item=>!removedAccounts.has(item.id)&&item.duplicateOf&&removedAccounts.has(item.duplicateOf))){
    throw new ApiError('سوِّ الحسابات المكررة المرتبطة بهذا الرقم قبل الحذف',409)
  }
  const affectedLesson=(lesson:{studentId?:string;circleId?:string;invitees:string[]})=>
    (kind==='circle'&&lesson.circleId===id)||(kind==='student'&&lesson.studentId===id)||lesson.invitees.some(account=>removedAccounts.has(account))
  if(state.lessons?.some(lesson=>lesson.status==='live'&&(affectedLesson(lesson)||accounts.some(account=>Object.hasOwn(lesson.seats,account))))){
    throw new ApiError('أنهِ الجلسات المباشرة المرتبطة قبل الحذف',409)
  }
  for(const account of accounts){
    const fingerprint=await accountFingerprint(account)
    if(!state.closedAccounts?.includes(fingerprint))(state.closedAccounts??=[]).push(fingerprint)
    removeDuplicateAccount(state,account)
    for(const chat of state.chats)if(chat.group)delete chat.group.invites[account]
  }
  if(kind==='student'){
    state.students=state.students.filter(item=>item.id!==id)
    state.daily=state.daily.filter(item=>item.studentId!==id)
    state.links=state.links.filter(item=>item.studentId!==id)
    state.leaves=state.leaves.filter(item=>item.studentId!==id)
    state.orders=state.orders.filter(item=>item.studentId!==id)
    state.recordEvents=state.recordEvents?.filter(item=>item.studentId!==id)
    state.legacyPointReviews=state.legacyPointReviews?.filter(item=>item.studentId!==id)
    for(const exam of state.exams){
      exam.studentIds=exam.studentIds.filter(item=>item!==id)
      delete exam.results[id]
      if(exam.extensions)delete exam.extensions[id]
    }
    state.exams=state.exams.filter(exam=>exam.studentIds.length>0)
    if(state.assessments){
      state.assessments.items=state.assessments.items.filter(item=>item.studentId!==id)
      if(state.assessments.routes)delete state.assessments.routes[id]
    }
    for(const chat of state.chats)chat.students=chat.students.filter(item=>item!==id)
  }
  if(kind==='circle'){
    state.circles=state.circles.filter(item=>item.id!==id)
    state.closed=state.closed.filter(item=>!item.startsWith(id+'/'))
    if(state.assessments?.rings)delete state.assessments.rings[id]
    for(const exam of state.exams)if(exam.circleId===id)delete exam.circleId
  }
  const chats=new Set(state.chats.filter(chat=>kind==='circle'&&chat.circleId===id||!chat.circleId&&chat.members.length<2).map(chat=>chat.id))
  state.chats=state.chats.filter(chat=>!chats.has(chat.id))
  state.calls=state.calls?.filter(call=>!chats.has(call.chatId)&&!removedAccounts.has(call.from)&&!removedAccounts.has(call.to))
  const series=new Set(state.lessonSeries?.filter(series=>affectedLesson(series.draft)).map(series=>series.id))
  const lessons=new Set(state.lessons?.filter(lesson=>affectedLesson(lesson)||lesson.seriesId&&series.has(lesson.seriesId)).map(lesson=>lesson.id))
  state.lessonSeries=state.lessonSeries?.filter(item=>!series.has(item.id))
  state.lessons=state.lessons?.filter(item=>!lessons.has(item.id))
  state.lessonRestrictions=state.lessonRestrictions?.filter(item=>!lessons.has(item.lessonId))
  for(const lesson of state.lessons??[]){
    for(const account of accounts)delete lesson.seats[account]
    lesson.order=lesson.order.filter(account=>!removedAccounts.has(account))
    if(lesson.currentStudent&&removedAccounts.has(lesson.currentStudent))delete lesson.currentStudent
    lesson.messages=lesson.messages?.filter(message=>!removedAccounts.has(message.from))
  }
  state.notices=state.notices.filter(notice=>!(kind==='student'&&(notice.studentId===id||notice.recordReminder?.studentId===id||notice.announcement?.targetId===id))
    &&!(kind==='circle'&&(notice.recordReminder?.circleId===id||notice.announcement?.targetId===id))
    &&!(notice.lesson&&lessons.has(notice.lesson.id))
    &&!(notice.assessmentId&&!state.assessments?.items.some(item=>item.id===notice.assessmentId))
    &&!(notice.announcement?.targetId&&removedAccounts.has(notice.announcement.targetId)))
  state.audit.push({time:new Date().toISOString(),actor,action:'حذف دائم · '+kind+' · '+reason.trim().slice(0,240),target:id})
  return true
}
