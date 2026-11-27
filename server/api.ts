import { iconContentLimit, readablePalette, readPalette } from '../src/appearance'
import { webpBytes, type IconGenerator } from './appearance'
import type { AgoraEnvironment } from './agora'
import { newLessonMediaRoom } from './lesson-media-policy'
import type { LessonCredentials, LessonRtcStatus } from '../src/lessons'
import { ApiError } from './errors'
import { applyLessonAction, lessonActions, lessonRtcGrant, lessonNoticeAllowed, prepareLessonMediaRoom, projectLessons, recordLessonMediaPresence } from './lesson-workspace'
import { activeAccount, chatAccess, chatCanSend, directContext, groupEligible, groupMessages } from './chat-access'
import { announcementVisible } from './announcements'
import { scheduleAssessment } from './assessment'
import { asciiDigits, groupAccountsByPhone, normalizeMobile } from '../src/phone-number'
import { enrollmentNameKey, threePartName } from '../src/enrollment'
import { announcementAudiences, announcementSources, communicationKeys, defaultCommunication, examDateFor, balanceFor, callPeer, callState, circleMeets, dateKey, emptyDaily, idFor, needsRecordReminder, nextCircleDate, noticeExpiresAt, pointsFor, resolveAttendance, recordReminderMessage, reminderCooldown, reminderFields, validateSegments, type Attendance, type Chat, type ChatCall, type ChildRequest, type Daily, type Communication, type Exam, type Notice, type Role, type State, type Student, type StudentDetails, type User, type View } from '../src/domain'
import { createState } from './seed'
import { accountFingerprint, hasSharedPhone, removeDuplicateAccount, retainedAccount } from './account-phones'
import { memorizationChanged, recordChanges, reviewChanged } from './record-changes'

