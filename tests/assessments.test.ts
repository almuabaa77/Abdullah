import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAssessmentAction, assessmentNoticeAllowed, evaluateAssessmentEligibility, projectAssessments, publicAssessmentCertificate, runAssessmentSchedule } from '../server/assessment-workflow'
import { createState } from '../server/seed'
import { addAssessmentDays, assessmentCoverage, assessmentCovers, assessmentDaysLeft, assessmentSections, assessmentStatus, defaultAssessmentPolicy, quranVerses } from '../src/assessment-model'
import { emptyDaily, type State, type User } from '../src/domain'

const now=Date.parse('2026-12-02T10:00:00Z')
const strong={scores:[60,20,10,10],version:0}
const draft={scores:[30,10,5,5],version:0,errors:[{kind:'memory',surah:78,verse:1,note:'مطلع النبأ'}]}
const account=(id:string,role:User['role'],studentId?:string):User=>({id,name:id,role,status:'active',studentId})

function fixture() {
  const admin=account('Admin','admin'),teacher=account('Teacher','teacher'),outsider=account('Outsider','teacher')
  const learner=account('Learner','student','learner'),second=account('Second','student','second'),parent=account('Parent','parent'),other=account('Unlinked','parent')
  const state:State=createState()
  state.users=[admin,teacher,outsider,learner,second,parent,other]
  const circle={id:'circle',name:'حلقة الاختبار',teacherId:teacher.id,days:[0,1,2,3,4,5,6],holidays:['2026-12-07']}
  state.circles=[circle]
  state.students=[learner,second].map(user=>({id:user.studentId!,name:user.name,circleId:circle.id,active:true,color:0,startingPoints:0}))
  state.links=[{id:'link',parentId:parent.id,studentId:learner.studentId!,status:'accepted'}]
  const record=(parts:number[],index=0)=>({...emptyDaily(state.students[index].id,'2026-12-02',circle),memorizationStatus:'complete' as const,memorization:assessmentSections(parts)})
  const complete=(parts:number[],index=0)=>{
    state.daily.push(record(parts,index))
    evaluateAssessmentEligibility(state,state.students[index],now)
    return state.assessments!.items.find(item=>item.studentId===state.students[index].id&&item.parts[0]===parts[0])!
  }
  const run=(user:User,action:string,p:Record<string,unknown>,at=now)=>applyAssessmentAction(state,user,'assessment-'+action,p,at)
  const project=(user:User)=>projectAssessments(state,user,user.role==='admin'||user.role==='teacher'?state.students:user===learner||user===parent?[state.students[0]]:user===second?[state.students[1]]:[],now)
  const approvePractice=(id:string)=>{
    run(teacher,'start',{id});run(teacher,'submit',{id,...strong});run(admin,'approve',{id})
  }
  return {state,admin,teacher,outsider,learner,second,parent,other,complete,record,run,project,approvePractice}
}

test('uses canonical Juz boundaries and counts an approved verse once',()=>{
  assert.equal(quranVerses,6236)
  assert.deepEqual(assessmentSections([2])[0],{surah:2,from:142,to:252})
  assert.equal(assessmentCovers([2],2,141),false)
  assert.equal(assessmentCovers([30],114,6),true)
  const {state,record,complete}=fixture()
  const clipped=record([30])
  clipped.memorization[0].from++
  const partial={...record([30]),memorizationStatus:'partial' as const}
  assert.deepEqual(assessmentCoverage([clipped,clipped,partial]).parts,[])
  state.daily.push(clipped,partial)
  assert.equal(evaluateAssessmentEligibility(state,state.students[0],now),false)
  const item=complete([30])
  assert.equal(item.kind,'practice')
  const sent=state.notices.length
  assert.equal(evaluateAssessmentEligibility(state,state.students[0],now),false)
  assert.equal(state.notices.length,sent)
  assert.equal(state.assessments!.items.length,1)
})

test('calculates Riyadh working days and accepts or declines one extension',()=>{
  const {state,admin,teacher,learner,parent,other,complete,run,project}=fixture()
  assert.equal(addAssessmentDays('2026-12-02',7,defaultAssessmentPolicy),'2026-12-15')
  const item=complete([30]),id=item.id
  assert.equal(item.deadline,'2026-12-16')
  assert.equal(assessmentDaysLeft('2026-12-02',item.deadline,item.policy),7)
  assert.deepEqual(project(parent).items.map(item=>item.id),[id])
  assert.deepEqual(project(other).items,[])
  assert.throws(()=>run(parent,'extension',{id,days:1,reason:'تجربة'}),{status:403})
  run(learner,'extension',{id,days:3,reason:'إجازة عائلية'})
  assert.equal(item.extensions[0].expected,'2026-12-22')
  assert.equal(item.deadline,'2026-12-16')
  const requestId=item.extensions[0].id
  assert.throws(()=>run(teacher,'extension-review',{id,requestId,status:'accepted'}),{status:403})
  run(admin,'extension-review',{id,requestId,status:'accepted'})
  assert.equal(item.deadline,'2026-12-22')
  assert.throws(()=>run(learner,'extension',{id,days:1,reason:'طلب إضافي'}),{status:403})
  const next=complete([29])
  run(learner,'extension',{id:next.id,days:1,reason:'تعارض موعد'})
  run(admin,'extension-review',{id:next.id,requestId:next.extensions[0].id,status:'declined',reason:'توجد مواعيد متاحة'})
  assert.equal(next.deadline,'2026-12-16')
  assert.equal(next.extensions[0].decisionNote,'توجد مواعيد متاحة')
  assert.throws(()=>run(learner,'extension',{id:next.id,days:1,reason:'طلب إضافي'}),{status:403})
  const justBeforeMidnight=Date.parse('2026-12-16T20:59:59Z'),justAfter=justBeforeMidnight+1000
  assert.notEqual(assessmentStatus(next,'2026-12-16',justBeforeMidnight),'overdue')
  assert.equal(assessmentStatus(next,'2026-12-17',justAfter),'overdue')
  assert.ok(runAssessmentSchedule(state,justAfter))
  assert.equal(runAssessmentSchedule(state,justAfter+1000),false)
  assert.equal(state.notices.filter(n=>n.assessmentId===next.id&&n.title.includes('انتهت')).length,1)
})

