import assert from 'node:assert/strict'
import test from 'node:test'
import { planBase44, type Rules } from '../server/base44-mapping'
import { scheduleAssessment } from '../server/assessment'
import { evaluateAssessmentEligibility, projectAssessments, runAssessmentSchedule } from '../server/assessment-workflow'
import { createState } from '../server/seed'
import { assessmentSections } from '../src/assessment-model'
import { emptyDaily, type User } from '../src/domain'

const app='6aad731df6fcd4e04d5f3c08'
const today='2026-11-28'
const now=Date.parse(today+'T15:00:00+03:00')
const teacher:User={id:'firebase-teacher',role:'teacher',status:'active',name:'محفظ الحلقة',phone:'+966501234567'}
const parent:User={id:'firebase-parent',role:'parent',status:'active',name:'ولي الأمر',phone:'+966502345678'}
const admin:User={id:'firebase-admin',role:'admin',status:'active',name:'المدير'}
const UserRows=[{id:'t',name:teacher.name,phone:'0501234567',role:'teacher'},{id:'p',name:parent.name,phone:'0502345678',role:'parent'}]
const identity=(...names:string[])=>Object.fromEntries(names.map(name=>[name,name]))
const rules:Rules={
  User:{target:'users',fields:identity('name','phone','role')},
  Circle:{target:'circles',fields:identity('name','teacherId','days'),refs:{teacherId:'User'}},
  Student:{target:'students',fields:identity('name','circleId','active','startingPoints'),refs:{circleId:'Circle'}},
  DailyRecord:{target:'daily',fields:identity('studentId','date','attendance','points','memorization','memorizationStatus'),refs:{studentId:'Student'}},
  FamilyLink:{target:'links',fields:identity('studentId','parentId','status'),refs:{studentId:'Student',parentId:'User'}},
}
function fixture(){
  const state=createState()
  state.users=[teacher,parent,admin]
  const tables={User:UserRows,Circle:[{id:'c',name:'حلقة النور',teacherId:'t',days:[0,1,2,3]}],Student:[{id:'s',name:'أحمد محمد سالم',circleId:'c',active:true,startingPoints:0}],
    DailyRecord:[{id:'d',studentId:'s',date:'2026-11-19',attendance:'present',points:7,memorization:assessmentSections([30]),memorizationStatus:'complete'}],
    FamilyLink:[{id:'l',studentId:'s',parentId:'p',status:'accepted'}],LibraryItem:[{id:'untouched',url:'base44://private/book',status:'draft'}]}
  return {state,tables}
}

test('maps verified existing users, resolves references and preserves unmatched fields in the catalog',()=>{
  const {state,tables}=fixture()
  const before=structuredClone(state)
  const plan=planBase44(app,tables,state,rules,today)
  assert.deepEqual(state,before)
  assert.deepEqual(plan.counts,{proposed:4,matched:2,duplicate:0,archived:1,conflict:0})
  assert.equal(plan.additions.circles[0].teacherId,teacher.id)
  const student=plan.additions.students[0],record=plan.additions.daily[0]
  assert.equal(record.studentId,student.id)
  assert.equal(record.points,7)
  assert.equal(record.historicalImport,true)
  assert.equal(plan.additions.links[0].parentId,parent.id)
  assert.ok(plan.inventory.find(table=>table.entity==='LibraryItem')?.fields.some(field=>field.key==='url'&&!field.mapped))
  const again=planBase44(app,tables,{...state,...plan.additions},rules,today)
  assert.equal(again.counts.proposed,0)
  assert.equal(again.counts.duplicate,2)
})

test('blocks duplicate source IDs, phone-role conflicts and different daily records',()=>{
  const {state,tables}=fixture()
  const initial=planBase44(app,tables,state,rules,today)
  const current={...state,...initial.additions}
  const changed={...tables,DailyRecord:[{...tables.DailyRecord[0],points:90}]}
  const report=planBase44(app,changed,current,rules,today)
  assert.ok(report.decisions.some(decision=>decision.reason==='daily-conflict'))
  assert.deepEqual(report.additions.daily,[])
  assert.deepEqual(current.daily,initial.additions.daily)
  const duplicates={...tables,Student:[...tables.Student,...tables.Student]}
  assert.equal(planBase44(app,duplicates,state,rules,today).decisions.filter(row=>row.reason==='duplicate-source-id').length,2)
  const reassigned={...tables,User:[{...UserRows[0],name:'شخص مختلف'},UserRows[1]]}
  assert.ok(planBase44(app,reassigned,state,rules,today).decisions.some(row=>row.reason==='account-verification-required'))
})

test('history remains visible but cannot trigger scheduled assessments in either engine',()=>{
  const {state,tables}=fixture()
  const plan=planBase44(app,tables,state,rules,today)
  const migrated={...state,...plan.additions}
  const student=migrated.students[0],circle=migrated.circles[0]
  circle.autoExam={threshold:3,leadDays:1,time:'16:00',place:'الجامع'}
  assert.equal(scheduleAssessment(migrated,student,circle),undefined)
  assert.equal(evaluateAssessmentEligibility(migrated,student,now),false)
  runAssessmentSchedule(migrated,now)
  assert.deepEqual(migrated.assessments?.items,[])
  assert.deepEqual(migrated.notices,[])
  assert.deepEqual(projectAssessments(migrated,admin,[student],now).roster[0].parts,[30])
  assert.equal(migrated.daily[0].historicalImport,true)
  migrated.daily.push({...emptyDaily(student.id,today,circle),memorizationStatus:'complete',memorization:assessmentSections([29])})
  assert.ok(evaluateAssessmentEligibility(migrated,student,now))
  assert.deepEqual(migrated.assessments?.items[0].parts,[29])
})
