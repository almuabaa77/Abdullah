import { createHash } from 'node:crypto'
import { dateKey, dayOffset, validateSegments, type Circle, type Daily, type Exam, type Link, type State, type Student, type User } from '../src/domain'
import { normalizeMobile } from '../src/phone-number'

type Row=Record<string,unknown>
type Target='users'|'circles'|'students'|'daily'|'links'|'exams'
export type Rules=Record<string,Rule>
type Rule={target:Target;fields:Record<string,string>;refs?:Record<string,string>;values?:Record<string,Record<string,string>>;matches?:Record<string,string>}
export const targets=['users','circles','students','daily','links','exams'] as const
type Outcome='proposed'|'matched'|'duplicate'|'archived'|'conflict'
type Decision={entity:string;sourceId?:string;row:number;target?:Target;targetId?:string;outcome:Outcome;reason?:string}
type Additions={circles:Circle[];students:Student[];daily:Daily[];links:Link[];exams:Exam[]}

const order:Target[]=['users','circles','students','daily','links','exams']
const roles=['admin','teacher','student','parent'] as const
const statuses=['none','partial','complete'] as const
const attendance=['present','absent','leave','excused','pending'] as const
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
  Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value
export const canonical=(value:unknown)=>JSON.stringify(stable(value))
const same=(left:unknown,right:unknown)=>canonical(left)===canonical(right)

const permittedFields:Record<Target,string[]>={
  users:['name','phone','role'],
  circles:['name','teacherId','days','holidays'],
  students:['name','phone','circleId','active','startingPoints','age','schoolStage','guardianPhone','address'],
  daily:['studentId','date','memorization','memorizationStatus','review','reviewStatus','nextMemorization','nextReview','nextDate','attendance','points','bonus','note','updatedAt'],
  links:['parentId','studentId','status','createdAt','reviewedAt'],
  exams:['name','date','place','scope','studentId','score','feedback','circleId'],
}
const entityAliases:Record<Target,string[]>={
  users:['user','account','appuser','profile'],
  circles:['circle','halaqa','halaqah','group'],
  students:['student','learner'],
  daily:['recitation','recitationlog','dailyrecord','attendance','memorizationsession'],
  links:['guardianlink','parentstudent','familylink','studentparent'],
  exams:['exam','examresult','assessmentresult'],
}
const alias:Record<string,string[]>={
  name:['title','fullname','studentname','circlename'],phone:['mobilenumber','mobile','phonenumber'],
  circleId:['circle','halaqaid','groupid'],teacherId:['teacher','instructorid','mentorid'],
  studentId:['student','learnerid'],parentId:['guardianid','parent'],date:['sessiondate','examdate','attendancedate'],
  memorization:['memorizationsegments','newmemorization','hifz'],memorizationStatus:['hifzstatus'],
  review:['reviewsegments','revision'],reviewStatus:['revisionstatus'],attendance:['attendancestatus'],
  score:['grade','mark'],startingPoints:['initialpoints'],createdAt:['createddate'],updatedAt:['updateddate'],
}
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/s$/,'')
const slug=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase()
function own(value:unknown,path:string) {
  return path.split('.').reduce<unknown>((part,key)=>part&&typeof part==='object'&&Object.hasOwn(part,key)?(part as Row)[key]:undefined,value)
}
function includeText(value:unknown,limit:number) {
  if(typeof value!=='string'||value.length>limit||!value.trim())throw new Error('invalid-text')
  return value.trim()
}
function optionalText(value:unknown,max:number) {return value===undefined||value===null||value===''?undefined:includeText(value,max)}
function numeric(value:unknown,minimum:number,maximum:number) {
  if(typeof value!=='number'&&(typeof value!=='string'||! /^-?\d+$/.test(value)))throw new Error('invalid-number')
  const n=Number(value)
  if(!Number.isSafeInteger(n)||n<minimum||n>maximum)throw new Error('invalid-number')
  return n
}
function data(value:unknown) {return typeof value==='string'?JSON.parse(value):value}
function list(value:unknown):unknown[] {
  const parsed=data(value)
  if(!Array.isArray(parsed))throw new Error('invalid-list')
  return parsed
}
function option<T extends string>(value:unknown,options:readonly T[]):T {
  if(typeof value!=='string'||!options.includes(value as T))throw new Error('invalid-status')
  return value as T
}
function day(value:unknown) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error('invalid-date')
  return value
}
function instant(value:unknown) {
  if(value===undefined||value===null||value==='')return undefined
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('invalid-timestamp')
  day(value.slice(0,10))
  return new Date(value).toISOString()
}
function phone(value:unknown) {
  if(value===undefined||value===null||value==='')return undefined
  const parsed=normalizeMobile(String(value))
  if(!parsed)throw new Error('invalid-phone')
  return parsed
}
function boolean(value:unknown) {
  if(value===true||value==='true')return true
  if(value===false||value==='false')return false
  throw new Error('invalid-boolean')
}
function deterministic(appId:string,entity:string,id:string) {
  return 'base44-'+createHash('sha256').update(JSON.stringify([appId,entity,id])).digest('hex').slice(0,32)
}

