import { assessmentChunks, assessmentCoverage, assessmentCovers, assessmentDaysLeft, assessmentKinds, assessmentPassMark, assessmentQuestions, assessmentStatus, assessmentWorkday, addAssessmentDays, appointmentStart, defaultAssessmentCriteria, defaultAssessmentPolicy, errorKinds, reviewSections, type AssessmentAppointment, type AssessmentAttempt, type AssessmentCase, type AssessmentDashboard, type AssessmentKind, type AssessmentPolicy, type AssessmentRoster, type AssessmentState, type ReviewTask } from '../src/assessment-model'
import { circleMeets, dateKey, dayOffset, idFor, validateSegments, type Daily, type Notice, type Segment, type State, type Student, type User } from '../src/domain'
import { activeAccount } from './chat-access'
import { ApiError } from './errors'
import { applyLessonAction } from './lesson-workspace'

type Values=Record<string,unknown>
const minute=60_000
const store=(state:State)=>state.assessments??={items:[]}
const riyadh=(now:number)=>dateKey(new Date(now))
const fail=(message:string,status=400):never=>{throw new ApiError(message,status)}
const forbidden=()=>fail('لا تتوفر صلاحية لهذا الاختبار',403)
const clean=(value:unknown,max=400)=>typeof value==='string'?value.trim().slice(0,max):''
function required(value:unknown,max=400) {
  return clean(value,max)||fail('أكمل الحقول المطلوبة')
}
function number(value:unknown,min:number,max:number) {
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+$/.test(value)))return fail('تحقق من القيم الرقمية')
  const n=Number(value)
  if(!Number.isInteger(n)||n<min||n>max)return fail('القيمة خارج النطاق المسموح')
  return n
}
function option<T extends string>(value:unknown,list:readonly T[]):T {
  return list.includes(value as T)?value as T:fail('الخيار غير متاح')
}
function list(value:unknown,limit:number):unknown[] {
  if(!Array.isArray(value)||value.length>limit)return fail('تحقق من العناصر المدخلة')
  return value
}
function fields(value:unknown):Values {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Values:fail('بيانات غير صالحة')
}
function day(value:unknown) {
  const date=required(value,10), parsed=new Date(date+'T12:00:00Z')
  return /^\d{4}-\d\d-\d\d$/.test(date)&&Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===date?date:fail('أدخل تاريخًا صحيحًا')
}
function route(value:unknown) {
  const order=list(value,30).map(part=>number(part,1,30))
  if(order.length!==30||new Set(order).size!==30)return fail('أدخل الأجزاء الثلاثين مرة واحدة في ترتيب الخطة')
  return order
}
function readPolicy(p:Values):AssessmentPolicy {
  const workdays=[...new Set(list(p.workdays,7).map(value=>number(value,0,6)))]
  const weights=list(p.weights,4).map(value=>number(value,0,100))
  const criteria=list(p.criteria??defaultAssessmentCriteria,4).map(value=>{
    const criterion=fields(value)
    return {ar:required(criterion.ar,80),en:required(criterion.en,80)}
  })
  const grades=list(p.grades,12).map(value=>{
    const grade=fields(value)
    return {min:number(grade.min,0,100),ar:required(grade.ar,80),en:required(grade.en,80)}
  }).sort((a,b)=>b.min-a.min)
  if(!workdays.length)fail('اختر يوم عمل واحدًا على الأقل')
  if(weights.length!==4||weights.reduce((a,b)=>a+b,0)!==100||criteria.length!==weights.length)fail('أدخل أربعة معايير يبلغ مجموع أوزانها 100')
  if(grades.at(-1)?.min!==0||new Set(grades.map(grade=>grade.min)).size!==grades.length)fail('أدخل حدًا أدنى فريدًا لكل تقدير، مع تقدير يبدأ من صفر')
  const stagePassing=Object.fromEntries(Object.entries(fields(p.stagePassing??{})).map(([unit,value])=>[number(unit,1,30),number(value,0,100)]))
  const passing=fields(p.passing),days=fields(p.days)
  return {
    active:p.active===true,order:route(p.order),practiceSize:number(p.practiceSize,1,30),stageSize:number(p.stageSize,1,30),requirePractice:p.requirePractice===true,
    workdays,holidays:[...new Set(list(p.holidays,180).map(day))],
    days:{practice:number(days.practice,1,60),stage:number(days.stage,1,60)},
    passing:{practice:number(passing.practice,0,100),stage:number(passing.stage,0,100)},stagePassing,
    extensionDays:number(p.extensionDays,1,3),extensionLimit:number(p.extensionLimit,0,5),retakeDays:number(p.retakeDays,1,60),
    reminderDays:[...new Set(list(p.reminderDays,10).map(value=>number(value,0,60)))],weights,grades,criteria,
    teacherApproval:p.teacherApproval===true,teacherScheduling:p.teacherScheduling===true,autoCertificate:p.autoCertificate===true,
  }
}
function policyFor(state:State,student:Student):AssessmentPolicy {
  const settings=state.assessments
  const base=settings?.rings?.[student.circleId]??settings?.policy??defaultAssessmentPolicy
  return {...base,order:settings?.routes?.[student.id]??base.order,
    holidays:[...new Set([...base.holidays,...(settings?.policy?.holidays??[]),...(state.circles.find(circle=>circle.id===student.circleId)?.holidays??[])])]}
}
const assessmentStudent=(state:State,id:string)=>state.students.find(student=>student.id===id)
function inCircle(state:State,user:User,item:AssessmentCase) {
  const student=assessmentStudent(state,item.studentId)
  return user.role==='teacher'&&Boolean(student?.active&&state.circles.some(circle=>circle.id===student.circleId&&circle.teacherId===user.id))
}
function assessmentAccess(state:State,user:User,item:AssessmentCase) {
  return activeAccount(user)&&(user.role==='admin'||inCircle(state,user,item)
    ||user.role==='teacher'&&item.appointment?.examinerId===user.id
    ||Boolean(assessmentStudent(state,item.studentId)?.active)&&(user.role==='student'&&user.studentId===item.studentId
      ||user.role==='parent'&&state.links.some(link=>link.parentId===user.id&&link.studentId===item.studentId&&link.status==='accepted')))
}
function canAssess(state:State,user:User,item:AssessmentCase) {
  return user.role==='admin'||user.role==='teacher'&&(item.appointment?item.appointment.examinerId===user.id:inCircle(state,user,item))
}
function canApprove(state:State,user:User,item:AssessmentCase) {
  return user.role==='admin'||item.kind==='practice'&&item.policy.teacherApproval&&canAssess(state,user,item)
}
function canSchedule(state:State,user:User,item:AssessmentCase) {
  return user.role==='admin'||inCircle(state,user,item)&&item.policy.teacherScheduling
}
function title(item:AssessmentCase) {
  return item.kind==='practice'?'اختبار تجريبي · '+item.parts.join('، '):'اختبار مرحلي · '+item.unit
}
function notice(state:State,item:AssessmentCase,now:number,ar:string,en:string,staffOnly=false) {
  const users=state.users.filter(user=>assessmentAccess(state,user,item)
    &&(!staffOnly||user.role==='admin'||user.role==='teacher')).map(user=>user.id)
  state.notices.unshift({id:idFor(),kind:'exam',title:ar,en,body:title(item),bodyEn:item.kind==='practice'?'Practice · '+item.parts.join(', '):'Stage '+item.unit,assessmentId:item.id,users,time:new Date(now).toISOString(),readBy:[]})
}
export function assessmentNoticeAllowed(state:State,user:User,notice:Notice) {
  if(!notice.assessmentId)return true
  const item=state.assessments?.items.find(candidate=>candidate.id===notice.assessmentId)
  return Boolean(item&&assessmentAccess(state,user,item))
}
function audit(state:State,user:User,item:string,action:string) {
  state.audit.push({time:new Date().toISOString(),actor:user.name,action,target:item})
}
function passedParts(items:AssessmentCase[],kind:AssessmentKind) {
  return [...new Set(items.filter(item=>item.kind===kind&&item.attempts.some(attempt=>attempt.passed)).flatMap(item=>item.parts))]
}
function extensionCalendar(state:State,item:AssessmentCase,student:Student) {
  return {...item.policy,holidays:[...new Set([...item.policy.holidays,...policyFor(state,student).holidays])]}
}
function makeReview(state:State,item:AssessmentCase,today:string,records?:Daily[]):ReviewTask[] {
  const start=today
  const count=Math.min(30,Math.max(1,assessmentDaysLeft(start,item.deadline,item.policy)))
  const memories=records??state.daily.filter(record=>record.studentId===item.studentId)
  const history=state.assessments?.items.filter(exam=>exam.studentId===item.studentId).flatMap(exam=>exam.attempts.filter(attempt=>attempt.state==='approved'))??[]
  const weakness=new Map<string,{segment:Segment;count:number}>()
  function weak(surah:number,from:number,to:number) {
    if(!assessmentCovers(item.parts,surah,from)||!assessmentCovers(item.parts,surah,to))return
    const key=surah+':'+from
    const entry=weakness.get(key)
    if(entry)entry.count++
    else weakness.set(key,{segment:{surah,from,to},count:1})
  }
  for(const record of memories.slice(-80))if(record.memorizationStatus==='partial')for(const segment of record.memorization)weak(segment.surah,segment.from,segment.to)
  for(const attempt of history)for(const error of attempt.errors)if(error.surah&&error.verse)weak(error.surah,error.verse,error.verse)
  const focus=[...weakness.values()].sort((a,b)=>b.count-a.count).slice(0,8).map(entry=>entry.segment)
  return reviewSections(item.parts,count).map((segments,index)=>({
    date:addAssessmentDays(start,index+1,item.policy),segments,focus:index<3?focus.slice(index*3,index*3+3):[],
  }))
}
function scanStudent(state:State,student:Student,records:Daily[],now:number,all:AssessmentCase[]) {
  if(!student.active||!records.length)return false
  const policy=policyFor(state,student)
  if(!policy.active)return false
  const coverage=assessmentCoverage(records.filter(record=>!record.historicalImport))
  const completed=new Set(coverage.parts)
  if(!completed.size)return false
  const today=riyadh(now)
  const practice=passedParts(all,'practice')
  let changed=false
  for(const kind of assessmentKinds){
    const groups=assessmentChunks(policy.order,kind==='practice'?policy.practiceSize:policy.stageSize)
    for(const [i,parts] of groups.entries()){
      const existing=all.find(item=>item.kind===kind&&item.parts.length===parts.length&&parts.every(part=>item.parts.includes(part)))
      if(existing){
        if(kind==='stage'&&!existing.attempts.some(attempt=>attempt.passed))break
        continue
      }
      if(!parts.every(part=>completed.has(part))||kind==='stage'&&policy.requirePractice&&!parts.every(part=>practice.includes(part))){
        if(kind==='stage')break
        continue
      }
      const item:AssessmentCase={id:idFor(),kind,unit:i+1,parts,studentId:student.id,circleId:student.circleId,eligibleAt:today,
        deadline:addAssessmentDays(today,policy.days[kind],policy),policy,attempts:[],extensions:[],review:[],reminders:[]}
      item.review=makeReview(state,item,today,records)
      store(state).items.unshift(item);all.push(item)
      const days=policy.days[kind]
      notice(state,item,now,`استحقيت ${kind==='practice'?'اختبارًا تجريبيًا':'اختبارًا مرحليًا'} وبدأت مهلة الاستعداد. أمامك ${days} أيام عمل`,
        `Assessment preparation has started. You have ${days} working days`)
      changed=true
      if(kind==='stage')break
    }
  }
  return changed
}
export function evaluateAssessmentEligibility(state:State,student:Student,now=Date.now()) {
  return scanStudent(state,student,state.daily.filter(record=>record.studentId===student.id),now,state.assessments?.items.filter(item=>item.studentId===student.id)??[])
}
export function runAssessmentSchedule(state:State,now=Date.now()) {
  const settings=store(state),today=riyadh(now)
  let changed=false
  if(settings.lastScan!==today){
    const byStudent=new Map<string,Daily[]>()
    for(const record of state.daily){
      const records=byStudent.get(record.studentId)
      if(records)records.push(record)
      else byStudent.set(record.studentId,[record])
    }
    const allCases=new Map<string,AssessmentCase[]>()
    for(const item of settings.items){
      const exams=allCases.get(item.studentId)
      if(exams)exams.push(item)
      else allCases.set(item.studentId,[item])
    }
    for(const student of state.students)scanStudent(state,student,byStudent.get(student.id)??[],now,allCases.get(student.id)??[])
    settings.lastScan=today
    changed=true
  }
  for(const item of settings.items){
    const status=assessmentStatus(item,today,now)
    if(['passed','cancelled','pending-approval','recording','in-progress'].includes(status))continue
    const add=(key:string,ar:string,en:string)=>{
      if(item.reminders.includes(key))return
      item.reminders.push(key);notice(state,item,now,ar,en);changed=true
    }
    const remains=assessmentDaysLeft(today,item.deadline,item.policy)
    if(today>item.deadline&&!item.attempts.at(-1)?.passed&&status!=='scheduled')add('late:'+item.deadline,'انتهت مهلة الاستعداد للاختبار','The assessment preparation deadline has passed')
    if(today<=item.deadline&&(remains>0||today===item.deadline)&&item.policy.reminderDays.includes(remains)){
      add('days:'+item.deadline+':'+remains,remains?`تبقّى ${remains} أيام عمل للاستعداد للاختبار`:'اليوم آخر مهلة الاستعداد',
        remains?`${remains} working days remain to prepare`:'Today is the preparation deadline')
    }
    if(item.appointment){
      const starts=appointmentStart(item.appointment)
      if(starts>=now&&starts-now<=60*minute)add('appointment:'+starts,'اقترب موعد الاختبار','Your assessment is starting soon')
    }
  }
  return changed
}

