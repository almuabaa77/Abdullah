import assert from 'node:assert/strict'
import test from 'node:test'
import AgoraToken from 'agora-token/src/AccessToken2.js'
import { agoraConfig, issueAgora } from '../server/agora'
import { applyLessonAction, applyPresence, lessonNoticeAllowed, lessonRtcGrant, projectLessons, runLessonSchedule } from '../server/lesson-workspace'
import { createState } from '../server/seed'
import type { User } from '../src/domain'

const before=Date.parse('2026-12-01T06:00:00Z')
const at=Date.parse('2026-12-01T07:00:00Z')
const account=(id:string,role:User['role'],studentId?:string):User=>({id,role,name:id,status:'active',studentId})
function fixture(count=2) {
  const admin=account('admin','admin'),teacher=account('teacher','teacher'),outsider=account('other-teacher','teacher')
  const learners=Array.from({length:count},(_,index)=>account('student-'+index,'student','record-'+index))
  const state=createState()
  state.users=[admin,teacher,outsider,...learners]
  state.circles=[{id:'circle',name:'حلقة الاختبار',teacherId:teacher.id,days:[0,1,2,3,4,5,6],holidays:['2026-12-04']}]
  state.students=learners.map(user=>({id:user.studentId!,name:user.name,circleId:'circle',active:true,color:0,startingPoints:0}))
  const draft={kind:'circle',circleId:'circle',title:'تسميع',media:'video',date:'2026-12-01',start:'10:00',end:'12:00',zone:'Asia/Riyadh',roomMinutes:10,reminders:[30,5,0]}
  const action=(user:User,name:string,payload:Record<string,unknown>,now=at,op=crypto.randomUUID())=>applyLessonAction(state,user,name,payload,op,now)
  const create=()=>{action(admin,'lesson-save',draft,before);return state.lessons![0]}
  return {state,admin,teacher,outsider,learners,draft,action,create}
}