function inventory(tables:Record<string,Row[]>,rules:Rules) {
  return Object.entries(tables).map(([entity,rows])=>{
    const fields=new Map<string,{types:Set<string>;count:number}>()
    for(const row of rows)for(const [key,value] of Object.entries(row)){
      const entry=fields.get(key)??{types:new Set<string>(),count:0}
      entry.types.add(value===null?'null':Array.isArray(value)?'array':typeof value)
      entry.count++;fields.set(key,entry)
    }
    const candidates=order.filter(target=>entityAliases[target].some(name=>normalized(name)===normalized(entity)))
    const target=rules[entity]?.target??candidates[0]
    const suggested=target?Object.fromEntries(permittedFields[target].flatMap(field=>{
      const recognized=[field,...(alias[field]??[])].map(normalized)
      const matches=[...fields.keys()].filter(key=>recognized.includes(normalized(key)))
      return matches.length===1?[[field,matches[0]]]:[]
    })):{}
    const mapped=new Set(Object.values(rules[entity]?.fields??{}).map(path=>path.split('.')[0]))
    return {entity,rows:rows.length,target,configured:Boolean(rules[entity]),suggested,
      fields:[...fields].map(([key,{count,types}])=>({key,count,types:[...types],mapped:mapped.has(key)}))}
  })
}

