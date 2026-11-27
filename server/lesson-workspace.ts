import { Temporal } from '@js-temporal/polyfill'
import { circleMeets, dayOffset, idFor, type Notice, type State, type User } from '../src/domain'
import { lessonCapacity, type Lesson, type LessonDraft, type LessonKind, type LessonMedia, type LessonSeat, type LessonSeries, type LessonView } from '../src/lessons'
import { activeAccount } from './chat-access'
import { lessonUid, tokenLifetime } from './lesson-media-policy'
import { ApiError } from './errors'

const minute=60_000
export const lessonActions=new Set([
  'lesson-save','lesson-cancel','lesson-join','lesson-leave','lesson-admit','lesson-decline','lesson-remove',
  'lesson-hand','lesson-message','lesson-turn','lesson-order','lesson-mic-request','lesson-mic-answer',
  'lesson-media','lesson-extend','lesson-end','lesson-settings',
])
const liveSeats=(lesson:Lesson)=>Object.entries(lesson.seats).filter(([,seat])=>seat.status==='admitted')
const capacityFor=(state:State,lesson:Lesson)=>liveSeats(lesson).some(([id])=>state.users.some(user=>user.id===id&&user.role==='admin'))?lessonCapacity:lessonCapacity-1
const scheduledOrLive=(lesson:Lesson)=>lesson.status==='scheduled'||lesson.status==='live'
const forbidden=()=>new ApiError('الجلسة خارج نطاق صلاحيتك',403)
const requireText=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):''
function selection<T extends string>(value:unknown,allowed:readonly T[]):T {
  if(!allowed.includes(value as T))throw new ApiError('تحقق من الخيارات المحددة')
  return value as T
}
function parseDate(input:unknown) {
  if(typeof input!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input))throw new ApiError('تحقق من تاريخ الجلسة')
  try {return Temporal.PlainDate.from(input).toString()}catch{throw new ApiError('تحقق من تاريخ الجلسة')}
}
function parseClock(input:unknown) {
  if(typeof input!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input))throw new ApiError('تحقق من وقت بداية الجلسة ونهايتها')
  return input
}
function timestamp(draft:LessonDraft,date:string,time:string) {
  try {return Temporal.ZonedDateTime.from(date+'T'+time+'['+draft.zone+']',{disambiguation:'reject'}).toInstant().toString()}
  catch {throw new ApiError('تحقق من المنطقة الزمنية والوقت المحلي')}
}
function localDay(zone:string,now:number) {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate().toString()
}
function isManager(state:State,lesson:Pick<Lesson,'circleId'|'teacherId'|'substituteId'>,user:User) {
  if(user.role==='admin')return activeAccount(user)
  if(user.role!=='teacher'||!activeAccount(user))return false
  return lesson.teacherId===user.id||lesson.substituteId===user.id||Boolean(lesson.circleId&&state.circles.some(circle=>circle.id===lesson.circleId&&circle.teacherId===user.id))
}
export function allowedInLesson(state:State,lesson:Pick<Lesson,'kind'|'circleId'|'studentId'|'invitees'|'teacherId'|'substituteId'>,user:User) {
  if(!activeAccount(user))return false
  if(isManager(state,lesson,user))return true
  if(lesson.kind==='meeting'||lesson.kind==='urgent')return lesson.invitees.includes(user.id)&&(
    user.role==='teacher'||user.role==='student'&&state.students.some(student=>student.active&&student.id===user.studentId)
  )
  if(user.role!=='student')return false
  return state.students.some(student=>student.active&&student.id===user.studentId&&student.circleId===lesson.circleId
    &&(lesson.kind==='circle'||student.id===lesson.studentId))
}
function participants(state:State,lesson:Lesson) {
  return state.users.filter(user=>user.role!=='admin'&&allowedInLesson(state,lesson,user))
}
export function lessonNoticeAllowed(state:State,notice:Notice,user:User) {
  if(!notice.lesson)return true
  const lesson=state.lessons?.find(lesson=>lesson.id===notice.lesson?.id)
  if(!lesson||notice.lesson.revision!==lesson.revision||!allowedInLesson(state,lesson,user))return false
  return notice.lesson.reminder===undefined||scheduledOrLive(lesson)
}
function lessonNotice(state:State,lesson:Lesson,kind:string,title:string,users:string[],now:number,reminder?:number) {
  if(!users.length)return
  state.notices.unshift({id:idFor(),kind,title,body:lesson.title,time:new Date(now).toISOString(),readBy:[],users,
    lesson:{id:lesson.id,revision:lesson.revision,reminder}})
}
function audit(state:State,user:User,lesson:Lesson,action:string,now:number) {
  state.audit.push({time:new Date(now).toISOString(),actor:user.name,action,target:lesson.id})
}
function restrictionsPending(state:State,lesson:Lesson) {
  return Boolean(state.lessonRestrictions?.some(rule=>rule.lessonId===lesson.id))
}
export function projectLessons(state:State,user:User,now=Date.now()):LessonView[] {
  const historical=45*24*60*minute
  return (state.lessons??[]).filter(lesson=>allowedInLesson(state,lesson,user)&&Date.parse(lesson.endsAt)>=now-historical).sort((a,b)=>a.startsAt.localeCompare(b.startsAt))
    .slice(0,450).map(lesson=>{
      const manager=isManager(state,lesson,user)
      const {seats,invitees:_invites,delivered:_sent,...visible}=lesson
      const eligible=state.users.filter(account=>allowedInLesson(state,lesson,account))
      const people=eligible.flatMap(account=>{
        const seat=seats[account.id]
        if(!manager&&account.id!==user.id&&seat?.status!=='admitted'&&account.id!==lesson.teacherId&&account.id!==lesson.substituteId)return []
        const role=account.role==='parent'?'student':account.role
        return [{id:account.id,name:account.name,role,studentId:manager?account.studentId:undefined,
          seat:manager||account.id===user.id?seat:seat?.status==='admitted'?{status:seat.status,at:seat.at,generation:0,rtcIndex:0,periods:[],lastSeen:seat.lastSeen}:undefined,
          mediaUid:seat?.status==='admitted'&&(manager||seats[user.id]?.status==='admitted')?lessonUid(seat):undefined}]
      })
      const order=visible.order.filter(id=>manager||id===user.id||seats[id]?.status==='admitted')
      return {...visible,messages:manager||seats[user.id]?.status==='admitted'?visible.messages?.slice(-100):undefined,notes:manager?visible.notes:'',order,
        finishedTurns:visible.finishedTurns?.filter(id=>order.includes(id)),inviteCount:eligible.filter(account=>account.role!=='admin').length,
        manager,self:seats[user.id],people,waiting:manager?Object.values(seats).filter(seat=>seat.status==='waiting').length:0,
        connected:people.filter(person=>person.seat?.lastSeen&&Date.parse(person.seat.lastSeen)>now-55_000).length,
        mediaChanging:restrictionsPending(state,lesson)}
    })
}