test('rejects a Google API key and requires provider-enforced permissions before enabling RTC',()=>{
  assert.equal(agoraConfig({AGORA_APP_ID:'AIza-example'}),undefined)
  assert.equal(agoraConfig({AGORA_APP_ID:'a'.repeat(32),AGORA_APP_CERTIFICATE:'b'.repeat(32)}),undefined)
})
test('date isolation, conflicts, scoped calendars and durable schedule reminders',()=>{
  const {state,admin,teacher,outsider,learners,draft,action,create}=fixture()
  const entry=create()
  assert.equal(entry.startsAt,'2026-12-01T07:00:00Z')
  assert.equal(projectLessons(state,outsider,before).length,0)
  assert.equal(projectLessons(state,learners[0],before).length,1)
  assert.throws(()=>action(teacher,'lesson-save',draft,before),{status:403})
  assert.throws(()=>action(admin,'lesson-save',draft,before),{status:409})
  const publishTime=at-30*60_000
  runLessonSchedule(state,publishTime)
  runLessonSchedule(state,publishTime+10_000)
  const notice=state.notices.filter(notice=>notice.lesson?.reminder===30)
  assert.equal(notice.length,1)
  assert.equal(lessonNoticeAllowed(state,notice[0],outsider),false)
  action(admin,'lesson-save',{...draft,id:entry.id,start:'10:30'},before)
  assert.equal(lessonNoticeAllowed(state,notice[0],teacher),false)
})
test('repeating lessons skip holidays and an occurrence edit preserves the rest of the series',()=>{
  const {state,admin,draft,action}=fixture()
  action(admin,'lesson-save',{...draft,repeat:'daily',through:'2026-12-06',except:['2026-12-05']},before)
  assert.deepEqual(state.lessons?.map(item=>item.localDate),['2026-12-01','2026-12-02','2026-12-03','2026-12-06'])
  const old=state.lessons![1]
  action(admin,'lesson-save',{...draft,id:old.id,date:old.localDate,title:'موعد معدل',start:'11:00'},before)
  runLessonSchedule(state,before)
  assert.equal(state.lessons?.filter(item=>item.localDate===old.localDate).length,1)
  assert.equal(state.lessons?.find(item=>item.id===old.id)?.title,'موعد معدل')
  assert.equal(state.lessons?.find(item=>item.localDate==='2026-12-03')?.title,draft.title)
})
test('only admitted participants get a scoped grant; turn and media changes revoke previous grants',()=>{
  const {state,admin,teacher,outsider,learners,action,create}=fixture()
  const lesson=create(),id=lesson.id,learner=learners[0]
  action(learner,'lesson-join',{id})
  assert.equal(lesson.seats[learner.id].status,'waiting')
  assert.throws(()=>lessonRtcGrant(state,learner,id,at),{status:403})
  assert.throws(()=>action(learner,'lesson-message',{id,text:'waiting'}),{status:403})
  assert.throws(()=>action(outsider,'lesson-join',{id}),{status:403})
  action(teacher,'lesson-join',{id})
  action(admin,'lesson-join',{id})
  action(teacher,'lesson-admit',{id,userId:learner.id})
  action(learner,'lesson-message',{id,text:'السلام عليكم'})
  assert.equal(projectLessons(state,learner,at)[0].messages?.[0].text,'السلام عليكم')
  assert.equal(lessonRtcGrant(state,learner,id,at).audio,false)
  assert.equal(lessonRtcGrant(state,teacher,id,at).audio,true)
  action(learner,'lesson-hand',{id,raised:true})
  action(teacher,'lesson-turn',{id,userId:learner.id})
  assert.equal(lessonRtcGrant(state,learner,id,at).video,true)
  const oldUid=lessonRtcGrant(state,learner,id,at).uid
  assert.throws(()=>action(teacher,'lesson-media',{id,media:'audio'}),{status:403})
  action(admin,'lesson-media',{id,media:'audio'})
  assert.ok(state.lessonRestrictions?.some(rule=>rule.uid===oldUid))
  assert.throws(()=>lessonRtcGrant(state,learner,id,at),{status:409})
  // Simulate successful acknowledgement by the REST worker, without contacting Agora.
  state.lessonRestrictions=[]
  const grant=lessonRtcGrant(state,learner,id,at)
  assert.notEqual(grant.uid,oldUid)
  assert.equal(grant.video,false)
  assert.equal(grant.audio,true)
  action(teacher,'lesson-end',{id})
  assert.throws(()=>lessonRtcGrant(state,learner,id,at))
})
test('tokens omit video and data publication privileges and bind channel and authenticated UID',()=>{
  const config=agoraConfig({AGORA_APP_ID:'a'.repeat(32),AGORA_APP_CERTIFICATE:'b'.repeat(32),AGORA_CUSTOMER_ID:'local',AGORA_CUSTOMER_SECRET:'test',AGORA_COHOST_AUTH_ENABLED:'true'})!
  const grant=issueAgora(config,'session',19,true,false,75)
  const parsed=new AgoraToken.AccessToken2('', '', 0, 0) as unknown as {
    from_string:(token:string)=>boolean
    expire:number
    services:{__uid:string;__channel_name:string;__privileges:Record<string,number>}[]
  }
  assert.equal(parsed.from_string(grant.token),true)
  assert.equal(parsed.expire,75)
  assert.equal(parsed.services[0].__uid.toString(),'19')
  assert.equal(parsed.services[0].__channel_name.toString(),grant.channel)
  assert.notEqual(issueAgora(config,'private-session',19,true,false).channel,grant.channel)
  assert.deepEqual(Object.keys(parsed.services[0].__privileges),['1','2'])
})
test('the 24-seat policy reserves the administrator place and presence reconnects without duplicates',()=>{
  const {state,admin,teacher,learners,action,create}=fixture(23)
  const lesson=create(),id=lesson.id
  action(teacher,'lesson-join',{id})
  for(const learner of learners)action(learner,'lesson-join',{id})
  for(const learner of learners.slice(0,22))action(teacher,'lesson-admit',{id,userId:learner.id})
  assert.throws(()=>action(teacher,'lesson-admit',{id,userId:learners[22].id}))
  action(admin,'lesson-join',{id})
  assert.equal(Object.values(lesson.seats).filter(seat=>seat.status==='admitted').length,24)
  const learner=learners[0],uid=lessonRtcGrant(state,learner,id,at).uid
  applyPresence(lesson,new Set([uid]),at)
  applyPresence(lesson,new Set<number>(),at+10_000)
  applyPresence(lesson,new Set([uid]),at+25_000)
  assert.equal(lesson.seats[learner.id].periods.length,1)
  applyPresence(lesson,new Set<number>(),at+90_000)
  applyPresence(lesson,new Set([uid]),at+110_000)
  assert.equal(lesson.seats[learner.id].periods.length,2)
  assert.equal(lesson.seats[learner.id].periods[0].to,new Date(at+25_000).toISOString())
})