test('awards an official stage after practice approvals and issues a single private certificate',()=>{
  const {state,admin,teacher,learner,parent,other,complete,run,project,approvePractice}=fixture()
  const a=complete([30]),b=complete([29])
  approvePractice(a.id)
  assert.equal(state.assessments!.items.some(item=>item.kind==='stage'),false)
  approvePractice(b.id)
  const stages=state.assessments!.items.filter(item=>item.kind==='stage')
  assert.equal(stages.length,1)
  const item=stages[0],id=item.id
  assert.deepEqual(item.parts,[30,29])
  assert.throws(()=>run(admin,'certificate-issue',{id}),{status:400})
  assert.throws(()=>run(other,'start',{id}),{status:403})
  run(teacher,'start',{id});run(teacher,'draft',{id,...draft})
  assert.throws(()=>run(teacher,'draft',{id,...draft}),{status:409})
  const updated={...strong,version:1}
  run(teacher,'submit',{id,...updated})
  assert.equal(project(learner).items.find(item=>item.id===id)?.attempts.length,0)
  assert.throws(()=>run(teacher,'approve',{id}),{status:403})
  run(admin,'approve',{id})
  assert.equal(item.attempts.length,1)
  assert.equal(project(parent).items.find(item=>item.id===id)?.attempts[0].score,100)
  const serial=item.certificate!.id
  assert.equal(run(admin,'certificate-issue',{id}),false)
  const response=publicAssessmentCertificate(state,serial)
  assert.deepEqual(Object.keys(response),['status','serial','issuedAt','stage','parts'])
  assert.equal(response.status,'valid')
  run(admin,'certificate-revoke',{id,reason:'تصحيح البيانات'})
  assert.equal(project(learner).items.find(item=>item.id===id)?.certificate,undefined)
  assert.equal(publicAssessmentCertificate(state,serial).status,'revoked')
  run(admin,'certificate-issue',{id})
  assert.notEqual(item.certificate?.id,serial)
  assert.equal(publicAssessmentCertificate(state,item.certificate!.id).status,'valid')
  assert.equal(evaluateAssessmentEligibility(state,state.students[0],now),false)
  const privateNotice=state.notices.find(n=>n.assessmentId===id)!
  assert.equal(assessmentNoticeAllowed(state,parent,privateNotice),true)
  state.links=[]
  assert.equal(assessmentNoticeAllowed(state,parent,privateNotice),false)
  assert.deepEqual(project(other).items,[])
})

test('retains approved earlier attempts and protects rubric positions and drafts',()=>{
  const {state,admin,teacher,outsider,complete,run}=fixture()
  const item=complete([30]),id=item.id
  assert.throws(()=>run(outsider,'start',{id}),{status:403})
  run(teacher,'start',{id})
  assert.throws(()=>run(teacher,'draft',{id,...draft,errors:[{kind:'memory',surah:2,verse:1}]}),{status:400})
  run(teacher,'submit',{id,...draft})
  run(admin,'approve',{id,retest:true})
  const previous=structuredClone(item.attempts[0])
  assert.equal(previous.passed,false)
  assert.equal(previous.retest,true)
  assert.ok(item.review[0].focus.some(segment=>segment.surah===78))
  assert.throws(()=>run(teacher,'start',{id}),{status:403})
  const retry=Date.parse(item.retryDate+'T09:00:00+03:00')
  run(teacher,'start',{id},retry);run(teacher,'submit',{id,...strong},retry);run(admin,'approve',{id},retry)
  assert.deepEqual(item.attempts[0],previous)
  assert.equal(item.attempts[1].passed,true)
  assert.equal(state.assessments!.items.length,1)
})

test('rejects examiner overlap, reuses private Agora lessons, and preserves legacy exam data',()=>{
  const {state,admin,teacher,complete,run}=fixture()
  const a=complete([30]),b=complete([30],1)
  const previousExams=structuredClone(state.exams)
  const slot={date:'2026-12-06',time:'16:00',minutes:30,examinerId:teacher.id,mode:'online'}
  run(admin,'book',{id:a.id,...slot})
  assert.equal(state.lessons?.find(lesson=>lesson.id===a.appointment?.lessonId)?.kind,'private')
  assert.throws(()=>run(admin,'book',{id:b.id,...slot,time:'16:15'}),{status:409})
  run(admin,'book',{id:b.id,...slot,time:'16:30',mode:'onsite',place:'الجامع'})
  assert.deepEqual(state.exams,previousExams)
})