function readDraft(state:State,user:User,p:Record<string,unknown>):LessonDraft {
  const kind=selection<LessonKind>(p.kind,['circle','private','meeting','urgent'])
  if(user.role!=='admin'&&(user.role!=='teacher'||!state.lessonTeacherScheduling||kind==='meeting'||kind==='urgent'))throw forbidden()
  const circle=state.circles.find(circle=>circle.id===p.circleId)
  if((kind==='circle'||kind==='private')&&(!circle||user.role==='teacher'&&circle.teacherId!==user.id))throw forbidden()
  const teacherId=String((user.role==='teacher'?user.id:p.teacherId)||circle?.teacherId||user.id)
  const substituteId=requireText(p.substituteId,191)||undefined
  if(user.role==='teacher'&&substituteId)throw forbidden()
  if(!state.users.some(account=>account.id===teacherId&&activeAccount(account)&&(account.role==='admin'||account.role==='teacher')))throw new ApiError('حدّد محفّظًا مفعّلًا')
  if(substituteId&&(teacherId===substituteId||!state.users.some(account=>account.id===substituteId&&activeAccount(account)&&account.role==='teacher')))throw new ApiError('حدّد محفّظًا بديلًا مختلفًا')
  const studentId=kind==='private'?requireText(p.studentId,191):undefined
  if(kind==='private'&&!state.students.some(student=>student.id===studentId&&student.circleId===circle?.id&&student.active))throw new ApiError('حدّد طالبًا من الحلقة')
  const invitees=kind==='meeting'||kind==='urgent'?[...new Set(Array.isArray(p.invitees)?p.invitees as string[]:[])]:[]
  if((kind==='meeting'||kind==='urgent')&&(!invitees.length||invitees.length>22
    ||invitees.some(id=>!state.users.some(account=>account.id===id&&activeAccount(account)&&(account.role==='teacher'||kind==='urgent'&&account.role==='student')))))throw new ApiError('حدّد المشاركين المؤهلين، بحد أقصى 22 مدعوًا')
  const roomMinutes=Number(p.roomMinutes??10)
  if(![0,5,10,15,30].includes(roomMinutes))throw new ApiError('تحقق من نافذة دخول الجلسة')
  const reminders=[...new Set((Array.isArray(p.reminders)?p.reminders:[30,5,0]).map(Number))]
  if(reminders.length>6||reminders.some(value=>!Number.isInteger(value)||value<0||value>1440))throw new ApiError('تحقق من مواعيد التذكيرات')
  const zone=requireText(p.zone,64)||'Asia/Riyadh'
  try {localDay(zone,0)} catch {throw new ApiError('اختر منطقة زمنية معروفة')}
  const draft:LessonDraft={
    title:requireText(p.title,100)||(kind==='circle'?'تسميع '+circle!.name:kind==='private'?'تسميع خاص':kind==='urgent'?'لقاء عاجل':'اجتماع إداري'),
    kind,circleId:circle?.id,studentId,invitees,teacherId,substituteId,zone,date:parseDate(p.date),
    start:parseClock(p.start),end:parseClock(p.end),media:selection<LessonMedia>(p.media,['audio','video']),
    roomMinutes,reminders,notes:requireText(p.notes,400),
  }
  const chat=state.chats.find(chat=>chat.id===p.chatId)
  if(chat) {
    if(kind==='circle'&&chat.circleId===circle?.id)draft.chatId=chat.id
    if(kind==='private'&&!chat.circleId&&chat.students.includes(studentId!)&&chat.members.includes(teacherId)
      &&chat.members.every(id=>id===teacherId||state.users.some(account=>account.id===id&&account.studentId===studentId)))draft.chatId=chat.id
  }
  return draft
}
function buildLesson(draft:LessonDraft,date:string,id:string,seriesId?:string):Lesson {
  const {date:_date,start,end,...rest}=draft
  const startsAt=timestamp(draft,date,start)
  const endsAt=timestamp(draft,end<=start?dayOffset(date,1):date,end)
  if(Date.parse(endsAt)-Date.parse(startsAt)>240*minute)throw new ApiError('حدّد مدة جلسة لا تتجاوز أربع ساعات')
  return {...rest,id,seriesId,localDate:date,startsAt,endsAt,status:'scheduled',revision:1,seats:{},order:[],delivered:[]}
}
function conflicts(state:State,lesson:Lesson,others:Lesson[]) {
  const ids=new Set([...participants(state,lesson).map(account=>account.id),lesson.teacherId,lesson.substituteId].filter(Boolean))
  return others.find(other=>other.id!==lesson.id&&scheduledOrLive(other)&&Date.parse(other.startsAt)<Date.parse(lesson.endsAt)
    &&Date.parse(other.endsAt)>Date.parse(lesson.startsAt)
    &&(lesson.circleId&&lesson.circleId===other.circleId||other.teacherId&&ids.has(other.teacherId)||
      other.substituteId&&ids.has(other.substituteId)||participants(state,other).some(account=>ids.has(account.id))))
}
function checkDates(draft:LessonDraft,state:State,date:string) {
  return !draft.circleId||circleMeets(date,state.circles.find(circle=>circle.id===draft.circleId))
}
function matchSeries(series:LessonSeries,date:string) {
  return date>=series.draft.date&&date<=series.through&&(!series.stoppedBefore||date<series.stoppedBefore)&&!series.except.includes(date)
    &&(series.repeat==='daily'||series.weekdays.includes(Temporal.PlainDate.from(date).dayOfWeek%7))
}
function repeatOptions(p:Record<string,unknown>,draft:LessonDraft,id:string):LessonSeries|undefined {
  if(!p.repeat||p.repeat==='none')return
  const repeat=selection(p.repeat,['daily','weekly'] as const)
  const through=parseDate(p.through)
  if(through<draft.date||through>dayOffset(draft.date,365))throw new ApiError('حدّد نهاية التكرار خلال سنة من أول موعد')
  const weekdays=[...new Set(Array.isArray(p.weekdays)?p.weekdays.map(Number):[])]
  if(repeat==='weekly'&&(!weekdays.length||weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)))throw new ApiError('اختر أيام التكرار')
  const except=Array.isArray(p.except)?[...new Set(p.except.map(parseDate))].slice(0,100):[]
  return {id,draft,repeat,weekdays,through,except}
}
function occurrences(state:State,series:LessonSeries,through:string,from=series.draft.date) {
  const list:Lesson[]=[]
  for(let date=from,days=0;date<=through&&days<=365;date=dayOffset(date,1),days++)
    if(matchSeries(series,date)&&checkDates(series.draft,state,date))list.push(buildLesson(series.draft,date,series.id+'-'+date,series.id))
  return list
}
function attendanceEnd(seat:LessonSeat,when:string) {
  const period=seat.periods.at(-1)
  if(period&&!period.to)period.to=when
  delete seat.lastSeen
}
function restrict(state:State,lesson:Lesson,id:string,reason:string,now:number) {
  const seat=lesson.seats[id]
  if(!seat||seat.status!=='admitted')return
  const uid=lessonUid(seat)
  seat.generation++
  state.lessonRestrictions??=[]
  state.lessonRestrictions.push({id:idFor(),lessonId:lesson.id,uid,attempts:0,nextAttempt:now,reason,expiresAt:now+(tokenLifetime+60)*1000})
}
function complete(state:State,lesson:Lesson,now:number,status:'completed'|'cancelled',closed=now) {
  const at=new Date(closed).toISOString()
  for(const [id,seat] of liveSeats(lesson)){restrict(state,lesson,id,status,now);attendanceEnd(seat,at);seat.status='left'}
  lesson.closedAt=at
  lesson.actualEnd=lesson.actualStart?at:undefined
  lesson.currentStudent=undefined
  lesson.turnStartedAt=undefined
  lesson.status=status
  lesson.revision++
}
export function applyLessonAction(state:State,user:User,action:string,p:Record<string,unknown>,op:string,now=Date.now()) {
  const all=state.lessons??=[]
  const seriesList=state.lessonSeries??=[]
  if(action==='lesson-settings'){
    if(user.role!=='admin')throw forbidden()
    state.lessonTeacherScheduling=p.enabled===true
    return
  }
  const lesson=all.find(item=>item.id===p.id)
  if(action==='lesson-save'){
    if(p.id&&(!lesson||!isManager(state,lesson,user)))throw forbidden()
    if(lesson&&lesson.status!=='scheduled')throw new ApiError('التعديل متاح للمواعيد المجدولة')
    const draft=readDraft(state,user,p)
    if(user.role==='teacher'&&draft.media==='video'&&lesson?.media!=='video')throw new ApiError('تفعيل الفيديو من صلاحية المدير')
    const range=selection(p.range??'one',['one','future','all'] as const)
    const oldSeries=lesson?.seriesId?seriesList.find(item=>item.id===lesson.seriesId):undefined
    if(oldSeries&&range!=='one'&&draft.date!==lesson?.localDate)throw new ApiError('اختر اليوم الأصلي عند تعديل السلسلة، أو عدّل هذا الموعد وحده')
    if(oldSeries&&range==='all'){
      const today=localDay(draft.zone,now)
      draft.date=oldSeries.draft.date>today?oldSeries.draft.date:today
    }
    if(!checkDates(draft,state,draft.date)&&(!p.repeat||p.repeat==='none')&&(!oldSeries||range==='one'))throw new ApiError('الحلقة لا تنعقد في هذا اليوم')
    const affected=lesson?all.filter(other=>other===lesson||oldSeries&&range!=='one'&&other.seriesId===oldSeries.id&&other.status==='scheduled'
      &&Date.parse(other.startsAt)>=now&&!other.exception&&(range==='all'||other.localDate>=lesson.localDate)):[]
    const proposedSeries=repeatOptions(p,draft,idFor())??(oldSeries&&range!=='one'?{...oldSeries,id:idFor(),draft,stoppedBefore:undefined}:undefined)
    const replacingOne=Boolean(lesson&&range==='one')
    const newSeries=replacingOne?undefined:proposedSeries
    const forecast=newSeries?occurrences(state,newSeries,newSeries.through):[buildLesson(draft,draft.date,lesson?.id??op,oldSeries?.id)]
    const candidates=forecast.filter(item=>Date.parse(item.startsAt)>=now-5*minute)
    if(!candidates.length)throw new ApiError('اختر موعدًا قادمًا أو اجتماعًا عاجلًا يبدأ الآن')
    const retained=all.filter(item=>!affected.includes(item))
    const reservations=[...retained]
    const known=new Set(all.map(item=>item.id))
    for(const series of seriesList) {
      if(oldSeries?.id===series.id&&range!=='one')continue
      for(const other of occurrences(state,series,series.through,localDay(series.draft.zone,now))) {
        if(!known.has(other.id)&&Date.parse(other.startsAt)>=now)reservations.push(other)
      }
    }
    for(const item of candidates){
      const collision=conflicts(state,item,reservations)
      if(collision){
        const base=Date.parse(item.startsAt),duration=Date.parse(item.endsAt)-base
        const alternatives=[30,60,120,180,240].map(offset=>({...item,startsAt:new Date(base+offset*minute).toISOString(),endsAt:new Date(base+offset*minute+duration).toISOString()}))
          .filter(option=>!conflicts(state,option,reservations)).slice(0,3)
          .map(option=>Temporal.Instant.from(option.startsAt).toZonedDateTimeISO(draft.zone).toPlainDateTime().toString().slice(0,16))
        throw new ApiError('يتعارض الموعد مع جلسة '+collision.title+(alternatives.length?' · أوقات متاحة '+alternatives.join('، '):''),409)
      }
    }
    if(oldSeries&&range!=='one')oldSeries.stoppedBefore=range==='all'?localDay(oldSeries.draft.zone,now):lesson!.localDate
    if(lesson&&oldSeries&&range==='one')oldSeries.except=[...new Set([...oldSeries.except,lesson.localDate])]
    if(newSeries)seriesList.push(newSeries)
    for(const entry of affected)complete(state,entry,now,'cancelled')
    const horizon=dayOffset(localDay(draft.zone,now),45)
    const add=candidates.filter(item=>item.localDate<=horizon||!newSeries)
    for(const item of add){
      if(lesson&&item.id===lesson.id){item.revision=lesson.revision+1;item.exception=Boolean(oldSeries)}
      if(item===add[0])lessonNotice(state,item,'lesson',lesson?'تغيّر موعد جلسة':'موعد جلسة جديد',participants(state,item).map(account=>account.id),now)
    }
    state.lessons=[...retained,...affected.filter(item=>!add.some(next=>next.id===item.id)),...add]
    state.lessonSeries=seriesList
    audit(state,user,add[0]??candidates[0],lesson?'تعديل موعد الجلسة':'جدولة جلسة',now)
    return
  }
  if(!lesson||!allowedInLesson(state,lesson,user))throw forbidden()
  const manager=isManager(state,lesson,user)
  const self=lesson.seats[user.id]
  const at=new Date(now).toISOString()
  const id=requireText(p.userId,191)
  const seat=lesson.seats[id]
  const member=state.users.find(account=>account.id===id)
  const requireManager=()=>{if(!manager)throw forbidden()}
  if(action==='lesson-cancel'||action==='lesson-end'){
    requireManager()
    if(!scheduledOrLive(lesson))throw new ApiError('الجلسة مغلقة')
    if(action==='lesson-cancel'&&lesson.actualStart)throw new ApiError('استخدم إنهاء للجميع أثناء الجلسة')
    complete(state,lesson,now,action==='lesson-cancel'?'cancelled':'completed')
    if(lesson.seriesId&&action==='lesson-cancel'){
      const series=seriesList.find(item=>item.id===lesson.seriesId)
      if(series)series.except=[...new Set([...series.except,lesson.localDate])]
    }
    lessonNotice(state,lesson,'lesson',action==='lesson-cancel'?'أُلغي موعد الجلسة':'أُغلقت الجلسة',participants(state,lesson).map(account=>account.id),now)
    audit(state,user,lesson,action==='lesson-cancel'?'إلغاء موعد الجلسة':'إنهاء الجلسة للجميع',now)
    return
  }
  if(!scheduledOrLive(lesson)||now>=Date.parse(lesson.endsAt))throw new ApiError('انتهت الجلسة')
  if(action==='lesson-join'){
    if(now<Date.parse(lesson.startsAt)-lesson.roomMinutes*minute)throw new ApiError('غرفة الانتظار لم تفتح بعد')
    if(self?.status==='removed'||self?.status==='declined')throw forbidden()
    if(self?.status==='admitted'||self?.status==='waiting')return false
    const direct=manager||user.role==='teacher'&&(lesson.kind==='meeting'||lesson.kind==='urgent')
    // Keep one seat free for the owner administrator until she or he joins.
    const seats=liveSeats(lesson).length
    if(direct&&seats>=(user.role==='admin'?lessonCapacity:capacityFor(state,lesson)))throw new ApiError('اكتملت سعة الجلسة')
    const rtcIndex=self?.rtcIndex??Math.max(0,...Object.values(lesson.seats).map(seat=>seat.rtcIndex))+1
    if(rtcIndex>=1024)throw new ApiError('لا يمكن إضافة مشاركين جدد لهذه الجلسة')
    lesson.seats[user.id]={status:direct?'admitted':'waiting',at,rtcIndex,generation:self?.generation??0,periods:self?.periods??[]}
    if(!direct&&!lesson.order.includes(user.id))lesson.order.push(user.id)
    if(manager&&!lesson.actualStart){
      lesson.actualStart=at
      lesson.status='live'
      const learners=participants(state,lesson).filter(account=>account.role==='student').sort((a,b)=>a.id.localeCompare(b.id)).map(account=>account.id)
      const shift=learners.length?Temporal.PlainDate.from(lesson.localDate).dayOfYear%learners.length:0
      lesson.order=[...learners.slice(shift),...learners.slice(0,shift)]
    }
    if(user.role==='admin'){
      lessonNotice(state,lesson,'lesson','انضم المدير إلى الجلسة',participants(state,lesson).map(account=>account.id),now)
      audit(state,user,lesson,'دخول المدير للجلسة',now)
    }
    return
  }
  if(action==='lesson-leave'){
    if(self?.status!=='admitted'&&self?.status!=='waiting')return false
    restrict(state,lesson,user.id,'leave',now)
    attendanceEnd(self,at)
    self.status='left'
    if(lesson.currentStudent===user.id){lesson.currentStudent=undefined;lesson.turnStartedAt=undefined}
    return
  }
  if(action==='lesson-message'){
    if(self?.status!=='admitted'||lesson.status!=='live')throw forbidden()
    const text=requireText(p.text,1000)
    if(!text)throw new ApiError('اكتب رسالة أولًا')
    lesson.messages=[...(lesson.messages??[]),{id:op,from:user.id,text,time:at,readBy:[user.id]}].slice(-400)
    return
  }
  if(action==='lesson-hand'){
    if(self?.status!=='admitted'||user.role!=='student')throw forbidden()
    self.hand=p.raised===true
    return
  }
  if(action==='lesson-mic-answer'){
    if(self?.status!=='admitted'||!self.micRequested)return false
    delete self.micRequested
    return
  }
  requireManager()
  if(action==='lesson-mic-request'){
    if(seat?.status!=='admitted'||id!==lesson.currentStudent)throw forbidden()
    if(seat.micRequested)return false
    seat.micRequested=true
    return
  }
  if(action==='lesson-order'){
    if(!member||member.role!=='student'||seat?.status!=='admitted'||!allowedInLesson(state,lesson,member)
      ||id===lesson.currentStudent||lesson.finishedTurns?.includes(id))throw forbidden()
    const direction=selection(p.direction,['earlier','later'] as const)
    const index=lesson.order.indexOf(id)
    if(index<0)return false
    const eligible=lesson.order.filter(key=>key!==lesson.currentStudent&&!lesson.finishedTurns?.includes(key)&&lesson.seats[key]?.status==='admitted')
    const target=eligible[eligible.indexOf(id)+(direction==='earlier'?-1:1)]
    if(!target)return false
    const next=lesson.order.indexOf(target)
    lesson.order[index]=target
    lesson.order[next]=id
    return
  }
  if(action==='lesson-admit'||action==='lesson-decline'||action==='lesson-remove'){
    if(!seat||!member||isManager(state,lesson,member)||!allowedInLesson(state,lesson,member))throw forbidden()
    if(action==='lesson-remove'&&seat.status==='admitted'){
      restrict(state,lesson,id,'remove',now)
      attendanceEnd(seat,at)
      seat.status='removed'
      if(lesson.currentStudent===id){lesson.currentStudent=undefined;lesson.turnStartedAt=undefined}
    } else {
      if(seat.status!=='waiting'||action==='lesson-remove')throw new ApiError('تغيّرت حالة المشارك')
      if(action==='lesson-admit'&&liveSeats(lesson).length>=capacityFor(state,lesson))throw new ApiError('اكتملت سعة الجلسة')
      seat.status=action==='lesson-admit'?'admitted':'declined'
      if(action==='lesson-admit')lessonNotice(state,lesson,'lesson','تم قبول دخولك إلى الجلسة',[id],now)
    }
    audit(state,user,lesson,action==='lesson-admit'?'قبول المشارك':action==='lesson-decline'?'رفض الدخول':'استبعاد مشارك',now)
    return
  }
  if(action==='lesson-turn'){
    if(id&&(!member||member.role!=='student'||seat?.status!=='admitted'||!allowedInLesson(state,lesson,member)))throw forbidden()
    if(id===lesson.currentStudent)return false
    if(lesson.currentStudent){
      const previous=lesson.currentStudent
      restrict(state,lesson,previous,'turn',now)
      delete lesson.seats[previous]?.micRequested
      if(p.defer===true)lesson.order=[...lesson.order.filter(key=>key!==previous),previous]
      else lesson.finishedTurns=[...new Set([...(lesson.finishedTurns??[]),previous])]
    }
    lesson.currentStudent=id||undefined
    lesson.turnStartedAt=id?at:undefined
    if(id&&lesson.finishedTurns)lesson.finishedTurns=lesson.finishedTurns.filter(key=>key!==id)
    if(seat)seat.hand=false
    if(id){
      lessonNotice(state,lesson,'lesson','حان دورك في التسميع',[id],now)
      const next=lesson.order.find(key=>key!==id&&!lesson.finishedTurns?.includes(key)&&lesson.seats[key]?.status==='admitted')
      if(next)lessonNotice(state,lesson,'lesson','اقترب دورك في التسميع',[next],now)
    }
    audit(state,user,lesson,'تحديث دور التسميع',now)
    return
  }
  if(action==='lesson-media'){
    if(user.role!=='admin')throw forbidden()
    const media=selection(p.media,['audio','video'] as const)
    if(media===lesson.media)return false
    if(media==='audio')for(const [uid] of liveSeats(lesson))restrict(state,lesson,uid,'audio-only',now)
    lesson.media=media
    audit(state,user,lesson,'تعديل سياسة الوسائط',now)
    return
  }
  if(action==='lesson-extend'){
    const increment=Number(p.minutes)
    if(![10,15,30].includes(increment))throw new ApiError('تحقق من مدة التمديد')
    const end=Date.parse(lesson.endsAt)+increment*minute
    if(end-Date.parse(lesson.startsAt)>240*minute)throw new ApiError('بلغت الجلسة الحد الأقصى للمدة')
    const proposed={...lesson,endsAt:new Date(end).toISOString()}
    if(conflicts(state,proposed,all))throw new ApiError('التمديد يتعارض مع موعد آخر',409)
    lesson.endsAt=proposed.endsAt
    audit(state,user,lesson,'تمديد الجلسة',now)
    return
  }
  throw new ApiError('إجراء الجلسة غير معروف',404)
}