function overlaps(a:number,aEnd:number,b:number,bEnd:number) {
  return a<bEnd&&b<aEnd
}
function slotFree(state:State,item:AssessmentCase,appointment:AssessmentAppointment) {
  const from=appointmentStart(appointment),to=from+appointment.minutes*minute
  const overlapsExisting=(slot:AssessmentAppointment)=>overlaps(from,to,appointmentStart(slot),appointmentStart(slot)+slot.minutes*minute)
  for(const other of state.assessments?.items??[]){
    if(other===item||other.cancelledAt||!other.appointment)continue
    if((other.studentId===item.studentId||other.appointment.examinerId===appointment.examinerId)&&overlapsExisting(other.appointment))return false
  }
  for(const legacy of state.exams){
    if(legacy.time&&legacy.studentIds.includes(item.studentId)&&overlapsExisting({...appointment,date:legacy.extensions?.[item.studentId]?.status==='accepted'?legacy.extensions[item.studentId].date:legacy.date,time:legacy.time,minutes:30}))return false
  }
  const student=state.users.find(user=>user.role==='student'&&user.studentId===item.studentId&&activeAccount(user))
  return !(state.lessons??[]).some(lesson=>(lesson.status==='scheduled'||lesson.status==='live')
    &&lesson.id!==item.appointment?.lessonId
    &&(lesson.teacherId===appointment.examinerId||lesson.substituteId===appointment.examinerId||lesson.invitees.includes(appointment.examinerId)
      ||lesson.studentId===item.studentId||lesson.kind==='circle'&&lesson.circleId===item.circleId||student&&lesson.invitees.includes(student.id))
    &&overlaps(from,to,Date.parse(lesson.startsAt),Date.parse(lesson.endsAt)))
}
function suggestedSlots(state:State,item:AssessmentCase,today:string,now:number,limit=3) {
  const circle=state.circles.find(circle=>circle.id===item.circleId)
  const examinerId=circle?.teacherId
  if(!examinerId||!state.users.some(user=>user.id===examinerId&&activeAccount(user)))return []
  const slots:AssessmentAppointment[]=[]
  for(let offset=0;offset<21&&slots.length<limit;offset++){
    const date=dayOffset(item.retryDate&&item.retryDate>today?item.retryDate:today,offset)
    if(!assessmentWorkday(date,item.policy)||!circleMeets(date,circle))continue
    for(const time of ['16:00','16:30','17:00','17:30','18:00','18:30','19:00']){
      const slot:AssessmentAppointment={date,time,minutes:20,mode:'onsite',place:circle!.name,examinerId}
      if(appointmentStart(slot)>now&&slotFree(state,item,slot)){slots.push(slot);break}
    }
  }
  return slots
}
function cancelLesson(state:State,user:User,item:AssessmentCase,now:number) {
  const lesson=(state.lessons??[]).find(l=>l.id===item.appointment?.lessonId)
  if(lesson&&(lesson.status==='scheduled'||lesson.status==='live'))applyLessonAction(state,user,lesson.status==='live'?'lesson-end':'lesson-cancel',{id:lesson.id},idFor(),now)
}
function readAppointment(state:State,user:User,item:AssessmentCase,p:Values,now:number,allowOnline:boolean) {
  const date=day(p.date),time=required(p.time,5)
  const examinerId=required(p.examinerId,191)
  const mode=option(p.mode,['onsite','online'] as const)
  const circle=state.circles.find(circle=>circle.id===item.circleId)
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail('اختر وقتًا صحيحًا بتوقيت الرياض')
  if(!assessmentWorkday(date,item.policy)||!circleMeets(date,circle))fail('اختر يوم عمل تنعقد فيه الحلقة')
  if(!state.users.some(account=>account.id===examinerId&&activeAccount(account)&&(account.role==='admin'||account.role==='teacher')))fail('اختر مختبرًا مفعّلًا')
  if(user.role==='teacher'&&examinerId!==user.id)forbidden()
  if(mode==='online'&&!allowOnline)fail('اعتماد الموعد عن بُعد من صلاحية الإدارة')
  const slot:AssessmentAppointment={date,time,minutes:number(p.minutes,10,180),place:mode==='onsite'?required(p.place,160):'عن بُعد',mode,examinerId}
  const at=appointmentStart(slot),entryEnd=new Date(at+slot.minutes*minute+3*60*minute).toISOString().slice(0,10)
  if(at<now||item.retryDate&&date<item.retryDate||entryEnd!==date)fail('اختر موعدًا مستقبليًا صالحًا في اليوم نفسه')
  if(!slotFree(state,item,slot))fail('يوجد تعارض في موعد الطالب أو المختبر',409)
  return slot
}
function book(state:State,user:User,item:AssessmentCase,p:Values,now:number) {
  const slot=readAppointment(state,user,item,p,now,user.role==='admin')
  const previous=item.appointment
  if(previous?.lessonId&&user.role!=='admin')forbidden()
  if(previous?.lessonId&&state.lessons?.some(lesson=>lesson.id===previous.lessonId&&lesson.status==='live'))fail('أنه الاختبار الجاري قبل تعديل الموعد')
  if(slot.mode==='online'){
    if(!state.users.some(account=>account.role==='student'&&account.studentId===item.studentId&&activeAccount(account)))fail('اربط حساب الطالب قبل جدولة اختبار عن بُعد')
    const old=(state.lessons??[]).find(lesson=>lesson.id===previous?.lessonId&&lesson.status==='scheduled')
    const id=old?.id??idFor()
    const end=new Date(appointmentStart(slot)+slot.minutes*minute+3*60*minute).toISOString().slice(11,16)
    applyLessonAction(state,user,'lesson-save',{id:old?.id,kind:'private',circleId:item.circleId,studentId:item.studentId,teacherId:slot.examinerId,
      title:title(item),date:slot.date,start:slot.time,end,zone:'Asia/Riyadh',media:'video',roomMinutes:10,reminders:[]},id,now)
    slot.lessonId=id
  }else if(previous?.lessonId)cancelLesson(state,user,item,now)
  item.appointment=slot
  delete item.proposed
  notice(state,item,now,previous?'تغيّر موعد الاختبار':'جُدول الاختبار',previous?'Assessment rescheduled':'Assessment scheduled')
  audit(state,user,item.id,`موعد الاختبار ${slot.date} ${slot.time} · ${slot.examinerId}`)
}
function readAttempt(item:AssessmentCase,user:User,p:Values,now:number):AssessmentAttempt {
  const last=item.attempts.at(-1)
  const draft=last?.state==='draft'?last:undefined
  if(number(p.version??0,0,1_000_000)!==(draft?.version??0))fail('عُدّلت المسودة في نافذة أخرى. حدّث الصفحة قبل الحفظ.',409)
  const scores=list(p.scores,4).map((value,index)=>number(value,0,item.policy.weights[index]))
  if(scores.length!==4)fail('أدخل درجات معايير التقييم الأربعة')
  const errors=list(p.errors??[],100).map(value=>{
    const error=fields(value)
    const kind=option(error.kind,errorKinds)
    const note=clean(error.note,260)
    if(!error.surah&&!error.verse)return {kind,note}
    const surah=number(error.surah,1,114),verse=number(error.verse,1,286)
    if(!assessmentCovers(item.parts,surah,verse))fail('موضع الخطأ خارج نطاق الاختبار')
    return {kind,surah,verse,note}
  })
  const questions=p.questions===undefined?draft?.questions??assessmentQuestions(item.parts):validateSegments(p.questions)
  if(questions.length>15||questions.some(q=>!assessmentCovers(item.parts,q.surah,q.from)||!assessmentCovers(item.parts,q.surah,q.to)))fail('الأسئلة يجب أن تكون ضمن نطاق الاختبار')
  return {id:draft?.id??idFor(),examinerId:draft?.examinerId??user.id,evaluator:draft?.evaluator??user.name,state:'draft',
    updatedAt:new Date(now).toISOString(),version:(draft?.version??0)+1,scores,score:scores.reduce((a,b)=>a+b,0),feedback:clean(p.feedback,700),errors,questions}
}
function issueCertificate(state:State,item:AssessmentCase,student:Student,now:number) {
  const outcome=item.attempts.findLast(attempt=>attempt.state==='approved'&&attempt.passed)
  if(item.kind!=='stage'||!outcome?.grade||!outcome.approvedBy)fail('الشهادة متاحة بعد اجتياز المرحلة واعتمادها')
  if(item.certificate&&!item.certificate.revokedAt)return false
  if(item.certificate)(item.oldCertificates??=[]).push(item.certificate)
  item.certificate={id:idFor(),issuedAt:new Date(now).toISOString(),studentName:student.name,examiner:outcome!.evaluator,approvedBy:outcome!.approvedBy!,
    score:outcome!.score,grade:outcome!.grade!}
  notice(state,item,now,'صدرت شهادة اجتياز المرحلة','Your stage certificate is available')
  return true
}
function approve(state:State,user:User,item:AssessmentCase,student:Student,now:number,retest=false) {
  const result=item.attempts.at(-1)
  if(!result||result.state!=='submitted')return fail('لا توجد نتيجة بانتظار الاعتماد')
  result.state='approved'
  result.approvedAt=new Date(now).toISOString()
  result.approvedBy=user.name
  result.grade=item.policy.grades.find(grade=>result.score>=grade.min)!
  result.passed=result.score>=assessmentPassMark(item)
  result.retest=!result.passed&&retest
  if(!result.passed){
    cancelLesson(state,user,item,now)
    item.retryDate=addAssessmentDays(riyadh(now),item.policy.retakeDays,item.policy)
    item.deadline=addAssessmentDays(item.retryDate,item.policy.days[item.kind],item.policy)
    delete item.appointment
    delete item.proposed
    delete item.readyStudent
    delete item.readyTeacher
    item.review=makeReview(state,item,riyadh(now))
    notice(state,item,now,'أضيفت خطة مراجعة واستحقاق إعادة الاختبار','A review plan and retake have been added')
  }
  if(result.passed&&item.kind==='stage'&&item.policy.autoCertificate)issueCertificate(state,item,student,now)
  notice(state,item,now,'اعتمدت نتيجة الاختبار','Assessment result approved')
  if(result.passed)evaluateAssessmentEligibility(state,student,now)
  audit(state,user,item.id,`اعتماد النتيجة · ${result.score}/100`)
}
const finalStates=['pending-approval','passed','cancelled']
export function applyAssessmentAction(state:State,user:User,action:string,p:Values,now=Date.now()) {
  const today=riyadh(now),stamp=new Date(now).toISOString()
  if(action==='assessment-policy'||action==='assessment-route'){
    if(user.role!=='admin')return forbidden()
    const db=store(state)
    const id=clean(p.target,191)
    if(action==='assessment-route'){
      if(!assessmentStudent(state,id))return fail('اختر طالبًا صالحًا')
      const routes=db.routes??={}
      if(p.reset===true)delete routes[id]
      else routes[id]=route(p.order)
    }else {
      if(id&&!state.circles.some(circle=>circle.id===id))return fail('اختر حلقة صالحة')
      if(id){
        const rings=db.rings??={}
        if(p.reset===true)delete rings[id]
        else rings[id]=readPolicy(fields(p.policy))
      }else db.policy=readPolicy(fields(p.policy))
    }
    delete db.lastScan
    audit(state,user,id,action)
    return
  }
  const db=store(state)
  if(action==='assessment-batch'){
    if(user.role!=='admin')return forbidden()
    const slots=list(p.slots,25)
    if(!slots.length)return fail('اختر طلبات الجدولة')
    for(const entry of slots)applyAssessmentAction(state,user,'assessment-book',fields(entry),now)
    return
  }
  if(action==='assessment-create'){
    if(user.role!=='admin')return forbidden()
    const student=assessmentStudent(state,required(p.studentId,191))
    if(!student?.active)return fail('اختر طالبًا نشطًا')
    const kind=option(p.kind,assessmentKinds)
    const parts=[...new Set(list(p.parts,30).map(value=>number(value,1,30)))]
    if(!parts.length)return fail('اختر جزءًا واحدًا على الأقل')
    const policy=policyFor(state,student)
    const groups=assessmentChunks(policy.order,kind==='practice'?policy.practiceSize:policy.stageSize)
    const unit=groups.findIndex(group=>group.length===parts.length&&group.every(part=>parts.includes(part)))+1
    if(!unit)return fail('اختر مجموعة أجزاء مطابقة لمسار الطالب لهذا النوع')
    const all=db.items.filter(item=>item.studentId===student.id)
    if(all.some(item=>item.kind===kind&&item.parts.length===parts.length&&parts.every(part=>item.parts.includes(part))))return fail('يوجد استحقاق لهذا النطاق بالفعل',409)
    const records=state.daily.filter(record=>record.studentId===student.id)
    const known=assessmentCoverage(records).parts
    if(!parts.every(part=>known.includes(part)))return fail('اعتمد اكتمال حفظ الأجزاء في سجل التسميع أولًا')
    const practiced=passedParts(all,'practice')
    if(kind==='stage'&&policy.requirePractice&&!parts.every(part=>practiced.includes(part)))return fail('يجب اجتياز الاختبارات التجريبية لهذه الأجزاء أولًا')
    const item:AssessmentCase={id:idFor(),kind,unit,parts:groups[unit-1],studentId:student.id,circleId:student.circleId,eligibleAt:today,
      deadline:addAssessmentDays(today,policy.days[kind],policy),policy,attempts:[],extensions:[],review:[],reminders:[]}
    item.review=makeReview(state,item,today,records)
    db.items.unshift(item)
    if(p.appointment)book(state,user,item,fields(p.appointment),now)
    else notice(state,item,now,'بدأت مهلة اختبار أُضيف من الإدارة','Preparation for an assessment added by administration has started')
    audit(state,user,item.id,action)
    return
  }
  const item=db.items.find(item=>item.id===p.id)
  if(!item||!assessmentAccess(state,user,item))return forbidden()
  const student=assessmentStudent(state,item.studentId)
  if(!student)return fail('بيانات الطالب غير متاحة')
  const status=assessmentStatus(item,today,now)
  const mutable=!finalStates.includes(status)
  const owns=user.role==='student'&&user.studentId===student.id
  const staff=user.role==='admin'||inCircle(state,user,item)||canAssess(state,user,item)
  switch(action){
    case 'assessment-reopen':
      if(user.role!=='admin'||!item.cancelledAt)return forbidden()
      delete item.cancelledAt
      notice(state,item,now,'أُعيد فتح الاختبار','The assessment was reopened')
      break
    case 'assessment-ready':
      if(!mutable||!(owns||staff))return forbidden()
      if(owns)item.readyStudent=p.ready!==false
      else item.readyTeacher=p.ready!==false
      break
    case 'assessment-nominate':
      if(!mutable||!staff||item.kind!=='stage')return forbidden()
      if(item.nominated)return false
      item.nominated=true
      notice(state,item,now,'رُشّح الطالب للاختبار المرحلي','Student nominated for the stage assessment',true)
      break
    case 'assessment-extension': {
      if(!owns||!mutable||today>item.deadline||item.inProgress||item.extensions.length>=item.policy.extensionLimit||item.extensions.some(entry=>entry.status==='pending'))return forbidden()
      const days=number(p.days,1,item.policy.extensionDays)
      item.extensions.push({id:idFor(),days,reason:required(p.reason,400),expected:addAssessmentDays(item.deadline,days,extensionCalendar(state,item,student)),status:'pending'})
      notice(state,item,now,'طُلب تمديد مهلة الاستعداد','An assessment extension was requested',true)
      break
    }
    case 'assessment-extension-review': {
      if(!mutable||user.role!=='admin')return forbidden()
      const request=item.extensions.find(extension=>extension.id===p.requestId&&extension.status==='pending')
      if(!request)return fail('لا يوجد طلب تمديد معلّق')
      request.status=option(p.status,['accepted','declined'] as const)
      request.decidedAt=stamp
      request.decisionNote=request.status==='declined'?required(p.reason,400):clean(p.reason)
      if(request.status==='accepted'){
        item.policy=extensionCalendar(state,item,student)
        item.deadline=addAssessmentDays(item.deadline,request.days,item.policy)
        request.expected=item.deadline
        item.review=makeReview(state,item,today).map(task=>({...task,done:item.review.find(previous=>previous.date===task.date)?.done}))
      }
      notice(state,item,now,request.status==='accepted'?'تم اعتماد تمديد المهلة':'لم يُعتمد تمديد المهلة',
        request.status==='accepted'?'Assessment extension approved':'Assessment extension declined')
      break
    }
    case 'assessment-deadline':
      if(!mutable||user.role!=='admin')return forbidden()
      item.deadline=day(p.date)
      if(item.deadline<today||!assessmentWorkday(item.deadline,policyFor(state,student)))return fail('اختر يوم عمل في المستقبل')
      audit(state,user,item.id,'تعديل المهلة استثنائيًا · '+required(p.reason,300))
      notice(state,item,now,'تغيّرت نهاية مهلة الاختبار','The assessment deadline changed')
      return
    case 'assessment-propose':
      if(!mutable||!staff||item.inProgress)return forbidden()
      item.proposed=readAppointment(state,user,item,p,now,true)
      notice(state,item,now,'اقتُرح موعد للاختبار','An assessment time was proposed',true)
      break
    case 'assessment-book':
      if(!mutable||!canSchedule(state,user,item)||item.inProgress)return forbidden()
      book(state,user,item,p,now)
      return
    case 'assessment-unschedule':
    case 'assessment-cancel':
      if(!mutable||user.role!=='admin')return forbidden()
      cancelLesson(state,user,item,now)
      delete item.appointment
      delete item.proposed
      if(action==='assessment-cancel'){item.cancelledAt=stamp;item.inProgress=false}
      audit(state,user,item.id,'إلغاء · '+required(p.reason,300))
      notice(state,item,now,'أُلغي موعد الاختبار','Assessment appointment cancelled')
      return
    case 'assessment-start':
      if(!mutable||!canAssess(state,user,item)||item.retryDate&&today<item.retryDate)return forbidden()
      if(item.inProgress)return false
      item.inProgress=true
      break
    case 'assessment-draft':
    case 'assessment-submit': {
      if(!mutable||!canAssess(state,user,item)||!item.inProgress)return forbidden()
      const attempt=readAttempt(item,user,p,now)
      const submitted=action==='assessment-submit'
      if(submitted)attempt.state='submitted'
      if(item.attempts.at(-1)?.state==='draft')item.attempts[item.attempts.length-1]=attempt
      else item.attempts.push(attempt)
      if(submitted){
        item.inProgress=false
        notice(state,item,now,'نتيجة اختبار بانتظار الاعتماد','An assessment result is ready for approval',true)
      }
      return
    }
    case 'assessment-approve':
      if(!canApprove(state,user,item)||item.cancelledAt)return forbidden()
      approve(state,user,item,student,now,p.retest===true)
      return
    case 'assessment-review-task': {
      if(!mutable||!(owns||staff))return forbidden()
      const task=item.review.find(task=>task.date===p.date)
      if(!task)return fail('مهمة المراجعة غير متاحة')
      task.done=p.done===true
      return
    }
    case 'assessment-review-edit': {
      if(!mutable||!staff)return forbidden()
      const input=list(p.tasks,30).map(fields)
      if(input.length!==item.review.length)return fail('تغيّرت خطة المراجعة. أعد فتحها للتحرير.')
      const next=item.review.map((task,i)=>{
        const focus=input[i].focus===undefined?task.focus:validateSegments(input[i].focus)
        if(focus.some(({surah,from,to})=>!assessmentCovers(item.parts,surah,from)||!assessmentCovers(item.parts,surah,to)))fail('أولوية المراجعة خارج نطاق الاختبار')
        return {...task,date:day(input[i].date),note:clean(input[i].note,300),focus}
      })
      if(new Set(next.map(task=>task.date)).size!==next.length||next.some(task=>task.date>item.deadline||!assessmentWorkday(task.date,item.policy)))return fail('اختر أيام عمل مختلفة ضمن المهلة')
      item.review=next.sort((a,b)=>a.date.localeCompare(b.date))
      break
    }
    case 'assessment-certificate-issue':
      if(user.role!=='admin')return forbidden()
      if(!issueCertificate(state,item,student,now))return false
      break
    case 'assessment-certificate-revoke':
      if(user.role!=='admin'||!item.certificate||item.certificate.revokedAt)return forbidden()
      item.certificate.revokeReason=required(p.reason,400)
      item.certificate.revokedAt=stamp
      notice(state,item,now,'أُلغي اعتماد شهادة المرحلة','The stage certificate was revoked')
      break
    default: return fail('عملية الاختبار غير معروفة',404)
  }
  audit(state,user,item.id,action)
}

