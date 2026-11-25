import { normalizeMobile } from '../src/phone-number'
import { balanceFor, circleMeets, dateKey, emptyDaily, idFor, nextCircleDate, pointsFor, validateSegments, type Attendance, type Chat, type Daily, type Exam, type Role, type State, type Student, type User, type View } from '../src/domain'
import { createState } from './seed'

export type Repository = {
  read(id: string): Promise<{ revision: number; data: string } | null>
  create(id: string, state: State): Promise<void>
  write(id: string, revision: number, state: State): Promise<boolean>
}
export type Env = { FIREBASE_WEB_CONFIG?: string; BOOTSTRAP_UID?: string }
type Identity = { id: string; phone?: string; workspace: string; bootstrap?: User }
type Payload = Record<string, unknown>
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
class ApiError extends Error { constructor(message: string, public status = 400) { super(message) } }
const deny = (msg = 'ليست لديك صلاحية تنفيذ هذه العملية'): never => { throw new ApiError(msg, 403) }
const clean = (x: unknown, max = 160) => typeof x === 'string' ? x.trim().slice(0, max) : ''
const required = (x: unknown, max = 160) => { const v = clean(x, max); if (!v) throw new ApiError('أكمل الحقول المطلوبة'); return v }
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
const chatVisible = (chat: Chat, user: User, ids: Set<string>, enabled: boolean) => user.role === 'admin' || enabled && (chat.members.includes(user.id) || Boolean(chat.circleId) && chat.students.some(id => ids.has(id)))
function project(state: State, user: User | null, revision: number, phoneEnabled: boolean): View {
  const empty = createState()
  const { operations: _discardEmpty, ...emptyView } = empty
  if (!user || user.status !== 'active') return { ...emptyView, user, revision, phoneEnabled, date: dateKey() }
  const students = scope(state, user)
  const ids = new Set(students.map(s => s.id))
  const publicStudent = (s: Student) => ({ ...s, phone: user.role === 'admin' || user.studentId === s.id ? s.phone : undefined })
  const chats = state.chats.filter(c => chatVisible(c, user, ids, state.rules.chat))
  const participants = new Set(chats.flatMap(c => [ ...c.members, ...c.messages.map(m => m.from) ]))
  const isAdmin = user.role === 'admin'
  return {
    user, revision, phoneEnabled, sample: state.sample, date: dateKey(), students: students.map(publicStudent),
    users: isAdmin ? state.users : state.users.filter(u => participants.has(u.id)).map(u => ({ id: u.id, name: u.name, role: u.role, status: u.status })),
    circles: state.circles.filter(c => isAdmin || c.teacherId === user.id || students.some(s => s.circleId === c.id)),
    daily: state.daily.filter(d => ids.has(d.studentId)), closed: state.closed.filter(key => isAdmin || state.circles.some(c => c.id === key.split('/')[0] && c.teacherId === user.id)),
    notices: state.notices.filter(n => (n.users?.includes(user.id) || (!n.users && (n.studentId ? ids.has(n.studentId) : true)))),
    links: state.links.filter(l => isAdmin || l.parentId === user.id).map(l => isAdmin || l.status === 'accepted' ? l : {...l, studentId: ''}),
    prizes: state.prizes.filter(p => isAdmin || p.active), orders: state.orders.filter(o => isAdmin || user.role === 'student' && ids.has(o.studentId)),
    exams: state.exams.filter(e => e.studentIds.some(id => ids.has(id))).map(e => ({ ...e, studentIds: e.studentIds.filter(id => ids.has(id)), results: Object.fromEntries(Object.entries(e.results).filter(([id]) => ids.has(id))) })),
    leaves: state.leaves.filter(l => ids.has(l.studentId)), rules: state.rules, audit: isAdmin ? state.audit.slice(-160).reverse() : [],
    chats: chats.map(c => isAdmin ? c : ({ ...c, students: c.students.filter(id => ids.has(id)), reports: [], pinnedBy: c.pinnedBy.filter(id => id === user.id), blockedBy: c.blockedBy.filter(id => id === user.id) })),
  }
}
async function identify(request: Request, env: Env): Promise<Identity | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if (token) {
    const config=firebaseConfig(env)
    if(!config)throw new ApiError('خدمة التحقق بالجوال غير متصلة',503)
    const { apiKey }=config
    const reply = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token })
    })
    if(reply.status===429||reply.status>=500)throw new ApiError('تعذر الوصول إلى خدمة التحقق بالجوال',503)
    const profile = (await reply.json() as { users?: { localId: string; phoneNumber?: string; disabled?: boolean }[] }).users?.[0]
    if (!reply.ok || !profile?.phoneNumber || profile.disabled) throw new ApiError('انتهت جلسة التحقق، سجّل الدخول مجددًا', 401)
    const { localId: id, phoneNumber: phone } = profile
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