export function lessonRtcGrant(state:State,user:User,id:string,now=Date.now()) {
  const lesson=state.lessons?.find(item=>item.id===id)
  if(!lesson||!allowedInLesson(state,lesson,user)||lesson.seats[user.id]?.status!=='admitted')throw forbidden()
  if(lesson.status!=='live'||now>=Date.parse(lesson.endsAt))throw new ApiError('الجلسة غير متاحة للاتصال',409)
  if(restrictionsPending(state,lesson))throw new ApiError('جارٍ تطبيق إعدادات الوسائط، حاول بعد قليل',409)
  const publisher=isManager(state,lesson,user)||user.role==='teacher'&&(lesson.kind==='meeting'||lesson.kind==='urgent')||lesson.currentStudent===user.id
  const ttl=Math.min(tokenLifetime,Math.floor((Date.parse(lesson.endsAt)-now)/1000))
  if(ttl<1)throw new ApiError('انتهت الجلسة',409)
  return {lessonId:lesson.id,uid:lessonUid(lesson.seats[user.id]),audio:publisher,video:publisher&&lesson.media==='video',ttl}
}
export function runLessonSchedule(state:State,now=Date.now()) {
  let changed=false
  let scheduleConflicts=0
  const all=state.lessons??=[]
  const known=new Set(all.map(lesson=>lesson.id))
  const time=new Date(now).toISOString()
  for(const series of state.lessonSeries??[]){
    const local=localDay(series.draft.zone,now)
    for(const lesson of occurrences(state,series,dayOffset(local,45),local)){
      if(known.has(lesson.id)||Date.parse(lesson.startsAt)<now)continue
      if(conflicts(state,lesson,all)){scheduleConflicts++;continue}
      all.push(lesson)
      known.add(lesson.id)
      changed=true
    }
  }
  if(all.length)state.lessons=all
  for(const lesson of all.filter(scheduledOrLive)){
    if(now>=Date.parse(lesson.endsAt)){
      complete(state,lesson,now,lesson.status==='live'?'completed':'cancelled',Date.parse(lesson.endsAt))
      changed=true
      continue
    }
    for(const [id,seat] of liveSeats(lesson)){
      const account=state.users.find(user=>user.id===id)
      if(account&&allowedInLesson(state,lesson,account))continue
      restrict(state,lesson,id,'membership',now)
      attendanceEnd(seat,time)
      seat.status='removed'
      if(lesson.currentStudent===id){lesson.currentStudent=undefined;lesson.turnStartedAt=undefined}
      changed=true
    }
    const start=Date.parse(lesson.startsAt)
    for(const reminder of lesson.reminders){
      const due=start-reminder*minute
      if(now<due||now>due+(reminder?Math.min(reminder,5):5)*minute||lesson.delivered.includes(reminder))continue
      lesson.delivered.push(reminder)
      lessonNotice(state,lesson,'lesson-reminder',reminder?'تذكير بموعد الجلسة':'حان موعد الجلسة',participants(state,lesson).map(user=>user.id),now,reminder)
      changed=true
    }
  }
  if(changed||!state.lessonHealth?.lastRun||state.lessonHealth.scheduleConflicts!==scheduleConflicts||now-Date.parse(state.lessonHealth.lastRun)>300_000){
    state.lessonHealth={...state.lessonHealth,lastRun:time,scheduleConflicts}
    return true
  }
  return false
}
export function applyPresence(lesson:Lesson,ids:Set<number>,now:number) {
  if(now>=Date.parse(lesson.endsAt))return false
  let changed=false
  const time=new Date(now).toISOString()
  for(const [id,seat] of liveSeats(lesson)){
    if(ids.has(lessonUid(seat))){
      if(!seat.lastSeen||seat.periods.at(-1)?.to)seat.periods.push({from:time})
      seat.lastSeen=time
      changed=true
    } else if(seat.lastSeen&&now-Date.parse(seat.lastSeen)>55_000){
      attendanceEnd(seat,seat.lastSeen)
      changed=true
    }
  }
  return changed
}