export type Repository = {
  read(id: string): Promise<{ revision: number; data: string } | null>
  create(id: string, state: State): Promise<void>
  write(id: string, revision: number, state: State, notices?: Notice[]): Promise<boolean>
}
export type PushGateway = (request:Request,user:User,payload:Record<string,unknown>) => Promise<Response>
export type Env = AgoraEnvironment & { FIREBASE_WEB_CONFIG?: string; BOOTSTRAP_UID?: string }
type Identity = { id: string; phone?: string; workspace: string; bootstrap?: User }
type Payload = Record<string, unknown>
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export { ApiError } from './errors'
const deny = (msg = 'ليست لديك صلاحية تنفيذ هذه العملية'): never => { throw new ApiError(msg, 403) }
const clean = (x: unknown, max = 160) => typeof x === 'string' ? x.trim().slice(0, max) : ''
const required = (x: unknown, max = 160) => { const v = clean(x, max); if (!v) throw new ApiError('أكمل الحقول المطلوبة'); return v }
const duplicatePhoneError = () => new ApiError('رقم الجوال مرتبط بحساب قائم. تواصل مع الإدارة للتحقق.',409)
const integer = (x: unknown, min: number, max: number) => { const value = Number(x); if (!Number.isInteger(value) || value < min || value > max) throw new ApiError('القيمة الرقمية خارج النطاق'); return value }
const choice = <T extends string>(x: unknown, values: readonly T[]): T => {
  if (typeof x !== 'string' || !values.includes(x as T)) throw new ApiError('خيار غير صالح')
  return x as T
}
function validDate(x: unknown) {
  const date = required(x, 10)
  const parsed = new Date(date + 'T12:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== date) throw new ApiError('تاريخ غير صالح')
  return date
}
function phoneFor(x:unknown) {
  const phone=normalizeMobile(clean(x,30))
  if(!phone)throw new ApiError('أدخل رقم جوال صحيحًا مع رمز الدولة')
  return phone
}
function enrollmentName(value:unknown) {
  const name=threePartName(value)
  if(!name)throw new ApiError('أدخل اسمًا من ثلاث كلمات فقط، بالحروف ومن دون أرقام أو رموز')
  return name
}
function learnerDetails(p:Payload,existing?:Student):StudentDetails {
  const age=asciiDigits(String(p.age ?? existing?.age ?? '')).trim()
  if((age||!existing||existing.age!==undefined)&&(!/^\d{1,3}$/.test(age)||Number(age)<1||Number(age)>120))throw new ApiError('أدخل عمرًا صحيحًا من 1 إلى 120 سنة')
  return {
    age:age?Number(age):undefined,
    schoolStage:!existing||existing.schoolStage?required(p.schoolStage ?? existing?.schoolStage,80):clean(p.schoolStage,80)||undefined,
    address:!existing||existing.address?required(p.address ?? existing?.address,240):clean(p.address,240)||undefined,
    guardianPhone:p.guardianPhone===undefined?existing?.guardianPhone:clean(p.guardianPhone)?phoneFor(p.guardianPhone):undefined,
  }
}
function childByIdentity(state:State,child:ChildRequest) {
  const matches=state.students.filter(student=>student.active&&normalizeMobile(student.phone ?? '')===child.phone
    &&enrollmentNameKey(student.name)===enrollmentNameKey(child.name))
  return matches.length===1?matches[0]:undefined
}
function attachChild(state:State,parent:User,student:Student,status:'pending'|'accepted') {
  const existing=state.links.find(link=>link.parentId===parent.id&&(link.status==='pending'||link.status==='accepted')&&
    (link.studentId===student.id||link.status==='pending'&&link.claim?.phone===normalizeMobile(student.phone ?? '')))
  if(existing){if(status==='accepted'){existing.status='accepted';existing.studentId=student.id;existing.reviewedAt=new Date().toISOString()}return false}
  state.links.unshift({id:idFor(),parentId:parent.id,studentId:student.id,status,createdAt:new Date().toISOString()})
  return true
}
function requestChild(state:State,parent:User,claim:ChildRequest) {
  const child=childByIdentity(state,claim)
  if(state.links.some(link=>link.parentId===parent.id&&(link.status==='pending'||link.status==='accepted')
    &&(link.claim?.phone===claim.phone||child&&link.studentId===child.id)))return false
  state.links.unshift({id:idFor(),parentId:parent.id,studentId:child?.id??'',status:'pending',claim,createdAt:new Date().toISOString()})
  return true
}
function syncCircleStudents(state:State) {
  for(const chat of state.chats)if(chat.circleId)chat.students=state.students.filter(s=>s.active&&s.circleId===chat.circleId).map(s=>s.id)
}
function enrollStudent(state:State,account:User,circleId:string,details?:StudentDetails) {
  if(!state.circles.some(circle=>circle.id===circleId))throw new ApiError('اختر حلقة الطالب')
  const phone=normalizeMobile(account.phone ?? '')
  if(!phone)throw new ApiError('رقم جوال الطالب غير صالح')
  const matches=state.students.filter(s=>normalizeMobile(s.phone ?? '')===phone)
  if(matches.length>1)throw new ApiError('يوجد أكثر من سجل للطالب بهذا الرقم. راجع سجلات الطلاب أولًا.',409)
  const existing=matches[0]
  if(existing&&!existing.active)throw new ApiError('سجل الطالب موقوف. فعّله من قسم الطلاب أولًا.',409)
  if(existing&&state.users.some(user=>user.id!==account.id&&user.studentId===existing.id))throw duplicatePhoneError()
  if(existing)Object.assign(existing,details,{circleId})
  else if(details)state.students.push({...details,id:idFor(),name:account.name,phone,circleId,color:state.students.length%5,startingPoints:0,active:true})
  else throw new ApiError('هذا الطلب قديم. أضف سجل الطالب وبياناته باستخدام رقم جوال الحساب أولًا.',409)
  account.studentId=existing?.id ?? state.students.at(-1)!.id
  delete account.studentDetails
  delete account.enrollmentCircleId
  syncCircleStudents(state)
}
type FirebaseConfig = { apiKey:string; authDomain:string; projectId:string; appId:string }
function firebaseConfig(env:Env):FirebaseConfig|null {
  if(!env.FIREBASE_WEB_CONFIG)return null
  try {
    const {apiKey,authDomain,projectId,appId}=JSON.parse(env.FIREBASE_WEB_CONFIG)
    if (![apiKey,authDomain,projectId,appId].every(v=>typeof v==='string'&&v.trim()))throw new Error()
    return {apiKey,authDomain,projectId,appId}
  } catch {throw new ApiError('إعدادات خدمة التحقق بالجوال غير مكتملة',503)}
}
const isStaff = (user: User) => user.role === 'teacher' || user.role === 'admin'
const scope = (s: State, u: User) => s.students.filter(st => u.role === 'admin'
  || (st.active && (u.role === 'teacher' && s.circles.some(c => c.id === st.circleId && c.teacherId === u.id)
  || u.role === 'student' && u.studentId === st.id
  || u.role === 'parent' && s.links.some(l => l.parentId === u.id && l.studentId === st.id && l.status === 'accepted'))))
function currentCall(state:State,call:ChatCall):ChatCall {
  const status=callState(call)
  const chat=state.chats.find(item=>item.id===call.chatId)
  if(status==='ringing'||status==='accepted') {
    const caller=state.users.find(user=>user.id===call.from)
    const peer=chat&&caller&&chatCanSend(state,chat,caller)&&({...defaultCommunication,...state.rules.communication})[call.mode]&&callPeer(chat,call.from)===call.to
    const participants=state.users.filter(user=>[call.from,call.to].includes(user.id)&&user.status==='active'&&!user.duplicateOf)
    if(peer&&participants.length===2)return call
    return {...call,status:'ended',offer:undefined,answer:undefined}
  }
  return {...call,status,offer:undefined,answer:undefined}
}
function callDescription(value:unknown) {
  if(typeof value!=='string'||value.length>24_000||!/^v=0\r?\n/.test(value)||!/^m=(audio|video) /m.test(value))throw new ApiError('بيانات اتصال المكالمة غير صالحة')
  return value
}
const noticeVisible = (notice:Notice,user:User,ids:Set<string>) => {
  if(notice.recordReminder && (user.role!=='teacher'||!ids.has(notice.recordReminder.studentId)))return false
  return notice.users?.includes(user.id) || (!notice.users && (!notice.studentId || ids.has(notice.studentId)))
}
function matchesReminderCircle(notice:Notice,state:State) {
  const target=notice.recordReminder
  return !target||state.students.some(student=>student.id===target.studentId&&student.circleId===target.circleId)
}
export function noticeRecipient(state:State,user:User,notice:Notice,adminUid?:string) {
  if(user.status!=='active'||user.duplicateOf||user.role==='admin'&&user.id!==adminUid)return false
  if(notice.announcement&&user.role==='admin'||noticeExpiresAt(notice)<=Date.now()||!lessonNoticeAllowed(state,notice,user))return false
  const students=notice.announcement||notice.recordReminder||notice.studentId&&!notice.users?scope(state,user):[]
  const ids=new Set(students.map(student=>student.id))
  if(notice.chatInvitationId) {
    const chat=state.chats.find(item=>item.id===notice.chatInvitationId)
    if(!chat||chat.group?.invites[user.id]?.status!=='pending'||!groupEligible(state,chat,user)||!state.rules.chat||state.rules.communication?.circleChat===false)return false
  }
  return announcementVisible(notice,state,user,students)&&!notice.announcement?.withdrawn&&noticeVisible(notice,user,ids)&&matchesReminderCircle(notice,state)
}
function project(state: State, user: User | null, revision: number, phoneEnabled: boolean, adminUid?:string,rtcConfigured=false,encrypted=false): View {
  if (!user || user.status !== 'active') {
    const { operations: _discardEmpty, appearanceIcon: _icon, closedAccounts: _closedAccounts, lessons:_lessons, lessonSeries:_lessonSeries, lessonRestrictions:_lessonRestrictions, lessonHealth:_lessonHealth, ...emptyView } = createState()
    return { ...emptyView, appearance:state.appearance, user, revision, phoneEnabled, date: dateKey() }
  }
  const students = scope(state, user)
  const ids = new Set(students.map(s => s.id))
  const publicStudent = (s: Student) => {
    if(user.role==='admin'||user.studentId===s.id)return s
    const {phone,address,guardianPhone,age,schoolStage,...roster}=s
    return roster
  }
  const assignedCircles=new Set(state.circles.filter(circle=>circle.teacherId===user.id).map(circle=>circle.id))
  const chats = state.chats.filter(chat=>user.role==='admin'||chatAccess(state,chat,user))
  const contacts=state.users.flatMap(other=>{
    if(other.role==='admin'&&adminUid&&other.id!==adminUid)return []
    const context=directContext(state,user,other)
    const name=other.role==='student'?state.students.find(student=>student.id===other.studentId)?.name??other.name:other.name
    return context?[{id:other.id,name,role:other.role,circleNames:context.circles.map(circle=>circle.name)}]:[]
  })
  const invitations=state.rules.chat&&(state.rules.communication?.circleChat??true)?state.chats.flatMap(chat=>{
    if(chat.group?.invites[user.id]?.status!=='pending'||!groupEligible(state,chat,user))return []
    return [{id:chat.id,title:chat.title,circleName:state.circles.find(circle=>circle.id===chat.circleId)?.name??'',audience:chat.group.audience,posting:chat.group.posting}]
  }):[]
  const participants = new Set(chats.flatMap(chat=>[...(chat.group?state.users.filter(account=>chatAccess(state,chat,account)).map(account=>account.id):chat.members),...groupMessages(chat,user).map(message=>message.from)]))
  const isAdmin = user.role === 'admin'
  return {
    user, revision, phoneEnabled, appearance:state.appearance, lessons:projectLessons(state,user,Date.now(),encrypted),lessonTeacherScheduling:state.lessonTeacherScheduling,
    lessonHealth:{rtcConfigured,encryptedMode:encrypted,...(isAdmin?state.lessonHealth:undefined),pendingRestrictions:isAdmin?state.lessonRestrictions?.length:undefined},chatContacts:contacts, chatInvitations:invitations, sample: state.sample, date: dateKey(), students: students.map(publicStudent),
    users: isAdmin ? state.users : state.users.filter(u => participants.has(u.id)).map(u => ({ id: u.id, name: u.name, role: u.role, status: u.status })),
    circles: state.circles.filter(c => isAdmin || c.teacherId === user.id || students.some(s => s.circleId === c.id)),
    daily: state.daily.filter(d => ids.has(d.studentId)), closed: state.closed.filter(key => isAdmin || state.circles.some(c => c.id === key.split('/')[0] && c.teacherId === user.id)),
    circleEnrollments:user.role==='teacher'?state.users.flatMap(account=>account.role==='student'&&account.status==='pending'
      &&!account.duplicateOf&&account.enrollmentCircleId&&assignedCircles.has(account.enrollmentCircleId)
      ?[{id:account.id,name:account.name,circleId:account.enrollmentCircleId}]:[]):undefined,
    recordEvents: isAdmin ? state.recordEvents?.slice(0,100) : undefined,
    recordReminders:isAdmin?state.notices.filter(notice=>notice.recordReminder&&notice.users?.[0]).slice(0,300)
      .map(notice=>({...notice.recordReminder!,teacherId:notice.users![0],time:notice.time})):undefined,
    calls:state.calls?.filter(call=>call.from===user.id||call.to===user.id).slice(0,50).map(call=>currentCall(state,call)),
    notices: state.notices.filter(notice => (notice.kind==='announcement'||noticeExpiresAt(notice)>Date.now()) && announcementVisible(notice,state,user,students)&&noticeVisible(notice,user,ids)&&matchesReminderCircle(notice,state)
      &&(!notice.chatInvitationId||invitations.some(invitation=>invitation.id===notice.chatInvitationId))&&lessonNoticeAllowed(state,notice,user))
      .map(notice=>{
        if(isAdmin||notice.kind!=='announcement')return notice
        const meta=notice.announcement
        return {...notice,readBy:notice.readBy.filter(id=>id===user.id),
          announcement:meta&&{...meta,targetId:undefined,dismissedBy:meta.dismissedBy?.includes(user.id)?[user.id]:[]}}
      }),
    links: state.links.filter(link=>isAdmin||link.parentId===user.id).map(link=>{
      if(isAdmin&&link.status==='pending'&&link.claim)return {...link,studentId:childByIdentity(state,link.claim)?.id??''}
      return isAdmin||link.status==='accepted'?link:{...link,studentId:''}
    }),
    prizes: state.prizes.filter(p => isAdmin || p.active), orders: state.orders.filter(o => isAdmin || user.role === 'student' && ids.has(o.studentId)),
    exams: state.exams.filter(e => e.studentIds.some(id => ids.has(id))).map(e => ({ ...e, studentIds: e.studentIds.filter(id => ids.has(id)), results: Object.fromEntries(Object.entries(e.results).filter(([id]) => ids.has(id))),
      extensions:e.extensions&&Object.fromEntries(Object.entries(e.extensions).filter(([id])=>ids.has(id))) })),
    leaves: state.leaves.filter(l => ids.has(l.studentId)), rules: state.rules, audit: isAdmin ? state.audit.slice(-160).reverse() : [],
    chats: chats.map(chat=>{
      if(isAdmin)return chat
      const members=chat.group?state.users.filter(account=>chatAccess(state,chat,account)).map(account=>account.id):chat.members
      return {...chat,members,students:chat.students.filter(id=>ids.has(id)),reports:[],
        group:chat.group&&{...chat.group,invites:{}},pinnedBy:chat.pinnedBy.filter(id=>id===user.id),
        blocked:chat.group?chat.blockedBy.includes(user.id):Boolean(chat.blockedBy.length),
        blockedBy:chat.blockedBy.filter(id=>id===user.id),locked:!chatCanSend(state,chat,user)&&!chat.blockedBy.includes(user.id),
        messages:groupMessages(chat,user)}
    }),
  }
}
async function identify(request: Request, env: Env): Promise<Identity | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if (token) {
    const config=firebaseConfig(env)
    if(!config)throw new ApiError('خدمة التحقق بالجوال غير متصلة',503)
    const { apiKey }=config
    let reply:Response
    try {
      reply = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(8000),
      })
    } catch {throw new ApiError('تعذر الوصول إلى خدمة التحقق بالجوال',503)}
    if(reply.status===429||reply.status>=500)throw new ApiError('تعذر الوصول إلى خدمة التحقق بالجوال',503)
    const profile = (await reply.json() as { users?: { localId: string; phoneNumber?: string; disabled?: boolean }[] }).users?.[0]
    if (!reply.ok || !profile?.phoneNumber || profile.disabled) throw new ApiError('انتهت جلسة التحقق، سجّل الدخول مجددًا', 401)
    const { localId: id } = profile
    const phone = normalizeMobile(profile.phoneNumber)
    if (!phone) throw new ApiError('رقم الجوال الموثق غير صالح',401)
    try {
      const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
      const claims=JSON.parse(atob(part))
      if(claims.aud!==config.projectId||claims.sub!==id||claims.firebase?.sign_in_provider!=='phone')throw new Error()
    } catch {throw new ApiError('سجّل الدخول بواسطة رمز الجوال للمتابعة',401)}
    return { id, phone, workspace: 'school', bootstrap: id === env.BOOTSTRAP_UID ? { id, phone, name: 'إدارة جامع الخير', role: 'admin', status: 'active' } : undefined }
  }
  const id = request.headers.get('oai-authenticated-user-id')
  if (!id) return null
  const role = request.headers.get('x-preview-role')
  const previewId = ['teacher','student','parent'].includes(role || '') ? 'demo-' + role : id
  return { id:previewId, workspace: 'preview:' + id, bootstrap: { id, name: 'عبدالرحمن آل سرحان', role: 'admin', status: 'active' } }
}
const notify = (s: State, kind: string, title: string, body: string, target: { studentId?: string; users?: string[] } = {}) =>
  s.notices.unshift({ ...target, id: idFor(), kind, title, body, time: new Date().toISOString(), readBy: [] })

