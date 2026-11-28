import assert from 'node:assert/strict'
import test from 'node:test'
import { createState } from '../server/seed'
import { removeSchoolEntry } from '../server/admin-removal'
import { approveLegacyPoints } from '../server/legacy-points'
import { accountFingerprint } from '../server/account-phones'
import { balanceFor, emptyDaily, type User } from '../src/domain'

function school(){
  const state=createState()
  const circle={id:'circle',name:'حلقة العصر',teacherId:'teacher',days:[0,1,2,3],holidays:[]}
  const student={id:'student',name:'طالب',active:true,startingPoints:4,color:0,circleId:circle.id}
  const guardian:User={id:'parent',name:'ولي أمر',role:'parent',status:'active'}
  const account:User={id:'account',name:student.name,role:'student',studentId:student.id,status:'active'}
  state.users=[guardian,account]
  state.circles=[circle];state.students=[student]
  state.links=[{id:'link',studentId:student.id,parentId:guardian.id,status:'accepted'}]
  const row={...emptyDaily(student.id,'2026-11-02',circle),points:17,legacyPoints:12,historicalImport:true as const}
  state.daily=[row]
  state.legacyPointReviews=[{studentId:student.id,stored:42,ledger:40,movements:8}]
  state.orders=[{id:'order',studentId:student.id,prizeId:'prize',name:'Prize',price:3,status:'pending',date:'2026-11-02'}]
  return {state,student,circle,guardian,account}
}

test('points approval is additive, idempotent, and imported display values are excluded',()=>{
  const {state,student}=school()
  assert.equal(balanceFor(student,state),18)
  assert.throws(()=>approveLegacyPoints(state,student.id,-1,'خطأ','أبو حسام'),{status:400})
  assert.equal(approveLegacyPoints(state,student.id,40,'مطابق للإيصال','أبو حسام'),true)
  assert.equal(balanceFor(student,state),58)
  assert.equal(approveLegacyPoints(state,student.id,40,'إعادة المحاولة','أبو حسام'),false)
  assert.equal(state.audit.length,1)
  assert.equal(state.audit[0].before,18)
})

test('parent removal detaches family rights without removing a child or their ledger',async()=>{
  const {state,student,guardian}=school()
  await assert.rejects(removeSchoolEntry(state,'parent',guardian.id,'أخطأت','سبب','أبو حسام'))
  assert.equal(await removeSchoolEntry(state,'parent',guardian.id,guardian.name,'طلب معتمد','أبو حسام'),true)
  assert.equal(state.links.length,0)
  assert.equal(state.daily.length,1)
  assert.equal(balanceFor(student,state),18)
  assert.deepEqual(state.closedAccounts,[await accountFingerprint(guardian.id)])
})

test('student and circle removal protect pending rewards and occupied assignments',async()=>{
  const {state,student,circle,account}=school()
  await assert.rejects(removeSchoolEntry(state,'circle',circle.id,circle.name,'تنظيف','أبو حسام'),{status:409})
  await assert.rejects(removeSchoolEntry(state,'student',student.id,student.name,'طلب معتمد','أبو حسام'),{status:409})
  state.orders[0].status='delivered'
  assert.equal(await removeSchoolEntry(state,'student',student.id,student.name,'طلب معتمد','أبو حسام'),true)
  assert.equal(state.daily.length+state.students.length+state.legacyPointReviews!.length,0)
  assert.deepEqual(state.closedAccounts,[await accountFingerprint(account.id)])
  assert.equal(await removeSchoolEntry(state,'circle',circle.id,circle.name,'تنظيف','أبو حسام'),true)
})