export function planBase44(appId:string,tables:Record<string,Row[]>,current:State,rules:Rules={},today=dateKey()) {
  if(!rules||typeof rules!=='object'||Array.isArray(rules))throw new Error('Expected reviewed entity mappings.')
  for(const [name,rule] of Object.entries(rules)){
    if(!Object.hasOwn(tables,name)||!order.includes(rule?.target)||!rule.fields||typeof rule.fields!=='object'||Array.isArray(rule.fields)||
      Object.entries(rule.fields).some(([field,path])=>!permittedFields[rule.target].includes(field)||typeof path!=='string'||!path||path.split('.').some(key=>['__proto__','prototype','constructor'].includes(key))))throw new Error('Invalid reviewed mapping for '+name)
  }
  const additions:Additions={circles:[],students:[],daily:[],links:[],exams:[]}
  const users=new Map(current.users.map(user=>[user.id,user]))
  const circles=new Map(current.circles.map(circle=>[circle.id,circle]))
  const students=new Map(current.students.map(student=>[student.id,student]))
  const daily=new Map(current.daily.map(record=>[canonical([record.studentId,record.date]),record]))
  const links=new Map(current.links.map(link=>[canonical([link.parentId,link.studentId]),link]))
  const exams=new Map(current.exams.map(exam=>[exam.id,exam]))
  const decisions:Decision[]=[]
  const identities=new Map<string,{id:string;target:Target}>()
  const equivalentExams=new Map(current.exams.flatMap(exam=>exam.studentIds.flatMap(id=>{
    const score=exam.results[id]?.score
    return score===undefined?[]:[[canonical([id,exam.date,slug(exam.name)]),exam] as const]
  })))
  const maybeId=(row:Row)=>typeof row.id==='string'&&row.id.trim()?row.id:undefined
  const entries=Object.entries(tables).sort(([a],[b])=>(order.indexOf(rules[a]?.target??'exams')-order.indexOf(rules[b]?.target??'exams'))||a.localeCompare(b))
  for(const [entity,rows] of entries){
    const rule=rules[entity],target=rule?.target
    const counts=new Map<string,number>()
    for(const row of rows){const id=maybeId(row);if(id)counts.set(id,(counts.get(id)??0)+1)}
    for(const [index,row] of rows.entries()){
      const sourceId=maybeId(row)
      const decision:Decision={entity,sourceId,row:index+1,target,outcome:'archived'}
      decisions.push(decision)
      if(!rule||!target){decision.reason='mapping-required';continue}
      if(!sourceId){decision.reason='source-id-missing';continue}
      if(counts.get(sourceId)!>1){decision.outcome='conflict';decision.reason='duplicate-source-id';continue}
      if(row.is_deleted===true||row.is_deleted==='true'||row.deleted_date||row.deleted_at){decision.reason='deleted-history';continue}
      const entry=(field:string)=>{
        const value=rule.fields[field]?own(row,rule.fields[field]):undefined
        return typeof value==='string'&&Object.hasOwn(rule.values?.[field]??{},value)?rule.values![field][value]:value
      }
      const ref=(field:string,expected:Target)=>{
        const id=includeText(entry(field),191),namespace=rule.refs?.[field]
        const match=namespace?identities.get(canonical([namespace,id])):undefined
        if(!match||match.target!==expected)throw new Error('unresolved-'+field)
        return match.id
      }
      const resolve=(id:string,outcome:Outcome)=>{
        identities.set(canonical([entity,sourceId]),{id,target})
        decision.targetId=id;decision.outcome=outcome
      }
      const specific=Object.hasOwn(rule.matches??{},sourceId)?rule.matches![sourceId]:undefined
      const id=deterministic(appId,entity,sourceId)
      try {
        if(target==='users'){
          const role=option(entry('role'),roles),number=phone(entry('phone'))
          const matches=number?[...users.values()].filter(user=>normalizeMobile(user.phone??'')===number):[]
          const match=matches[0]
          const name=optionalText(entry('name'),120)
          if(!match||matches.length!==1||match.role!==role||match.duplicateOf||match.status!=='active'||
            (specific?specific!==match.id:!name||slug(name)!==slug(match.name)))throw new Error('account-verification-required')
          resolve(match.id,'matched')
        }else if(target==='circles'){
          const name=includeText(entry('name'),120),teacherId=ref('teacherId','users')
          if(users.get(teacherId)?.role!=='teacher')throw new Error('teacher-required')
          const matches=[...circles.values()].filter(circle=>slug(circle.name)===slug(name))
          const match=circles.get(specific??id)??(matches.length===1?matches[0]:undefined)
          if(match){
            if(match.teacherId!==teacherId||specific&&specific!==match.id)throw new Error('circle-teacher-conflict')
            resolve(match.id,'matched');continue
          }
          if(specific||matches.length)throw new Error('ambiguous-circle')
          const days=[...new Set(list(entry('days')).map(value=>numeric(value,0,6)))].sort()
          if(!days.length)throw new Error('workdays-required')
          const holidays=entry('holidays')==null?[]:[...new Set(list(entry('holidays')).map(day))].sort()
          const circle={id,name,teacherId,days,holidays}
          circles.set(id,circle);additions.circles.push(circle);resolve(id,'proposed')
        }else if(target==='students'){
          const name=includeText(entry('name'),120),circleId=ref('circleId','circles'),number=phone(entry('phone'))
          const matches=number?[...students.values()].filter(student=>normalizeMobile(student.phone??'')===number):[]
          const byName=[...students.values()].filter(student=>student.circleId===circleId&&slug(student.name)===slug(name))
          const match=students.get(specific??id)??(matches.length===1?matches[0]:undefined)
          if(match){
            if(matches.length>1||match.circleId!==circleId||specific&&match.id!==specific||number&&number!==normalizeMobile(match.phone??''))throw new Error('student-identity-conflict')
            resolve(match.id,'matched');continue
          }
          if(specific||matches.length||byName.length||number&&[...users.values()].some(user=>normalizeMobile(user.phone??'')===number))throw new Error('student-match-review-required')
          const student:Student={id,name,circleId,phone:number,color:0,active:boolean(entry('active')),startingPoints:numeric(entry('startingPoints'),0,1_000_000),
            age:entry('age')==null||entry('age')===''?undefined:numeric(entry('age'),3,120),schoolStage:optionalText(entry('schoolStage'),90),
            guardianPhone:phone(entry('guardianPhone')),address:optionalText(entry('address'),300)}
          students.set(id,student);additions.students.push(student);resolve(id,'proposed')
        }else if(target==='daily'){
          const studentId=ref('studentId','students'),date=day(entry('date'))
          if(date>=today)throw new Error('historical-date-required')
          const segments=(field:string)=>{const value=entry(field);return value===undefined||value===''?[]:validateSegments(data(value))}
          const memorization=segments('memorization'),review=segments('review')
          const memorizationStatus=memorization.length?option(entry('memorizationStatus'),statuses):'none'
          const reviewStatus=review.length?option(entry('reviewStatus'),statuses):'none'
          const nextMemorization=segments('nextMemorization'),nextReview=segments('nextReview')
          let nextDate=dayOffset(date,1)
          const hasNext=nextMemorization.length>0||nextReview.length>0
          if(entry('nextDate')!==undefined&&entry('nextDate')!=='')nextDate=day(entry('nextDate'))
          else if(hasNext)throw new Error('assignment-date-required')
          if(nextDate<=date||hasNext&&nextDate>=today)throw new Error('assignment-requires-review')
          const dayRecord:Daily={studentId,date,memorization,memorizationStatus,review,reviewStatus,nextMemorization,nextReview,nextDate,
            attendance:option(entry('attendance'),attendance),attendanceSource:'manual',points:numeric(entry('points'),-1_000_000,1_000_000),
            bonus:entry('bonus')===undefined||entry('bonus')===''?0:numeric(entry('bonus'),-100,100),note:optionalText(entry('note'),400)??'',
            historicalImport:true,updatedAt:instant(entry('updatedAt')),version:1}
          const key=canonical([studentId,date]),match=daily.get(key)
          const comparable=(r:Daily)=>[r.memorization,r.memorizationStatus,r.review,r.reviewStatus,r.nextMemorization,r.nextReview,r.nextMemorization.length||r.nextReview.length?r.nextDate:null,r.attendance,r.points,r.bonus,r.note,r.clearedAssignment??[]]
          if(match){
            if(!same(comparable(match),comparable(dayRecord)))throw new Error('daily-conflict')
            resolve(studentId+'/'+date,'duplicate');continue
          }
          daily.set(key,dayRecord);additions.daily.push(dayRecord);resolve(studentId+'/'+date,'proposed')
        }else if(target==='links'){
          const parentId=ref('parentId','users'),studentId=ref('studentId','students')
          if(users.get(parentId)?.role!=='parent')throw new Error('parent-required')
          const status=option(entry('status'),['accepted','declined','cancelled'] as const)
          const key=canonical([parentId,studentId]),match=links.get(key)
          if(match){
            if(match.status!==status)throw new Error('family-link-conflict')
            resolve(match.id,'duplicate');continue
          }
          const link={id,parentId,studentId,status,createdAt:instant(entry('createdAt')),reviewedAt:instant(entry('reviewedAt'))}
          links.set(key,link);additions.links.push(link);resolve(id,'proposed')
        }else{
          const date=day(entry('date'))
          if(date>=today)throw new Error('historical-date-required')
          const name=includeText(entry('name'),150),studentId=ref('studentId','students'),score=numeric(entry('score'),0,100)
          const result={score,feedback:optionalText(entry('feedback'),400)??''}
          const key=canonical([studentId,date,slug(name)]),match=exams.get(id)??equivalentExams.get(key)
          if(match){
            if(!same(match.results[studentId],result))throw new Error('exam-result-conflict')
            resolve(match.id,'duplicate');continue
          }
          const exam:Exam={id,date,name,studentIds:[studentId],results:{[studentId]:result},
            place:optionalText(entry('place'),150)??'',scope:optionalText(entry('scope'),400)??'',
            circleId:rule.refs?.circleId?ref('circleId','circles'):students.get(studentId)?.circleId}
          exams.set(id,exam);equivalentExams.set(key,exam);additions.exams.push(exam);resolve(id,'proposed')
        }
      }catch(error){
        decision.outcome='conflict'
        const code=(error as Error).message
        decision.reason=/^[a-z-]+$/.test(code)?code:'invalid-field-value'
      }
    }
  }
  const counts={proposed:0,matched:0,duplicate:0,archived:0,conflict:0}
  for(const decision of decisions)counts[decision.outcome]++
  return {additions,decisions,counts,inventory:inventory(tables,rules)}
}
