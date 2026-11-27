import { defaultCommunication, type Chat, type Circle, type State, type User } from '../src/domain'

export const activeAccount = (user:User) => user.status==='active'&&!user.duplicateOf
export function circleStudents(state:State,user:User,circle:Circle) {
  return state.students.filter(student=>student.active&&student.circleId===circle.id&&(
    user.role==='teacher'&&circle.teacherId===user.id||user.role==='student'&&user.studentId===student.id||
    user.role==='parent'&&state.links.some(link=>link.studentId===student.id&&link.parentId===user.id&&link.status==='accepted')))
}
export function belongsToCircle(state:State,user:User,circle:Circle) {
  return activeAccount(user)&&(user.role==='teacher'?circle.teacherId===user.id:circleStudents(state,user,circle).length>0)
}
export function directContext(state:State,first:User,second:User) {
  if(!state.rules.chat||first.id===second.id||!activeAccount(first)||!activeAccount(second))return
  const rules={...defaultCommunication,...state.rules.communication}
  if(first.role==='teacher'&&second.role==='teacher')return rules.staffDirect?{students:[],circles:[]}:undefined
  const pair=[first,second]
  const learner=pair.find(user=>user.role==='student'||user.role==='parent')
  if(!learner)return
  const staff=pair.find(user=>user.role==='teacher'||user.role==='admin')
  if(!staff)return
  const circles=state.circles.filter(circle=>belongsToCircle(state,learner,circle)&&(staff.role==='admin'||circle.teacherId===staff.id))
  if(!circles.length&&staff.role!=='admin')return
  const allowed=staff.role==='admin'?rules.adminDirect:learner.role==='student'?rules.studentDirect:rules.guardianDirect
  if(allowed)return {students:circles.flatMap(circle=>circleStudents(state,learner,circle).map(student=>student.id)),circles}
}
export function groupEligible(state:State,chat:Chat,account:User) {
  const circle=state.circles.find(item=>item.id===chat.circleId)
  return Boolean(circle&&belongsToCircle(state,account,circle)&&(chat.group?.audience==='circle'||account.role!=='parent'))
}
export function chatAccess(state:State,chat:Chat,account:User) {
  const rules={...defaultCommunication,...state.rules.communication}
  if(!state.rules.chat||!activeAccount(account))return false
  if(chat.circleId){
    const circle=state.circles.find(item=>item.id===chat.circleId)
    if(!circle||!rules.circleChat||!belongsToCircle(state,account,circle))return false
    if(!chat.group||account.role==='teacher')return true
    return groupEligible(state,chat,account)&&chat.group.invites[account.id]?.status==='accepted'
  }
  if(chat.members.length!==2||!chat.members.includes(account.id))return false
  const peer=state.users.find(user=>user.id!==account.id&&chat.members.includes(user.id))
  return Boolean(peer&&directContext(state,account,peer))
}
export function chatCanSend(state:State,chat:Chat,account:User) {
  return chatAccess(state,chat,account)&&!chat.locked&&(!chat.group||chat.group.posting==='everyone'||account.role==='teacher')
    &&(chat.group?!chat.blockedBy.includes(account.id):!chat.blockedBy.length)
}
export function groupMessages(chat:Chat,account:User) {
  const joined=account.role==='teacher'?undefined:chat.group?.invites[account.id]?.at
  return chat.messages.filter(message=>!message.hiddenAt&&(!joined||message.time>=joined))
}