function apply(state: State, identity: Identity, user: User | null, action: string, p: Payload, op: string, configuredAdmin?: string) {
  if (action === 'register') {
    const phone = identity.phone
    if (user || !phone) return deny()
    if (groupAccountsByPhone(state.users).has(phone)) throw duplicatePhoneError()
    const role = choice(p.role, ['teacher','parent','student'] as const)
    if(role!=='student'&&state.students.some(student=>normalizeMobile(student.phone ?? '')===phone))throw duplicatePhoneError()
    const account:User={id:identity.id,name:role==='teacher'?required(p.name,90):enrollmentName(p.name),phone,role,status:'pending'}
    if(role==='student') {
      const circleId=required(p.circleId)
      if(!state.circles.some(circle=>circle.id===circleId))throw new ApiError('اختر حلقة الطالب')
      account.enrollmentCircleId=circleId
      account.studentDetails=learnerDetails(p)
    } else if(role==='parent') {
      account.childRequest={name:required(p.childName,90),phone:phoneFor(p.childPhone)}
      requestChild(state,account,account.childRequest)
    } else account.address=required(p.address,240)
    state.users.push(account)
    return
  }
  if (!user || user.status !== 'active') throw new ApiError('الحساب بانتظار التفعيل', 403)
  const u = user
  if(lessonActions.has(action))return applyLessonAction(state,u,action,p,op)
  const visible = scope(state, u)
  const ids = new Set(visible.map(x => x.id))
  const student = () => { const s = visible.find(x => x.id === p.studentId && x.active); if (!s) throw new ApiError('الطالب خارج نطاق صلاحيتك', 403); return s }
  const staff = () => { if (!isStaff(u)) deny() }
  const admin = () => { if (u.role !== 'admin') deny() }
  const circleOf = (s: Student) => state.circles.find(c => c.id === s.circleId)
  const writeRecord = (d: Daily, student:Student) => {
    const index = state.daily.findIndex(x => x.date === d.date && x.studentId === d.studentId)
    const previous = state.daily[index] ?? emptyDaily(d.studentId,d.date,circleOf(student))
    if (!recordChanges(previous,d).length) return false
    d.points = pointsFor(d, state.rules)
    const changes = recordChanges(previous,d)
    const time = new Date().toISOString()
    d.version = (previous.version ?? 0) + 1
    d.updatedAt = time
    if (index < 0) state.daily.push(d)
    else state.daily[index] = d
    state.recordEvents = [{id:idFor(),studentId:d.studentId,circleId:student.circleId,date:d.date,actorId:u.id,time,changes},...(state.recordEvents ?? [])].slice(0,160)
    const assessment=scheduleAssessment(state,student,circleOf(student))
    if(assessment)state.notices.unshift(assessment)
    if (previous.points !== d.points) state.audit.push({ time, actor: u.name, action: 'تحديث النقاط', target: d.studentId, before:previous.points, after:d.points })
    return true
  }
  switch (action) {
    case 'daily': {
      staff()
      const s = u.role==='admin' ? visible.find(item=>item.id===p.studentId) : student()
      if (!s) return deny('الطالب خارج نطاق صلاحيتك')
      const circle = circleOf(s), date = validDate(p.date)
      const old = state.daily.find(x => x.date === date && x.studentId === s.id)
      const entry = p.entry===undefined ? 'record' : choice(p.entry,['record','edit'] as const)
      const editingHistory = u.role==='admin' && entry==='edit' && Boolean(old)
      if (!s.active && !editingHistory) return deny('سجل الطالب مؤرشف')
      if (!circleMeets(date,circle) && !editingHistory) throw new ApiError('لا تنعقد الحلقة في هذا التاريخ')
      if (date > dateKey()) throw new ApiError('يمكن تسجيل التسميع حتى تاريخ اليوم')
      const previous = old ?? emptyDaily(s.id,date,circle)
      const d = { ...previous }
      if (entry==='edit' && typeof p.baseVersion!=='number' || p.baseVersion!==undefined && p.baseVersion!==(previous.version ?? 0)) {
        throw new ApiError('حُدّث سجل الطالب في جلسة أخرى. أعد فتح أحدث نسخة قبل الحفظ.',409)
      }
      if (p.memorization !== undefined) d.memorization = validateSegments(p.memorization)
      if (p.review !== undefined) d.review = validateSegments(p.review)
      if (p.nextMemorization !== undefined) d.nextMemorization = validateSegments(p.nextMemorization)
      if (p.nextReview !== undefined) d.nextReview = validateSegments(p.nextReview)
      if (p.memorizationStatus) d.memorizationStatus = choice(p.memorizationStatus,['none','partial','complete'] as const)
      if (p.reviewStatus) d.reviewStatus = choice(p.reviewStatus,['none','partial','complete'] as const)
      if (!d.memorization.length) d.memorizationStatus = 'none'
      if (!d.review.length) d.reviewStatus = 'none'
      const changedMemorization = memorizationChanged(previous,d)
      const changedReview = reviewChanged(previous,d)
      if (entry==='record' && (previous.memorization.length && changedMemorization || previous.review.length && changedReview)) {
        throw new ApiError('سبق تسجيل هذا الجزء للطالب اليوم. افتح تعديل السجل لتصحيح البيانات.',409)
      }
      if (p.nextDate) d.nextDate = validDate(p.nextDate)
      const cleared=new Set(d.nextDate===previous.nextDate?previous.clearedAssignment??[]:[])
      const assigned=state.daily.filter(item=>item.studentId===s.id&&item.date<=date&&item.nextDate===d.nextDate)
      for(const field of ['nextMemorization','nextReview'] as const)if(p[field]!==undefined) {
        if(d[field].length)cleared.delete(field)
        else if(assigned.some(item=>item[field].length))cleared.add(field)
      }
      d.clearedAssignment=cleared.size?[...cleared]:undefined
      const scheduleChanged = recordChanges(previous,d).some(change=>change==='nextMemorization'||change==='nextReview')
      if (scheduleChanged && (d.nextMemorization.length || d.nextReview.length || d.clearedAssignment?.length) && (d.nextDate <= date || !circleMeets(d.nextDate, circle))) throw new ApiError('اختر موعدًا قادمًا يصادف يوم انعقاد الحلقة')
      if (p.note !== undefined) d.note = clean(p.note, 400)
      if (p.bonus !== undefined) d.bonus = integer(p.bonus, -100, 100)
      const explicit=p.attendance===undefined?undefined:choice(p.attendance,['present','absent','excused','leave','pending'] as const)
      Object.assign(d,resolveAttendance(previous,d,explicit,state.closed.includes(s.circleId+'/'+date),p.confirmDefaultAttendance===true))
      if (!writeRecord(d,s)) return false
      notify(state, 'daily', `تحديث سجل ${s.name}`, `${date} · ${d.points} نقاط`, { studentId: s.id })
      return
    }
    case 'close': {
      staff()
      const date = validDate(p.date)
      if (date > dateKey()) throw new ApiError('لا يمكن إغلاق يوم مستقبلي')
      const circle = state.circles.find(c => c.id === p.circleId && (u.role === 'admin' || c.teacherId === u.id))
      if (!circle) throw new ApiError('الحلقة خارج نطاق صلاحيتك', 403)
      if (!circleMeets(date, circle)) throw new ApiError('اليوم إجازة للحلقة')
      const key = circle.id + '/' + date
      if (state.closed.includes(key)) return
      for (const s of visible.filter(s => s.active && s.circleId === circle.id)) {
        const d = state.daily.find(d => d.date === date && d.studentId === s.id) ?? emptyDaily(s.id,date,circle)
        if (d.attendance !== 'pending') continue
        const result=resolveAttendance(d,d,undefined,true)
        writeRecord({...d,...result},s)
        if(result.attendance==='absent')notify(state,'attendance',`غياب ${s.name}`,date,{studentId:s.id})
      }
      state.closed.push(key)
      break
    }
    case 'record-reminder': {
      admin()
      const s = student(), date = validDate(p.date), field = choice(p.field, reminderFields)
      const circle = circleOf(s)
      if (!circle||circle.id!==p.circleId||date>dateKey()||!circleMeets(date,circle)) throw new ApiError('تحقق من الحلقة وتاريخ انعقادها')
      const teacher = state.users.find(account=>account.id===circle.teacherId&&account.role==='teacher'&&account.status==='active'&&!account.duplicateOf)
      if (!teacher) throw new ApiError('عيّن محفظًا نشطًا لهذه الحلقة قبل إرسال التنبيه',409)
      const record = state.daily.find(item=>item.studentId===s.id&&item.date===date)
      if (!needsRecordReminder(record,field)) throw new ApiError('حُدّثت هذه الخانة ولم تعد بحاجة إلى تنبيه',409)
      const last = state.notices.find(notice=>notice.users?.includes(teacher.id)&&notice.recordReminder?.studentId===s.id
        &&notice.recordReminder.circleId===circle.id&&notice.recordReminder.date===date&&notice.recordReminder.field===field)
      const now = Date.now()
      if (last && now-Date.parse(last.time)<reminderCooldown) throw new ApiError('أُرسل تنبيه لهذه الخانة مؤخرًا. انتظر قبل إعادة الإرسال.',409)
      const message = recordReminderMessage(s.name,field,record?.attendance==='absent')
      state.notices.unshift({id:idFor(),kind:'record-reminder',title:'تنبيه بشأن سجل طالب',en:'Student record reminder',
        body:message.ar,bodyEn:message.en,time:new Date(now).toISOString(),users:[teacher.id],readBy:[],
        recordReminder:{studentId:s.id,circleId:circle.id,date,field}})
      state.audit.push({time:new Date(now).toISOString(),actor:u.name,action:'إرسال تنبيه إلى المحفّظ',target:s.id})
      return
    }
    case 'notice-read': {
      for (const notice of state.notices) if ((!p.id || p.id === notice.id) && noticeExpiresAt(notice)>Date.now() && (!notice.announcement||notice.announcement.publishedAt&&!notice.announcement.withdrawn)
        && announcementVisible(notice,state,u,visible) && noticeVisible(notice,u,ids)
        && (!notice.studentId||ids.has(notice.studentId)) && matchesReminderCircle(notice,state) && !notice.readBy.includes(u.id)) notice.readBy.push(u.id)
      return
    }
    case 'leave': {
      if (u.role !== 'parent' && u.role !== 'student') deny()
      const s = student(), date = validDate(p.date)
      if (date < dateKey() || !circleMeets(date, circleOf(s))) throw new ApiError('اختر يوم انعقاد قادمًا')
      if (state.leaves.some(l => l.studentId === s.id && l.date === date && l.status !== 'declined')) throw new ApiError('يوجد طلب لهذا اليوم')
      state.leaves.unshift({ id: op, studentId: s.id, date, reason: required(p.reason, 400), status: 'pending' })
      notify(state,'leave','طلب استئذان جديد', s.name, { users: state.users.filter(x => x.role === 'admin' || x.id === circleOf(s)?.teacherId).map(x => x.id) })
      break
    }
    case 'leave-review': {
      staff()
      const l = state.leaves.find(x => x.id === p.id && ids.has(x.studentId))
      if (!l || l.status !== 'pending') throw new ApiError('الطلب غير متاح')
      l.status = choice(p.status, ['accepted','declined'] as const)
      if (l.status === 'accepted') {
        const s = visible.find(x => x.id === l.studentId)!
        const d = state.daily.find(x => x.date === l.date && x.studentId === l.studentId) ?? emptyDaily(l.studentId, l.date, circleOf(s))
        if (d.attendance === 'pending' || d.attendance === 'absent') writeRecord({ ...d, attendance: 'leave', attendanceSource:'manual' },s)
      }
      notify(state,'leave','تمت مراجعة طلب الاستئذان', l.date, {studentId:l.studentId})
      break
    }
    case 'link': {
      if (u.role !== 'parent') deny()
      const claim={name:required(p.childName,90),phone:phoneFor(p.phone)}
      if(requestChild(state,u,claim))notify(state,'link','طلب ربط طالب',u.name,{users:state.users.filter(x=>x.role==='admin').map(x=>x.id)})
      return
    }
    case 'link-withdraw': {
      const link=state.links.find(item=>item.id===p.id&&item.parentId===u.id&&item.status==='pending')
      if(!link||u.role!=='parent')return deny()
      link.status='cancelled'
      link.reviewedAt=new Date().toISOString()
      return
    }
    case 'link-review': {
      admin()
      const link = state.links.find(x => x.id === p.id)
      if (!link || link.status !== 'pending') throw new ApiError('الطلب غير متاح')
      const status = choice(p.status, ['accepted','declined'] as const)
      const guardian=state.users.find(user=>user.id===link.parentId&&user.role==='parent')
      if(status==='accepted'){
        if(guardian?.status!=='active'||guardian.duplicateOf)throw new ApiError('فعّل حساب ولي الأمر أولًا')
        const candidate=p.childId||(link.claim?childByIdentity(state,link.claim)?.id:link.studentId)
        const child=state.students.find(student=>student.id===candidate&&student.active)
        if(!child)throw new ApiError('حدّد سجل الابن قبل اعتماد الربط')
        if(state.links.some(other=>other.id!==link.id&&other.parentId===link.parentId&&other.studentId===child.id&&other.status==='accepted'))throw new ApiError('الابن مرتبط بهذا الحساب بالفعل',409)
        link.studentId=child.id
      }
      link.status=status
      link.reviewedAt=new Date().toISOString()
      if(guardian?.childRequest&&(link.claim?.phone===guardian.childRequest.phone||childByIdentity(state,guardian.childRequest)?.id===link.studentId))delete guardian.childRequest
      notify(state,'link','تمت مراجعة طلب ربط الطالب',status === 'accepted' ? 'يمكن الآن متابعة الطالب.' : 'تعذر اعتماد الطلب.',{users:[link.parentId]})
      break
    }
    case 'redeem': {
      if (u.role !== 'student') deny()
      const s = student(), prize = state.prizes.find(x => x.id === p.id && x.active)
      if (!prize || prize.stock < 1) throw new ApiError('الجائزة غير متاحة')
      const balance = balanceFor(s, state)
      if (balance < prize.price) throw new ApiError('رصيد النقاط غير كافٍ')
      prize.stock--
      state.orders.unshift({ id: op, studentId: s.id, prizeId: prize.id, name: prize.name, price: prize.price, status: 'pending', date: dateKey() })
      state.audit.push({ time:new Date().toISOString(),actor:u.name,action:'استبدال النقاط',target:s.id,before:balance,after:balance-prize.price })
      notify(state,'store','تم إرسال طلب الاستبدال',prize.name,{studentId:s.id})
      break
    }
    case 'order': {
      admin()
      const order = state.orders.find(x => x.id === p.id)
      if (!order) throw new ApiError('الطلب غير متاح')
      const next = choice(p.status, ['approved','ready','delivered','cancelled'] as const)
      const allowed: Record<string,string[]> = { pending:['approved','cancelled'], approved:['ready','cancelled'],ready:['delivered','cancelled'], delivered:[],cancelled:[] }
      if (!allowed[order.status].includes(next)) throw new ApiError('لا يمكن تعديل الطلب إلى هذه الحالة')
      const owner = state.students.find(s=>s.id===order.studentId)
      const balance = owner ? balanceFor(owner,state) : undefined
      order.status = next
      if (next === 'cancelled') {
        const still = state.prizes.find(x => x.id === order.prizeId)
        if (still) still.stock++
        if(balance!==undefined) state.audit.push({time:new Date().toISOString(),actor:u.name,action:'إرجاع النقاط',target:order.studentId,before:balance,after:balance+order.price})
      }
      notify(state,'store','تحديث طلب الاستبدال',order.name,{studentId:order.studentId})
      break
    }
    case 'chat-open': {
      const learner=p.targetId?undefined:student()
      const peerId=p.targetId??(u.role==='teacher'?state.users.find(account=>account.role==='student'&&account.studentId===learner?.id&&activeAccount(account))?.id:circleOf(learner!)?.teacherId)
      const peer=state.users.find(account=>account.id===peerId)
      if(!peer||peer.role==='admin'&&configuredAdmin&&peer.id!==configuredAdmin)return deny('جهة الاتصال غير متاحة')
      const context=directContext(state,u,peer)
      if(!context)return deny('المحادثة غير متاحة وفق صلاحيات التواصل')
      const members=[u.id,peer.id].sort()
      if(state.chats.some(chat=>!chat.circleId&&chat.members.length===2&&members.every(id=>chat.members.includes(id))))return false
      state.chats.unshift({id:op,students:context.students,members,title:peer.name,reports:[],pinnedBy:[],blockedBy:[],messages:[]})
      return
    }
    case 'group-create':
    case 'group-settings':
    case 'group-invite': {
      if(u.role!=='teacher'||!state.rules.chat||state.rules.communication?.circleChat===false)return deny()
      const creating=action==='group-create'
      const existing=creating?undefined:state.chats.find(chat=>chat.id===p.id&&chat.group)
      const circle=state.circles.find(item=>item.id===(creating?p.circleId:existing?.circleId)&&item.teacherId===u.id)
      if(!circle)return deny('الحلقة خارج نطاق صلاحيتك')
      const chat:Chat=existing??{id:op,circleId:circle.id,students:[],members:[u.id],title:'',reports:[],pinnedBy:[],blockedBy:[],messages:[],
        group:{audience:choice(p.audience,['students','circle'] as const),posting:'everyone',invites:{}}}
      if(action!=='group-invite'){
        chat.title=required(p.title,80)
        chat.group!.posting=choice(p.posting,['everyone','staff'] as const)
      }
      if(creating)state.chats.unshift(chat)
      if(action!=='group-settings'){
        const time=new Date().toISOString()
        for(const account of state.users.filter(account=>account.id!==u.id&&groupEligible(state,chat,account)&&!chat.group!.invites[account.id])) {
          chat.group!.invites[account.id]={status:'pending',at:time}
          state.notices.unshift({id:idFor(),kind:'group-invitation',title:'دعوة للانضمام إلى مجموعة الحلقة',en:'Invitation to join a circle group',
            body:chat.title,time,users:[account.id],readBy:[],chatInvitationId:chat.id})
        }
      }
      return
    }
    case 'group-respond':
    case 'group-leave': {
      const chat=state.chats.find(item=>item.id===p.id&&item.group)
      const invitation=chat?.group?.invites[u.id]
      if(!chat||!invitation||!groupEligible(state,chat,u))return deny()
      if(action==='group-leave'){
        if(invitation.status!=='accepted')return deny()
        invitation.status='left'
        chat.members=chat.members.filter(id=>id!==u.id)
      } else {
        if(!state.rules.chat||state.rules.communication?.circleChat===false||invitation.status!=='pending')return deny()
        invitation.status=choice(p.status,['accepted','declined'] as const)
        if(invitation.status==='accepted'&&!chat.members.includes(u.id))chat.members.push(u.id)
      }
      invitation.at=new Date().toISOString()
      return
    }
    case 'call-start': {
      const chat=state.chats.find(item=>item.id===p.id)
      const to=chat&&callPeer(chat,u.id)
      const mode=choice(p.mode,['audio','video'] as const)
      if(!(state.rules.communication??defaultCommunication)[mode]||u.role==='admin'||!chat||!chatCanSend(state,chat,u)||!to||!state.users.some(user=>user.id===to&&user.role!=='admin'&&user.status==='active'&&!user.duplicateOf))return deny('الاتصال غير متاح لهذه المحادثة')
      const calls=(state.calls??[]).map(call=>currentCall(state,call))
      if(calls.some(call=>[call.from,call.to].some(id=>id===u.id||id===to)&&(call.status==='ringing'||call.status==='accepted'))){
        throw new ApiError('أحد المشاركين لديه مكالمة سارية',409)
      }
      const time=new Date().toISOString()
      const call:ChatCall={id:op,chatId:chat.id,from:u.id,to,mode,status:'ringing',startedAt:time,updatedAt:time,offer:callDescription(p.offer)}
      const active=calls.filter(item=>item.status==='ringing'||item.status==='accepted')
      const past=calls.filter(item=>item.status!=='ringing'&&item.status!=='accepted').slice(0,500)
      state.calls=[call,...[...active,...past].sort((a,b)=>b.startedAt.localeCompare(a.startedAt))]
      notify(state,'call','مكالمة واردة','افتح قسم المكالمات للرد.',{users:[to]})
      return
    }
    case 'call-answer':
    case 'call-end': {
      const stored=state.calls?.find(item=>item.id===p.id&&(item.from===u.id||item.to===u.id))
      if(!stored)return deny('المكالمة غير متاحة')
      const call=currentCall(state,stored)
      if(action==='call-answer') {
        if(call.to!==u.id||call.status!=='ringing')return deny('انتهت دعوة المكالمة')
        stored.answer=callDescription(p.answer)
        stored.status='accepted'
      } else {
        if(call.status!=='ringing'&&call.status!=='accepted')return false
        stored.status=call.to===u.id&&call.status==='ringing'?'declined':'ended'
        delete stored.offer
        delete stored.answer
      }
      stored.updatedAt=new Date().toISOString()
      return
    }
    case 'chat-moderate': {
      admin()
      const chat=state.chats.find(chat=>chat.id===p.id)
      if(!chat)throw new ApiError('المحادثة غير متاحة',404)
      const decision=choice(p.decision,['lock','unlock','resolve','hide','restore'] as const)
      const time=new Date().toISOString()
      const actions={lock:'إيقاف إرسال المحادثة',unlock:'استئناف إرسال المحادثة',resolve:'إغلاق بلاغات المحادثة',hide:'إخفاء رسالة',restore:'إعادة إظهار رسالة'}
      if(decision==='lock'||decision==='unlock') {
        if(Boolean(chat.locked)===(decision==='lock'))return false
        chat.locked=decision==='lock'
      } else if(decision==='resolve') {
        if(!chat.reports.length)return false
        chat.reports=[]
      } else {
        const message=chat.messages.find(message=>message.id===p.messageId)
        if(!message)throw new ApiError('الرسالة غير متاحة',404)
        if(Boolean(message.hiddenAt)===(decision==='hide'))return false
        if(decision==='hide')message.hiddenAt=time
        else delete message.hiddenAt
      }
      state.audit.push({time,actor:u.name,action:actions[decision],target:chat.id})
      return
    }
    case 'message':
    case 'chat-read':
    case 'chat-pin':
    case 'chat-report':
    case 'chat-block': {
      const chat = state.chats.find(c => c.id === p.id && chatAccess(state,c,u))
      if (!chat) throw new ApiError('المحادثة غير متاحة')
      if (action === 'message') {
        if (!chatCanSend(state,chat,u)) deny('إرسال الرسائل غير متاح لهذه المحادثة')
        const reply = clean(p.reply,50)
        if (reply && !groupMessages(chat,u).some(m => m.id === reply)) throw new ApiError('الرسالة غير متاحة')
        const message = required(p.text, 3000)
        chat.messages.push({ id:op,from:u.id,text:message,time:new Date().toISOString(),reply:reply || undefined, readBy:[u.id] })
        const users = state.users.filter(x => x.id !== u.id && chatAccess(state,chat,x)&&!chat.blockedBy.includes(x.id)).map(x=>x.id)
        notify(state,'message','رسالة جديدة',chat.title,{users})
      }
      if (action === 'chat-read') for (const msg of groupMessages(chat,u)) if (!msg.readBy.includes(u.id)) msg.readBy.push(u.id)
      if (action === 'chat-pin') chat.pinnedBy = chat.pinnedBy.includes(u.id) ? chat.pinnedBy.filter(x => x !== u.id) : [...chat.pinnedBy,u.id]
      if (action === 'chat-block') chat.blockedBy = chat.blockedBy.includes(u.id) ? chat.blockedBy.filter(x => x !== u.id) : [...chat.blockedBy,u.id]
      if (action === 'chat-report' && !chat.reports.includes(u.id)) {
        chat.reports.push(u.id)
        notify(state,'chat-report','بلاغ عن محادثة',chat.title,{users:state.users.filter(x => x.role === 'admin').map(x=>x.id)})
      }
      return
    }
    case 'exam': {
      staff()
      const studentIds = Array.isArray(p.studentIds) ? [...new Set(p.studentIds.filter((x): x is string => typeof x === 'string' && ids.has(x)))] : []
      if (!studentIds.length) throw new ApiError('اختر طالبًا واحدًا على الأقل')
      const e: Exam = { id:op,name:required(p.name),place:required(p.place),scope:required(p.scope,400),date:validDate(p.date),studentIds,results:{} }
      state.exams.unshift(e)
      for (const studentId of studentIds) notify(state,'exam', e.name, e.date, {studentId})
      break
    }
    case 'exam-extension': {
      if(u.role!=='student')return deny()
      const s=student()
      const exam=state.exams.find(item=>item.id===p.id&&item.studentIds.includes(s.id))
      if(!exam||exam.results[s.id]||examDateFor(exam,s.id)<dateKey())throw new ApiError('انتهت مهلة طلب التأجيل لهذا الاختبار')
      if(exam.extensions?.[s.id]&&exam.extensions[s.id].status!=='declined')throw new ApiError('يوجد طلب مهلة لهذا الاختبار بالفعل',409)
      const date=validDate(p.date)
      if(date<=examDateFor(exam,s.id)||date<=dateKey()||exam.autoThreshold!==undefined&&!circleMeets(date,circleOf(s)))throw new ApiError('اختر تاريخًا بعد موعد الاختبار يوافق يوم انعقاد الحلقة')
      ;(exam.extensions??={})[s.id]={date,reason:required(p.reason,400),status:'pending'}
      const users=state.users.filter(user=>user.role==='admin'||user.id===circleOf(s)?.teacherId).map(user=>user.id)
      notify(state,'exam','طلب مهلة للاختبار',s.name,{users})
      return
    }
    case 'exam-extension-review': {
      staff()
      const s=student(),exam=state.exams.find(item=>item.id===p.id&&item.studentIds.includes(s.id))
      const extension=exam?.extensions?.[s.id]
      if(!exam||exam.results[s.id]||extension?.status!=='pending')throw new ApiError('طلب المهلة غير متاح')
      const status=choice(p.status,['accepted','declined'] as const)
      if(status==='accepted'&&(extension.date<=dateKey()||exam.autoThreshold!==undefined&&!circleMeets(extension.date,circleOf(s))))throw new ApiError('الموعد المقترح لم يعد متاحًا. ارفض الطلب ليتمكن الطالب من اختيار تاريخ آخر.')
      extension.status=status
      notify(state,'exam',status==='accepted'?'تم اعتماد مهلة الاختبار':'تم رفض مهلة الاختبار',status==='accepted'?extension.date:exam.name,{studentId:s.id})
      break
    }
    case 'exam-result': {
      staff()
      const s = student(), exam = state.exams.find(x => x.id === p.id && x.studentIds.includes(s.id))
      if (!exam) throw new ApiError('الاختبار غير متاح للطالب')
      exam.results[s.id] = {score:integer(p.score,0,100),feedback:clean(p.feedback,400)}
      if(exam.extensions?.[s.id]?.status==='pending')exam.extensions[s.id].status='declined'
      const assessment=scheduleAssessment(state,s,circleOf(s))
      if(assessment)state.notices.unshift(assessment)
      notify(state,'exam','تم تسجيل نتيجة الاختبار',exam.name,{studentId:s.id})
      break
    }
    case 'invite': {
      admin()
      const role = choice(p.role,['teacher','student','parent'] as const)
      const phone = phoneFor(p.phone)
      if(groupAccountsByPhone(state.users).has(phone)) throw duplicatePhoneError()
      if(role!=='student'&&state.students.some(student=>normalizeMobile(student.phone ?? '')===phone))throw duplicatePhoneError()
      const account:User={id:'invite:'+op,role,phone,name:role==='teacher'?required(p.name,90):enrollmentName(p.name),status:'active'}
      if(role==='student')enrollStudent(state,account,required(p.circleId),learnerDetails(p))
      if(role==='parent') {
        const child=state.students.find(student=>student.id===p.childId&&student.active)
        if(!child)throw new ApiError('اختر الابن من قائمة الطلاب النشطين')
        attachChild(state,account,child,'accepted')
      }
      if(role==='teacher')account.address=required(p.address,240)
      state.users.push(account)
      break
    }
    case 'account': {
      admin()
      const target = state.users.find(x => x.id === p.id)
      if (!target || target.id === u.id) deny()
      const status = choice(p.status,['active','disabled','pending'] as const)
      if (status === 'active' && (target!.duplicateOf || state.users.some(other=>hasSharedPhone(target!,other)&&other.duplicateOf!==target!.id))) throw duplicatePhoneError()
      if (status === 'active' && target!.role === 'student') {
        const linked=state.students.find(student=>student.id===target!.studentId&&student.active)
        const phone=normalizeMobile(target!.phone ?? '')
        const existing=linked ?? state.students.find(student=>phone&&normalizeMobile(student.phone ?? '')===phone)
        if(!linked||p.circleId) {
          const details=target!.studentDetails??(!existing&&p.age!==undefined?learnerDetails(p):undefined)
          enrollStudent(state,target!,clean(p.circleId)||target!.enrollmentCircleId||existing?.circleId||'',details)
        }
      }
      if(status==='active'&&target!.role==='parent'&&target!.childRequest) {
        const claim=target!.childRequest
        if(p.childId) {
          const child=state.students.find(student=>student.active&&student.id===p.childId)
          if(!child)throw new ApiError('اختر الابن من قائمة الطلاب النشطين')
          const pending=state.links.find(link=>link.parentId===target!.id&&link.status==='pending'&&link.claim?.phone===claim.phone)
          if(pending)pending.studentId=child.id
          attachChild(state,target!,child,'accepted')
          if(pending?.status==='pending'){pending.status='cancelled';pending.reviewedAt=new Date().toISOString()}
          delete target!.childRequest
        } else {
          const child=childByIdentity(state,claim)
          if(child)attachChild(state,target!,child,'pending')
        }
      }
      target!.status = status
      break
    }
    case 'duplicate-review': {
      admin()
      const target = state.users.find(account=>account.id===p.id)
      const keep = state.users.find(account=>account.id===p.keepId)
      if (!target || target.id===u.id || target.id===configuredAdmin) throw new ApiError('اختر حسابًا مكررًا غير حساب المدير الحالي أو المدير الأول',403)
      if (p.confirmed!==true || !keep || keep.duplicateOf || !hasSharedPhone(target,keep) || state.users.some(account=>account.duplicateOf===target.id)) {
        throw new ApiError('تحقق من الحساب الذي سيبقى ومن تطابق الرقم ثم أعد المحاولة',409)
      }
      if (state.circles.some(circle=>circle.teacherId===target.id)) throw new ApiError('أعد إسناد حلقات هذا المحفّظ قبل إنهاء حسابه',409)
      if (target.id.startsWith('invite:')) removeDuplicateAccount(state,target.id)
      else target.duplicateOf = keep.id
      state.audit.push({ time:new Date().toISOString(),actor:u.name,action:target.id.startsWith('invite:')?'حذف دعوة مكررة':'اعتماد إنهاء حساب مكرر',target:target.id })
      return
    }
    case 'duplicate-cancel': {
      admin()
      const target = state.users.find(account=>account.id===p.id)
      if (!target?.duplicateOf) throw new ApiError('لا يوجد طلب إنهاء لهذا الحساب',409)
      delete target.duplicateOf
      break
    }
    case 'circle': {
      admin()
      const teacherId = required(p.teacherId)
      if (!state.users.some(x => x.id === teacherId && x.status === 'active' && !x.duplicateOf && isStaff(x))) throw new ApiError('اختر محفظًا مفعّلًا')
      const days = Array.isArray(p.days) ? [...new Set(p.days.map(x => integer(x,0,6)))] : []
      if (!days.length) throw new ApiError('اختر أيام انعقاد الحلقة')
      const id=clean(p.id)||op
      const idx=state.circles.findIndex(x=>x.id===id)
      const circle = { id, name:required(p.name),teacherId,days,holidays:Array.isArray(p.holidays) ? [...new Set(p.holidays.map(validDate))] : [],autoExam:state.circles[idx]?.autoExam }
      if (idx < 0) state.circles.push(circle); else state.circles[idx] = circle
      const group = state.chats.find(c => c.circleId === circle.id&&!c.group)
      if (group) {group.title=circle.name;group.members=[teacherId]}
      break
    }
    case 'circle-assessment': {
      admin()
      const circle=state.circles.find(item=>item.id===p.id)
      if(!circle)throw new ApiError('الحلقة غير متاحة',404)
      if(p.enabled!==true){delete circle.autoExam;break}
      const time=required(p.time,5)
      if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))throw new ApiError('أدخل وقت الاختبار بتوقيت الرياض')
      circle.autoExam={threshold:integer(p.threshold,1,6236),leadDays:integer(p.leadDays,1,60),time,place:required(p.place)}
      for(const s of state.students.filter(student=>student.circleId===circle.id)){
        const assessment=scheduleAssessment(state,s,circle)
        if(assessment)state.notices.unshift(assessment)
      }
      break
    }
    case 'student': {
      admin()
      const circleId = required(p.circleId)
      if (!state.circles.some(c => c.id === circleId)) throw new ApiError('اختر حلقة الطالب')
      const id = clean(p.id) || op
      const old = state.students.find(x => x.id === id)
      const phone = p.phone===undefined ? old?.phone : clean(p.phone) ? phoneFor(p.phone) : undefined
      if (phone && state.students.some(x => x.id !== id && normalizeMobile(x.phone ?? '') === phone)) throw new ApiError('رقم الجوال مسجل لطالب آخر')
      const account=phone?state.users.find(x=>normalizeMobile(x.phone ?? '')===phone&&!x.duplicateOf):undefined
      if(account&&(account.role!=='student'||account.studentId&&account.studentId!==id))throw duplicatePhoneError()
      if(old&&(phone??null)!==normalizeMobile(old.phone ?? '')&&state.users.some(user=>user.studentId===id))throw new ApiError('رقم الطالب مرتبط بحساب. يُحدّث بعد التحقق من الرقم الجديد.')
      const next: Student = { ...learnerDetails(p,old),id, name:old&&p.name===old.name?old.name:enrollmentName(p.name), latin:clean(p.latin ?? old?.latin,90) || undefined, phone,circleId,
        color:old?.color ?? state.students.length % 5, startingPoints:old?.startingPoints ?? 0,active:p.active !== false }
      if (old) Object.assign(old,next); else state.students.push(next)
      if(account?.status==='active')account.studentId=id
      if(account?.status==='pending')account.enrollmentCircleId=circleId
      syncCircleStudents(state)
      break
    }
    case 'prize': {
      admin()
      const id = clean(p.id) || op, current = state.prizes.find(x => x.id === id)
      const image = clean(p.image,400)
      if (image && !/^https:\/\//.test(image)) throw new ApiError('استخدم رابط صورة HTTPS')
      const prize = { id,name:required(p.name),description:required(p.description,400),price:integer(p.price,1,10000),stock:integer(p.stock,0,10000),image:image || undefined,active:p.active !== false }
      if (current) Object.assign(current,prize); else state.prizes.push(prize)
      break
    }
    case 'appearance-save': {
      admin()
      const palette=readPalette(p.palette)
      if(!palette||!readablePalette(palette))throw new ApiError('تحقق من تباين النص واللون الأساسي مع الخلفيات.')
      let iconVersion=state.appearance?.iconVersion
      if(p.icon===null){
        delete state.appearanceIcon
        iconVersion=undefined
      }else if(p.icon!==undefined){
        if(typeof p.icon!=='string'||!webpBytes(p.icon,iconContentLimit))throw new ApiError('صيغة الأيقونة أو حجمها غير مدعوم.')
        state.appearanceIcon=p.icon
        iconVersion=crypto.randomUUID()
      }
      state.appearance={...palette,iconVersion}
      break
    }
    case 'rules': {
      admin()
      const previous=state.rules.communication??defaultCommunication
      const communication=Object.fromEntries(communicationKeys.map(key=>[key,typeof p[key]==='boolean'?p[key]:previous[key]])) as Communication
      state.rules = {memorization:integer(p.memorization,0,100),review:integer(p.review,0,100),attendance:integer(p.attendance,0,100),chat:p.chat === true,communication}
      break
    }
    case 'announcement': {
      admin()
      const audience=choice(p.audience??'all',announcementAudiences)
      const source=choice(p.source??'administration',announcementSources)
      const targetId=audience==='all'?undefined:required(p.targetId)
      const validTarget=audience==='all'||audience==='circle'&&state.circles.some(circle=>circle.id===targetId)
        ||audience==='student'&&state.students.some(student=>student.id===targetId&&student.active&&state.users.some(account=>account.studentId===student.id&&account.role==='student'&&account.status==='active'&&!account.duplicateOf))
        ||audience==='parent'&&state.users.some(user=>user.id===targetId&&user.role==='parent'&&user.status==='active'&&!user.duplicateOf)
      if(!validTarget)throw new ApiError('حدّد مستلمًا صالحًا للإعلان')
      const now=new Date().toISOString()
      const scheduled=p.delivery==='scheduled'
      const local=clean(p.publishAt)
      if(scheduled&&!/^\d{4}-\d{2}-\d{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(local))throw new ApiError('أدخل موعد نشر صالحًا')
      if(scheduled)validDate(local.slice(0,10))
      const publishAt=scheduled?new Date(local+':00+03:00').toISOString():now
      if(scheduled&&publishAt<=now)throw new ApiError('اختر موعدًا قادمًا للنشر بتوقيت الرياض')
      state.notices.unshift({id:idFor(),kind:'announcement',title:required(p.title),body:required(p.body,600),time:publishAt,readBy:[],
        announcement:{audience,source,targetId,publishAt,publishedAt:scheduled?undefined:now}})
      break
    }
    case 'announcement-dismiss':
    case 'announcement-withdraw': {
      if(action==='announcement-withdraw')admin()
      const notice=state.notices.find(item=>item.id===p.id&&item.kind==='announcement'&&announcementVisible(item,state,u,visible)&&noticeVisible(item,u,ids))
      if(!notice)throw new ApiError('الإعلان غير متاح',404)
      const item=notice.announcement??={audience:'all',source:'administration',publishAt:notice.time,publishedAt:notice.time}
      if(action==='announcement-withdraw'){item.withdrawn=true;break}
      if(item.withdrawn||!item.publishedAt)throw new ApiError('الإعلان غير متاح',404)
      if(item.dismissedBy?.includes(u.id))return false
      ;(item.dismissedBy??=[]).push(u.id)
      if(!notice.readBy.includes(u.id))notice.readBy.push(u.id)
      return
    }
    default: throw new ApiError('العملية غير معروفة',404)
  }
  state.audit.push({ time:new Date().toISOString(),actor:u.name,action,target:clean(p.studentId || p.id || p.circleId) || undefined })
}