function apply(state: State, identity: Identity, user: User | null, action: string, p: Payload, op: string) {
  if (action === 'register') {
    if (user || !identity.phone) deny()
    const name = required(p.name, 90)
    const role = choice(p.role, ['teacher','parent','student'] as const)
    const target = state.students.find(s => s.phone === identity.phone)
    state.users.push({ id: identity.id, name, phone: identity.phone, role, status: 'pending', studentId: role === 'student' ? target?.id : undefined })
    return
  }
  if (!user || user.status !== 'active') throw new ApiError('الحساب بانتظار التفعيل', 403)
  const u = user
  const visible = scope(state, u)
  const ids = new Set(visible.map(x => x.id))
  const student = () => { const s = visible.find(x => x.id === p.studentId && x.active); if (!s) throw new ApiError('الطالب خارج نطاق صلاحيتك', 403); return s }
  const staff = () => { if (!isStaff(u)) deny() }
  const admin = () => { if (u.role !== 'admin') deny() }
  const circleOf = (s: Student) => state.circles.find(c => c.id === s.circleId)
  const writeRecord = (d: Daily) => {
    const index = state.daily.findIndex(x => x.date === d.date && x.studentId === d.studentId)
    const before = index < 0 ? 0 : state.daily[index].points
    d.points = pointsFor(d, state.rules)
    if (index < 0) state.daily.push(d)
    else state.daily[index] = d
    if (before !== d.points) state.audit.push({ time: new Date().toISOString(), actor: u.name, action: 'تحديث النقاط', target: d.studentId, before, after: d.points })
  }
  switch (action) {
    case 'daily': {
      staff()
      const s = student(), circle = circleOf(s), date = validDate(p.date)
      if (!circleMeets(date, circle)) throw new ApiError('لا تنعقد الحلقة في هذا التاريخ')
      if (date > dateKey()) throw new ApiError('يمكن تسجيل التسميع حتى تاريخ اليوم')
      const old = state.daily.find(x => x.date === date && x.studentId === s.id)
      const d = { ...emptyDaily(s.id, date, circle), ...old }
      if (p.memorization !== undefined) d.memorization = validateSegments(p.memorization)
      if (p.review !== undefined) d.review = validateSegments(p.review)
      if (p.nextMemorization !== undefined) d.nextMemorization = validateSegments(p.nextMemorization)
      if (p.nextReview !== undefined) d.nextReview = validateSegments(p.nextReview)
      if (p.memorizationStatus) d.memorizationStatus = choice(p.memorizationStatus,['none','partial','complete'] as const)
      if (p.reviewStatus) d.reviewStatus = choice(p.reviewStatus,['none','partial','complete'] as const)
      if (!d.memorization.length) d.memorizationStatus = 'none'
      if (!d.review.length) d.reviewStatus = 'none'
      if (p.nextDate) d.nextDate = validDate(p.nextDate)
      if ((d.nextMemorization.length || d.nextReview.length) && (d.nextDate <= date || !circleMeets(d.nextDate, circle))) throw new ApiError('اختر موعدًا قادمًا يصادف يوم انعقاد الحلقة')
      if (p.note !== undefined) d.note = clean(p.note, 400)
      if (p.bonus !== undefined) d.bonus = integer(p.bonus, -100, 100)
      if (p.attendance !== undefined) d.attendance = choice(p.attendance, ['present','absent','excused','leave','pending'] as const)
      else if (p.memorization !== undefined && d.memorization.length || p.review !== undefined && d.review.length) d.attendance = 'present'
      if (d.attendance === 'pending' && state.closed.includes(s.circleId + '/' + date)) d.attendance = 'absent'
      writeRecord(d)
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
        writeRecord({ ...d, attendance: 'absent' })
        notify(state, 'attendance', `غياب ${s.name}`, date, {studentId:s.id})
      }
      state.closed.push(key)
      break
    }
    case 'notice-read': {
      for (const notice of state.notices) if ((!p.id || p.id === notice.id) && (!notice.users || notice.users.includes(u.id)) && (!notice.studentId || ids.has(notice.studentId)) && !notice.readBy.includes(u.id)) notice.readBy.push(u.id)
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
        if (d.attendance === 'pending' || d.attendance === 'absent') writeRecord({ ...d, attendance: 'leave' })
      }
      notify(state,'leave','تمت مراجعة طلب الاستئذان', l.date, {studentId:l.studentId})
      break
    }
    case 'link': {
      if (u.role !== 'parent') deny()
      const phone = phoneFor(p.phone)
      const s = state.students.find(s => s.active && s.phone === phone)
      if (s && !state.links.some(l => l.studentId === s.id && l.parentId === u.id && l.status !== 'declined')) {
        state.links.unshift({ id: op, parentId: u.id, studentId: s.id, status: 'pending' })
        notify(state,'link','طلب ربط طالب', u.name, {users:state.users.filter(x => x.role === 'admin').map(x=>x.id)})
      }
      return
    }
    case 'link-review': {
      admin()
      const link = state.links.find(x => x.id === p.id)
      if (!link || link.status !== 'pending') throw new ApiError('الطلب غير متاح')
      link.status = choice(p.status, ['accepted','declined'] as const)
      notify(state,'link','تمت مراجعة طلب ربط الطالب',link.status === 'accepted' ? 'يمكن الآن متابعة الطالب.' : 'تعذر اعتماد الطلب.',{users:[link.parentId]})
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
      if (!state.rules.chat) deny()
      const s = student(), teacher = circleOf(s)?.teacherId
      if (!teacher) throw new ApiError('لا يوجد محفظ معين للحلقة')
      const members = [...new Set([u.id, teacher, ...(state.users.find(x => x.studentId === s.id && x.role === 'student' && x.status === 'active') && isStaff(u) ? [state.users.find(x => x.studentId === s.id && x.role === 'student' && x.status === 'active')!.id] : [])])].sort()
      if (!state.chats.some(c => c.students.length === 1 && c.students[0] === s.id && c.members.slice().sort().join() === members.join()))
        state.chats.unshift({id:op,students:[s.id], members, title:s.name, reports:[],pinnedBy:[],blockedBy:[],messages:[]})
      return
    }
    case 'message':
    case 'chat-read':
    case 'chat-pin':
    case 'chat-report':
    case 'chat-block': {
      const chat = state.chats.find(c => c.id === p.id && chatVisible(c,u,ids,state.rules.chat))
      if (!chat) throw new ApiError('المحادثة غير متاحة')
      if (action === 'message') {
        if (!state.rules.chat || !chat.members.includes(u.id) && !(chat.circleId && chat.students.some(id => ids.has(id))) || chat.blockedBy.length) deny('إرسال الرسائل غير متاح لهذه المحادثة')
        const reply = clean(p.reply,50)
        if (reply && !chat.messages.some(m => m.id === reply)) throw new ApiError('الرسالة غير متاحة')
        const message = required(p.text, 3000)
        chat.messages.push({ id:op,from:u.id,text:message,time:new Date().toISOString(),reply:reply || undefined, readBy:[u.id] })
        const users = state.users.filter(x => x.id !== u.id && x.status === 'active' && chatVisible(chat,x,new Set(scope(state,x).map(s=>s.id)),state.rules.chat) && (x.role !== 'admin' || chat.members.includes(x.id))).map(x=>x.id)
        notify(state,'message','رسالة جديدة',chat.title,{users})
      }
      if (action === 'chat-read') for (const msg of chat.messages) if (!msg.readBy.includes(u.id)) msg.readBy.push(u.id)
      if (action === 'chat-pin') chat.pinnedBy = chat.pinnedBy.includes(u.id) ? chat.pinnedBy.filter(x => x !== u.id) : [...chat.pinnedBy,u.id]
      if (action === 'chat-block') chat.blockedBy = chat.blockedBy.includes(u.id) ? chat.blockedBy.filter(x => x !== u.id) : [...chat.blockedBy,u.id]
      if (action === 'chat-report' && !chat.reports.includes(u.id)) {
        chat.reports.push(u.id)
        notify(state,'message','بلاغ عن محادثة',chat.title,{users:state.users.filter(x => x.role === 'admin').map(x=>x.id)})
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
    case 'exam-result': {
      staff()
      const s = student(), exam = state.exams.find(x => x.id === p.id && x.studentIds.includes(s.id))
      if (!exam) throw new ApiError('الاختبار غير متاح للطالب')
      exam.results[s.id] = {score:integer(p.score,0,100),feedback:clean(p.feedback,400)}
      notify(state,'exam','تم تسجيل نتيجة الاختبار',exam.name,{studentId:s.id})
      break
    }
    case 'invite': {
      admin()
      const role = choice(p.role,['teacher','student','parent'] as const)
      const phone = phoneFor(p.phone)
      if(state.users.some(x=>x.phone===phone)) throw new ApiError('رقم الجوال مرتبط بحساب قائم')
      const target = state.students.find(x=>x.phone===phone && x.active)
      if(role==='student'&&!target)throw new ApiError('أضف الطالب ورقم جواله إلى الحلقة أولًا')
      state.users.push({id:'invite:'+op,role,phone,name:required(p.name,90),status:'active',studentId:role==='student'?target?.id:undefined})
      break
    }
    case 'account': {
      admin()
      const target = state.users.find(x => x.id === p.id)
      if (!target || target.id === u.id) deny()
      const status = choice(p.status,['active','disabled','pending'] as const)
      if (status === 'active' && target!.role === 'student') {
        const s = state.students.find(x => x.active && x.phone && x.phone === target!.phone)
        if (!s) throw new ApiError('أضف الطالب ورقم جواله إلى الحلقة قبل اعتماد الحساب')
        target!.studentId = s.id
      }
      target!.status = status
      break
    }
    case 'circle': {
      admin()
      const teacherId = required(p.teacherId)
      if (!state.users.some(x => x.id === teacherId && x.status === 'active' && isStaff(x))) throw new ApiError('اختر محفظًا مفعّلًا')
      const days = Array.isArray(p.days) ? [...new Set(p.days.map(x => integer(x,0,6)))] : []
      if (!days.length) throw new ApiError('اختر أيام انعقاد الحلقة')
      const circle = { id:clean(p.id) || op, name:required(p.name),teacherId,days,holidays:Array.isArray(p.holidays) ? [...new Set(p.holidays.map(validDate))] : [] }
      const idx = state.circles.findIndex(x => x.id === circle.id)
      if (idx < 0) state.circles.push(circle); else state.circles[idx] = circle
      const group = state.chats.find(c => c.circleId === circle.id)
      if (group) {group.title=circle.name;group.members=[teacherId]}
      else state.chats.push({id:idFor(),circleId:circle.id,title:circle.name,students:[],members:[teacherId],reports:[],pinnedBy:[],blockedBy:[],messages:[]})
      break
    }
    case 'student': {
      admin()
      const circleId = required(p.circleId)
      if (!state.circles.some(c => c.id === circleId)) throw new ApiError('اختر حلقة الطالب')
      const id = clean(p.id) || op
      const old = state.students.find(x => x.id === id)
      const phone = clean(p.phone) ? phoneFor(p.phone) : undefined
      if (phone && state.students.some(x => x.phone === phone && x.id !== id)) throw new ApiError('رقم الجوال مسجل لطالب آخر')
      const next: Student = { id, name:required(p.name,90), latin:clean(p.latin,90) || undefined, phone,circleId,
        color:old?.color ?? state.students.length % 5, startingPoints:old?.startingPoints ?? 0,active:p.active !== false }
      if (old) Object.assign(old,next); else state.students.push(next)
      for (const c of state.chats) if(c.circleId) c.students=state.students.filter(s=>s.active&&s.circleId===c.circleId).map(s=>s.id)
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
    case 'rules': {
      admin()
      state.rules = {memorization:integer(p.memorization,0,100),review:integer(p.review,0,100),attendance:integer(p.attendance,0,100),chat:p.chat === true}
      break
    }
    case 'announcement': {
      admin()
      notify(state,'announcement',required(p.title),required(p.body,600))
      break
    }
    default: throw new ApiError('العملية غير معروفة',404)
  }
  state.audit.push({ time:new Date().toISOString(),actor:u.name,action,target:clean(p.studentId || p.id || p.circleId) || undefined })
}

export async function api(request: Request, repo: Repository, env: Env = {}) {
  try {
    const url = new URL(request.url)
    const phoneEnabled = Boolean(env.FIREBASE_WEB_CONFIG)
    if (url.pathname === '/api/config' && request.method === 'GET') return Response.json({firebase:firebaseConfig(env)},{headers})
    const identity = await identify(request, env)
    if (!identity && request.method !== 'GET') throw new ApiError('سجّل الدخول أولًا',401)
    if (!identity) return Response.json(project(createState(),null,0,phoneEnabled),{headers})
    if (url.pathname !== '/api/workspace') return Response.json({ error:'الصفحة غير موجودة' },{status:404,headers})
    const get = request.method === 'GET'
    if (!get && request.method !== 'POST') throw new ApiError('الطريقة غير مسموحة',405)
    if (!get && request.headers.get('sec-fetch-site') === 'cross-site') deny()
    const raw = get ? '' : await request.text()
    if (raw.length > 75000) throw new ApiError('حجم الطلب غير مدعوم',413)
    const payload = get ? {} : JSON.parse(raw) as Payload
    const action = get ? '' : required(payload.action, 40)
    const op = get ? '' : required(payload.op, 70)
    if (!get && !/^[\w-]{10,70}$/.test(op)) throw new ApiError('معرّف العملية غير صالح')
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await repo.read(identity.workspace)
      if (!current) {
        await repo.create(identity.workspace,createState(identity.bootstrap,identity.workspace.startsWith('preview:')))
        continue
      }
      const state = JSON.parse(current.data) as State
      let user = state.users.find(x => x.id === identity.id) ?? null
      if (!user && identity.bootstrap) {
        state.users.push(identity.bootstrap)
        if (!(await repo.write(identity.workspace,current.revision,state))) continue
        continue
      }
      if (!user && identity.phone) {
        const invited = state.users.find(x=>x.id.startsWith('invite:') && x.phone===identity.phone)
        if(invited) {
          const oldId=invited.id
          invited.id=identity.id
          for(const circle of state.circles) if(circle.teacherId===oldId) circle.teacherId=identity.id
          for(const chat of state.chats) chat.members=chat.members.map(id=>id===oldId?identity.id:id)
          if(!(await repo.write(identity.workspace,current.revision,state)))continue
          continue
        }
      }
      const operationKey=identity.id+':'+op
      if (get || state.operations.includes(operationKey)) return Response.json(project(state,user,current.revision,phoneEnabled),{headers})
      apply(state,identity,user,action,payload,op)
      state.operations.push(operationKey)
      if (!(await repo.write(identity.workspace,current.revision,state))) continue
      user = state.users.find(x => x.id === identity.id) ?? null
      return Response.json(project(state,user,current.revision + 1,phoneEnabled),{headers})
    }
    throw new ApiError('حدث تحديث متزامن، أعد المحاولة',409)
  } catch (error) {
    const expected = error instanceof ApiError || error instanceof SyntaxError || error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
    if (!expected) console.error('workspace request failed',error instanceof Error ? error.name : 'UnknownError')
    return Response.json({ error: expected && error instanceof Error ? error.message : 'تعذر الاتصال ببيانات الحلقة' }, { status: error instanceof ApiError ? error.status : expected ? 400 : 500, headers })
  }
}
