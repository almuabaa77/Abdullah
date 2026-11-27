import assert from 'node:assert/strict'
import test from 'node:test'
import AgoraToken from 'agora-token/src/AccessToken2.js'
import { agoraAppIdOnly, agoraConfig, createAgoraStatusCheck, issueAgora } from '../server/agora'
import { applyLessonAction, applyPresence, lessonNoticeAllowed, lessonRtcGrant, prepareLessonMediaRoom, projectLessons, recordLessonMediaPresence, runLessonSchedule } from '../server/lesson-workspace'
import { createState } from '../server/seed'
import type { User } from '../src/domain'
import { lessonAgendaGraceMs, lessonClosed, lessonInAgenda } from '../src/lessons'

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
test('App ID-only media is selected only for a valid explicitly configured App ID',()=>{
  const appId='a'.repeat(32)
  assert.equal(agoraAppIdOnly({}),undefined)
  assert.equal(agoraAppIdOnly({AGORA_APP_ID:'AIza-Example'}),undefined)
  assert.equal(agoraAppIdOnly({AGORA_APP_ID:appId,AGORA_APP_CERTIFICATE:'partial'}),undefined)
  assert.equal(agoraAppIdOnly({AGORA_APP_ID:appId}),appId)
})
test('encrypted room access stays scoped, and removal rotates the channel and its keys',()=>{
  const {state,admin,teacher,outsider,learners,action,create}=fixture()
  const entry=create(),{id}=entry
  action(teacher,'lesson-join',{id})
  const room=prepareLessonMediaRoom(state,entry)
  assert.equal(prepareLessonMediaRoom(state,entry).channel,room.channel)
  assert.ok(room.secret.length<=62)
  assert.equal(atob(room.salt).length,32)
  assert.throws(()=>lessonRtcGrant(state,outsider,id,at,true),{status:403})
  action(learners[0],'lesson-join',{id})
  assert.throws(()=>lessonRtcGrant(state,learners[0],id,at,true),{status:403})
  action(teacher,'lesson-admit',{id,userId:learners[0].id})
  const learner=learners[0]
  const grant=lessonRtcGrant(state,learner,id,at,true)
  assert.equal(grant.audio,false)
  for(const who of [learner,teacher,admin]){
    const view=projectLessons(state,who,at,true)[0]
    assert.equal(view.mediaVersion,1)
    assert.ok(!JSON.stringify(view).includes(room.secret)&&!JSON.stringify(view).includes(room.salt)&&!JSON.stringify(view).includes(room.channel))
  }
  assert.equal(recordLessonMediaPresence(state,learner,id,grant.uid,room.version,at),true)
  assert.equal(recordLessonMediaPresence(state,learner,id,grant.uid,room.version,at+1000),false)
  assert.equal(projectLessons(state,teacher,at,true)[0].connected,1)
  runLessonSchedule(state,at+60_000)
  assert.equal(projectLessons(state,teacher,at+60_000,true)[0].connected,0)
  action(teacher,'lesson-remove',{id,userId:learner.id},at+65_000)
  assert.notEqual(entry.mediaRoom?.channel,room.channel)
  assert.notEqual(entry.mediaRoom?.secret,room.secret)
  assert.equal(entry.mediaRoom?.version,2)
  assert.throws(()=>recordLessonMediaPresence(state,learner,id,grant.uid,room.version,at+66_000),{status:403})
  const teacherGrant=lessonRtcGrant(state,teacher,id,at+66_000,true)
  assert.throws(()=>recordLessonMediaPresence(state,teacher,id,teacherGrant.uid,room.version,at+66_000),{status:409})
  action(teacher,'lesson-end',{id},at+70_000)
  assert.equal(entry.mediaRoom,undefined)
})
test('Agora diagnostics probe REST once without disclosing authentication values',async t=>{
  const env={AGORA_APP_ID:'a'.repeat(32),AGORA_APP_CERTIFICATE:'b'.repeat(32),AGORA_CUSTOMER_ID:'example-client',AGORA_CUSTOMER_SECRET:'example-secret'}
  let hits=0
  t.mock.method(globalThis,'fetch',async (url:string,init:RequestInit)=>{
    hits++
    assert.match(url,/^https:\/\/api\.agora\.io\/dev\/v1\/channel\/user\/[a-f0-9]+\/halaqat-/)
    assert.equal(new Headers(init.headers).get('Authorization'),'Basic '+Buffer.from('example-client:example-secret').toString('base64'))
    return Response.json({success:true,data:{channel_exist:false}})
  })
  assert.equal((await createAgoraStatusCheck({})()).rest,'pending')
  assert.equal(hits,0)
  const check=createAgoraStatusCheck(env)
  const results=await Promise.all([check(),check()])
  assert.equal(hits,1)
  for(const result of results)assert.deepEqual(result,{appId:env.AGORA_APP_ID,certificate:true,customerId:true,customerSecret:true,coHostConfirmed:false,rest:'accepted'})
  assert.equal(agoraConfig(env),undefined)
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
test('permanent deletion requires a current manager confirmation and removes only the selected recurrence',()=>{
  const {state,admin,teacher,outsider,learners,draft,action}=fixture()
  action(admin,'lesson-save',{...draft,repeat:'daily',through:'2026-12-03'},before)
  const [lesson,next]=state.lessons!
  const deletion={id:lesson.id,revision:lesson.revision,confirmed:true}
  assert.throws(()=>action(outsider,'lesson-delete',deletion,before),{status:403})
  assert.throws(()=>action(learners[0],'lesson-delete',deletion,before),{status:403})
  assert.throws(()=>action(teacher,'lesson-delete',{...deletion,confirmed:false},before))
  assert.throws(()=>action(teacher,'lesson-delete',{...deletion,revision:lesson.revision+1},before),{status:409})
  assert.ok(state.notices.some(notice=>notice.lesson?.id===lesson.id))
  action(teacher,'lesson-delete',deletion,before)
  runLessonSchedule(state,before)
  assert.ok(!state.lessons?.some(item=>item.id===lesson.id))
  assert.ok(!state.notices.some(notice=>notice.lesson?.id===lesson.id))
  assert.ok(state.lessons?.some(item=>item.id===next.id))
  assert.ok(state.lessonSeries?.[0].except.includes(lesson.localDate))
  assert.ok(state.audit.some(event=>event.target===lesson.id&&event.action.includes('حذف')))
})
test('deleting a live encrypted session retires room access and retains unrelated student records',()=>{
  const {state,admin,teacher,learners,action,create}=fixture()
  const entry=create(),id=entry.id
  const learner=learners[0]
  action(teacher,'lesson-join',{id})
  action(learner,'lesson-join',{id})
  action(teacher,'lesson-admit',{id,userId:learner.id})
  const room=prepareLessonMediaRoom(state,entry)
  const grant=lessonRtcGrant(state,learner,id,at,true)
  const prior=state.daily
  action(admin,'lesson-delete',{id,revision:entry.revision,confirmed:true})
  assert.equal(entry.mediaRoom,undefined)
  assert.equal(state.daily,prior)
  assert.throws(()=>recordLessonMediaPresence(state,learner,id,grant.uid,room.version,at),{status:403})
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
test('schedules leave the agenda after two minutes while authorized users keep the summary',()=>{
  const {state,teacher,outsider,learners,action,create}=fixture()
  const entry=create()
  const end=at+76_000
  action(teacher,'lesson-join',{id:entry.id})
  action(teacher,'lesson-end',{id:entry.id},end)
  assert.equal(lessonInAgenda(entry,end+lessonAgendaGraceMs-1),true)
  assert.equal(lessonInAgenda(entry,end+lessonAgendaGraceMs),false)
  assert.equal(projectLessons(state,learners[0],end+lessonAgendaGraceMs)[0].id,entry.id)
  assert.equal(projectLessons(state,outsider,end+lessonAgendaGraceMs).length,0)
})
test('unstarted and live sessions close at the scheduled deadline even when the worker runs late',()=>{
  for(const join of [false,true]){
    const {state,teacher,action,create}=fixture()
    const entry=create()
    if(join)action(teacher,'lesson-join',{id:entry.id})
    const end=Date.parse(entry.endsAt)
    assert.equal(lessonClosed(entry,end-1),false)
    assert.equal(lessonClosed(entry,end),true)
    runLessonSchedule(state,end+10_000)
    assert.equal(entry.status,join?'completed':'cancelled')
    assert.equal(Date.parse(entry.closedAt!),end)
    assert.equal(lessonInAgenda(entry,end+lessonAgendaGraceMs),false)
  }
})
test('queue changes and microphone requests respect the active turn and scope',()=>{
  const {state,teacher,learners,action,create}=fixture(3)
  const {id}=create()
  const [first,second,third]=learners
  action(teacher,'lesson-join',{id})
  for(const person of learners){
    action(person,'lesson-join',{id})
    action(teacher,'lesson-admit',{id,userId:person.id})
  }
  const prior=projectLessons(state,teacher,at)[0]
  const lead=prior.order[0]
  const tail=prior.order[2]
  assert.throws(()=>action(first,'lesson-order',{id,userId:second.id,direction:'earlier'}),{status:403})
  action(teacher,'lesson-order',{id,userId:tail,direction:'earlier'})
  assert.equal(projectLessons(state,teacher,at)[0].order[1],tail)
  action(teacher,'lesson-turn',{id,userId:lead})
  assert.throws(()=>action(teacher,'lesson-mic-request',{id,userId:tail}),{status:403})
  action(teacher,'lesson-mic-request',{id,userId:lead})
  const speaker=learners.find(user=>user.id===lead)!
  assert.equal(projectLessons(state,speaker,at)[0].self?.micRequested,true)
  if(third.id!==lead)assert.equal(projectLessons(state,third,at)[0].people.find(person=>person.id===lead)?.seat?.micRequested,undefined)
  action(speaker,'lesson-mic-answer',{id})
  action(teacher,'lesson-turn',{id,defer:true})
  const postponed=projectLessons(state,teacher,at)[0]
  assert.equal(postponed.order.at(-1),lead)
  assert.equal(postponed.finishedTurns?.includes(lead),undefined)
  action(teacher,'lesson-turn',{id,userId:tail})
  action(teacher,'lesson-turn',{id})
  assert.deepEqual(projectLessons(state,teacher,at)[0].finishedTurns,[tail])
})