export async function api(request: Request, repo: Repository, env: Env = {}, push?:PushGateway, rtc?:(grant:ReturnType<typeof lessonRtcGrant>)=>LessonCredentials, rtcStatus?:()=>Promise<LessonRtcStatus>, rtcAppId?:string, generateIcon?:IconGenerator) {
  try {
    const url = new URL(request.url)
    const events = url.pathname === '/api/workspace/events'
    const pushRoute = url.pathname === '/api/push'
    const iconRoute = url.pathname === '/api/appearance/generate'
    const rtcRoute = url.pathname === '/api/lesson-rtc'
    const rtcStatusRoute = url.pathname === '/api/lesson-rtc/status'
    const rtcPresenceRoute=url.pathname==='/api/lesson-rtc/presence'
    const specialRoute = rtcRoute||rtcStatusRoute||rtcPresenceRoute||iconRoute
    const phoneEnabled = Boolean(env.FIREBASE_WEB_CONFIG)
    if (['/api/appearance','/api/appearance/icon'].includes(url.pathname) && request.method==='GET') {
      const entry=await repo.read('school').catch(()=>null)
      const state=entry?JSON.parse(entry.data) as State:undefined
      if(url.pathname==='/api/appearance')return Response.json({appearance:state?.appearance,iconGeneration:Boolean(generateIcon)},{headers})
      const bytes=webpBytes(state?.appearanceIcon,iconContentLimit)
      if(!bytes||!state?.appearance?.iconVersion)return new Response(null,{status:302,headers:{...headers,Location:'/assets/icon-192.png'}})
      return new Response(bytes,{headers:{'Content-Type':'image/webp','X-Content-Type-Options':'nosniff',
        'Cache-Control':url.searchParams.get('v')===state.appearance.iconVersion?'public, max-age=86400':'no-store'}})
    }
    if (url.pathname === '/api/config' && request.method === 'GET') return Response.json({firebase:firebaseConfig(env)},{headers})
    const identity = await identify(request, env)
    if (!identity && (request.method !== 'GET' || events || pushRoute || specialRoute)) throw new ApiError('سجّل الدخول أولًا',401)
    if (!identity) return Response.json(project(createState(),null,0,phoneEnabled),{headers})
    const rtcConfigured=Boolean((rtc||rtcAppId)&&identity.workspace==='school')
    const encrypted=Boolean(rtcAppId&&identity.workspace==='school')
    if (url.pathname !== '/api/workspace' && !events && !pushRoute && !specialRoute) return Response.json({ error:'الصفحة غير موجودة' },{status:404,headers})
    const get = request.method === 'GET'
    if (events && !get || specialRoute && get) return Response.json({ error:'الطريقة غير مسموحة' },{status:405,headers})
    if (!get && request.method !== 'POST') throw new ApiError('الطريقة غير مسموحة',405)
    if (!get && request.headers.get('sec-fetch-site') === 'cross-site') deny()
    const raw = get ? '' : await request.text()
    if (raw.length > 75000) throw new ApiError('حجم الطلب غير مدعوم',413)
    const payload = get ? {} : JSON.parse(raw) as Payload
    const action = get||pushRoute||specialRoute ? '' : required(payload.action,40)
    const op = get||pushRoute||specialRoute ? '' : required(payload.op,70)
    if (!get && !pushRoute && !specialRoute && !/^[\w-]{10,70}$/.test(op)) throw new ApiError('معرّف العملية غير صالح')
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await repo.read(identity.workspace)
      if (!current) {
        await repo.create(identity.workspace,createState(identity.bootstrap,identity.workspace.startsWith('preview:')))
        continue
      }
      const state = JSON.parse(current.data) as State
      let user = state.users.find(x => x.id === identity.id) ?? null
      if (identity.workspace==='school' && user?.role==='admin' && identity.id!==env.BOOTSTRAP_UID) return deny('لوحة الإدارة مخصصة لحساب المدير المعتمد')
      const restricted = (accountAccess: NonNullable<View['accountAccess']>) => {
        if (events || pushRoute || specialRoute) return deny()
        return Response.json({ ...project(state,null,current.revision,phoneEnabled),accountAccess },{headers})
      }
      const fingerprint = identity.phone && (state.closedAccounts?.length || action==='duplicate-close') ? await accountFingerprint(identity.id) : undefined
      if (fingerprint && state.closedAccounts?.includes(fingerprint)) {
        if (get || action==='duplicate-close') return restricted('closed')
        deny('أُغلق حسابك بسبب تكرار رقم الجوال')
      }
      const phoneAccounts = identity.phone ? groupAccountsByPhone(state.users).get(identity.phone) ?? [] : []
      if (user && identity.phone && normalizeMobile(user.phone ?? '')!==identity.phone) {
        if (phoneAccounts.length || state.students.some(student=>student.id!==user!.studentId&&normalizeMobile(student.phone ?? '')===identity.phone)) {
          if (!get) throw duplicatePhoneError()
          return restricted('duplicate')
        }
        const userId = user.id
        user.phone = identity.phone
        const linked=state.students.find(student=>student.id===user!.studentId)
        if(user.role==='student'&&linked)linked.phone=identity.phone
        delete user.duplicateOf
        for (const account of state.users) if (account.duplicateOf===userId) delete account.duplicateOf
        await repo.write(identity.workspace,current.revision,state)
        continue
      }
      if (user?.duplicateOf) {
        if (get) return restricted(retainedAccount(state,user) ? 'closure-pending' : 'duplicate')
        if (action!=='duplicate-close') deny('الحساب المكرر بانتظار تأكيد الإنهاء')
        if (payload.confirmed!==true || !fingerprint || user.id===env.BOOTSTRAP_UID || !retainedAccount(state,user)) {
          throw new ApiError('تعذر تأكيد الإنهاء. تواصل مع الإدارة لمراجعة الحساب المكرر.',409)
        }
        removeDuplicateAccount(state,user.id)
        state.closedAccounts = [...(state.closedAccounts ?? []),fingerprint]
        state.audit.push({time:new Date().toISOString(),actor:'النظام',action:'حذف الحساب المكرر بعد التأكيد'})
        if (await repo.write(identity.workspace,current.revision,state)) return restricted('closed')
        continue
      }
      if (!user && phoneAccounts.length) {
        const candidates = phoneAccounts.filter(account=>!account.duplicateOf)
        const invited = candidates.length===1 && candidates[0].id.startsWith('invite:') ? candidates[0] : undefined
        if (invited) {
          const oldId = invited.id
          invited.id = identity.id
          invited.phone = identity.phone
          if (identity.bootstrap && invited.status==='active') invited.role = identity.bootstrap.role
          for (const account of state.users) if (account.duplicateOf===oldId) account.duplicateOf = identity.id
          for (const circle of state.circles) if (circle.teacherId===oldId) circle.teacherId = identity.id
          for (const chat of state.chats) chat.members = chat.members.map(id=>id===oldId ? identity.id : id)
          for (const link of state.links) if(link.parentId===oldId)link.parentId=identity.id
          for(const meeting of [...(state.lessons??[]),...(state.lessonSeries??[]).map(series=>series.draft)]){
            if(meeting.teacherId===oldId)meeting.teacherId=identity.id
            if(meeting.substituteId===oldId)meeting.substituteId=identity.id
            meeting.invitees=meeting.invitees.map(id=>id===oldId?identity.id:id)
          }
          for(const notice of state.notices)if(notice.lesson&&notice.users)notice.users=notice.users.map(id=>id===oldId?identity.id:id)
          await repo.write(identity.workspace,current.revision,state)
          continue
        }
        if (!get) throw duplicatePhoneError()
        return restricted('duplicate')
      }
      if (identity.bootstrap && (!user || (identity.phone && user.status === 'pending'))) {
        if (user) {
          user.role = identity.bootstrap.role
          user.status = identity.bootstrap.status
          user.phone = identity.bootstrap.phone
          delete user.studentId
          delete user.enrollmentCircleId
          delete user.studentDetails
          delete user.childRequest
          state.audit.push({ time:new Date().toISOString(),actor:user.name,action:'تفعيل المدير الأول',target:user.id })
        } else {
          state.users.push(identity.bootstrap)
        }
        await repo.write(identity.workspace,current.revision,state)
        continue
      }
      if (user && user.role!=='admin' && state.users.some(account=>hasSharedPhone(user!,account) && account.duplicateOf!==user!.id)) {
        if (!get) throw duplicatePhoneError()
        return restricted('duplicate')
      }
      const operationKey=identity.id+':'+op
      if(iconRoute){
        if(user?.role!=='admin'||user.status!=='active'||identity.workspace!=='school')return deny()
        if(!generateIcon)throw new ApiError('خدمة توليد الأيقونات تحتاج إلى مفتاح Gemini أو OpenAI في إعدادات الخادم.',503)
        const description=required(payload.description,350)
        const palette=readPalette(payload.palette)
        if(!palette||!readablePalette(palette))throw new ApiError('اختر ألوانًا واضحة للأيقونة وطابع التطبيق.')
        return Response.json(await generateIcon(description,palette),{headers})
      }
      if(rtcStatusRoute) {
        if(user?.role!=='admin'||user.status!=='active'||identity.workspace!=='school')return deny()
        if(!rtcStatus)throw new ApiError('فحص Agora متاح على خادم الاستضافة',503)
        const status:LessonRtcStatus={...await rtcStatus(),mode:rtcAppId?'encrypted':rtc?'signed':'disabled'}
        if(payload.probe===true){
          if(rtcAppId){
            const room=newLessonMediaRoom(0)
            status.probe={appId:rtcAppId,channel:room.channel,uid:1,token:null,audio:false,video:false,
              encryption:{secret:room.secret,salt:room.salt},version:0}
          }else if(rtc){
            status.probe=rtc({lessonId:'diagnostic-'+crypto.randomUUID(),uid:1,audio:false,video:false,ttl:35})
          }
        }
        return Response.json(status,{headers})
      }
      if(rtcRoute) {
        if(!user||user.status!=='active'||identity.workspace!=='school')return deny()
        if(!rtc&&!rtcAppId)throw new ApiError('إعدادات Agora غير مكتملة',503)
        if(typeof payload.id!=='string'||payload.id.length>100)throw new ApiError('تحقق من معرّف الجلسة')
        const grant=lessonRtcGrant(state,user,payload.id,Date.now(),encrypted)
        const lesson=state.lessons!.find(item=>item.id===grant.lessonId)!
        if(rtcAppId){
          const saved=Boolean(lesson.mediaRoom)
          const room=prepareLessonMediaRoom(state,lesson)
          if(!saved&&!(await repo.write(identity.workspace,current.revision,state)))continue
          const reply:LessonCredentials={appId:rtcAppId,channel:room.channel,uid:grant.uid,token:null,audio:grant.audio,video:grant.video,
            version:room.version,encryption:{secret:room.secret,salt:room.salt}}
          return Response.json(reply,{headers})
        }
        if(lesson.mediaRoom){
          delete lesson.mediaRoom
          if(!(await repo.write(identity.workspace,current.revision,state)))continue
        }
        return Response.json(rtc!(grant),{headers})
      }
      if(rtcPresenceRoute){
        if(!user||user.status!=='active'||identity.workspace!=='school'||!rtcAppId)return deny()
        if(typeof payload.id!=='string'||payload.id.length>100||typeof payload.uid!=='number'||!Number.isInteger(payload.uid)
          ||typeof payload.version!=='number'||!Number.isInteger(payload.version))throw new ApiError('تحقق من بيانات اتصال الجلسة')
        if(recordLessonMediaPresence(state,user,payload.id,payload.uid,payload.version)
          &&!(await repo.write(identity.workspace,current.revision,state)))continue
        return new Response(null,{status:204,headers})
      }
      if (pushRoute) {
        if(!user||user.status!=='active')return deny()
        if(!push||identity.workspace!=='school')throw new ApiError('تنبيهات الخلفية غير متاحة في هذا الإصدار',503)
        return await push(request,user,payload)
      }
      if (events) {
        if (url.searchParams.get('scope')==='reminders'&&user?.role==='teacher'&&user.status==='active') {
          return Response.json({revision:current.revision,recipient:user.id},{headers})
        }
        if (user?.role!=='admin'||user.status!=='active') return deny()
        return Response.json({revision:current.revision},{headers})
      }
      if (get && identity.workspace==='school' && user?.role==='admin' && user.status==='active'
        && url.searchParams.get('since')===String(current.revision) && url.searchParams.get('date')===dateKey()) {
        return new Response(null,{status:204,headers})
      }
      if (get || state.operations.includes(operationKey)) {
        const view=project(state,user,current.revision,phoneEnabled,env.BOOTSTRAP_UID,rtcConfigured,encrypted)
        if(!user&&identity.phone) {
          view.verifiedPhone=identity.phone
          view.enrollmentCircles=state.circles.map(({id,name})=>({id,name}))
        }
        return Response.json(view,{headers})
      }
      const previousNotices=state.notices.length
      if (apply(state,identity,user,action,payload,op,env.BOOTSTRAP_UID)===false) return Response.json(project(state,user,current.revision,phoneEnabled,env.BOOTSTRAP_UID,rtcConfigured,encrypted),{headers})
      state.operations.push(operationKey)
      if (!(await repo.write(identity.workspace,current.revision,state,state.notices.slice(0,Math.max(0,state.notices.length-previousNotices)).filter(notice=>!notice.announcement||notice.announcement.publishedAt)))) continue
      user = state.users.find(x => x.id === identity.id) ?? null
      return Response.json(project(state,user,current.revision + 1,phoneEnabled,env.BOOTSTRAP_UID,rtcConfigured,encrypted),{headers})
    }
    throw new ApiError('حدث تحديث متزامن، أعد المحاولة',409)
  } catch (error) {
    const expected = error instanceof ApiError || error instanceof SyntaxError || error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
    if (!expected) console.error('workspace request failed',error instanceof Error ? error.name : 'UnknownError')
    return Response.json({ error: expected && error instanceof Error ? error.message : 'تعذر الاتصال ببيانات الحلقة' }, { status: error instanceof ApiError ? error.status : expected ? 400 : 500, headers })
  }
}