export function projectAssessments(state:State,user:User,students:Student[],now=Date.now()):AssessmentDashboard {
  const db=state.assessments,today=riyadh(now)
  const admin=user.role==='admin',staff=admin||user.role==='teacher'
  const all=db?.items??[]
  const scoped=all.filter(item=>assessmentAccess(state,user,item))
  const studentMap=new Map(state.students.map(student=>[student.id,student]))
  const circleMap=new Map(state.circles.map(circle=>[circle.id,circle]))
  const accountMap=new Map(state.users.map(account=>[account.id,account]))
  const records=new Map<string,Daily[]>()
  const ids=new Set(students.filter(student=>student.active).map(student=>student.id))
  for(const record of state.daily)if(ids.has(record.studentId)){
    const existing=records.get(record.studentId)
    if(existing)existing.push(record)
    else records.set(record.studentId,[record])
  }
  const roster:AssessmentRoster[]=students.filter(student=>student.active).map(student=>{
    const cases=scoped.filter(item=>item.studentId===student.id)
    const coverage=assessmentCoverage(records.get(student.id)??[])
    return {id:student.id,name:student.name,circleId:student.circleId,teacherId:circleMap.get(student.circleId)?.teacherId??'',
      ...coverage,route:policyFor(state,student).order,tested:passedParts(cases,'practice').length,practiceParts:passedParts(cases,'practice'),stageParts:passedParts(cases,'stage')}
  })
  return {
    policy:admin?db?.policy??defaultAssessmentPolicy:undefined,rings:admin?db?.rings:undefined,routes:admin?db?.routes:undefined,
    examiners:staff?state.users.filter(account=>(account.role==='admin'||account.role==='teacher')&&activeAccount(account)&&(admin||account.id===user.id)).map(({id,name})=>({id,name})):[],
    roster,items:scoped.map(item=>{
      const status=assessmentStatus(item,today,now)
      const {policy,reminders:_,oldCertificates:__,...safe}=item
      const canSeePrivate=canAssess(state,user,item)||inCircle(state,user,item)
      return {...safe,studentName:studentMap.get(item.studentId)?.name??'',circleName:circleMap.get(item.circleId)?.name??'',
        examinerName:accountMap.get(item.appointment?.examinerId??circleMap.get(item.circleId)?.teacherId??'')?.name,
        certificate:item.certificate?.revokedAt&&!canSeePrivate?undefined:item.certificate,
        proposed:canSeePrivate?item.proposed:undefined,attempts:canSeePrivate?item.attempts:item.attempts.filter(attempt=>attempt.state==='approved')
          .map(attempt=>({...attempt,errors:[],questions:[],examinerId:''})),
        status:!canSeePrivate&&['recording','pending-approval'].includes(status)?'awaiting-result':status,
        remaining:assessmentDaysLeft(today,item.deadline,policy),weights:policy.weights,criteria:policy.criteria??defaultAssessmentCriteria,passMark:assessmentPassMark(item),
        extendThrough:studentMap.has(item.studentId)&&!finalStates.includes(status)&&!item.inProgress&&today<=item.deadline&&item.extensions.length<policy.extensionLimit&&!item.extensions.some(entry=>entry.status==='pending')?
          Array.from({length:policy.extensionDays},(_,i)=>addAssessmentDays(item.deadline,i+1,extensionCalendar(state,item,studentMap.get(item.studentId)!))):[],
        canAssess:canAssess(state,user,item),canApprove:canApprove(state,user,item),canSchedule:canSchedule(state,user,item),canManage:admin,
        suggestions:staff&&!item.appointment&&!finalStates.includes(status)&&!item.inProgress?suggestedSlots(state,item,today,now):undefined}
    }),
  }
}

export function publicAssessmentCertificate(state:State,serial:string) {
  for(const item of state.assessments?.items??[]){
    const certificate=[item.certificate,...(item.oldCertificates??[])].find(certificate=>certificate?.id===serial)
    if(certificate)return {status:certificate.revokedAt?'revoked':'valid',serial:certificate.id,issuedAt:certificate.issuedAt,stage:item.unit,parts:item.parts}
  }
  return {status:'missing'}
}
