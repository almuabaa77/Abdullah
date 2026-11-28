import { dayOffset, surahs, type Daily, type Segment } from './domain'
import { juzStarts } from './quran-juz'

export type AssessmentKind = 'practice'|'stage'
export type AssessmentPolicy = {
  active:boolean; order:number[]; practiceSize:number; stageSize:number; requirePractice:boolean
  workdays:number[]; holidays:string[]; days:Record<AssessmentKind,number>
  passing:Record<AssessmentKind,number>; stagePassing:Record<string,number>
  extensionDays:number; extensionLimit:number; retakeDays:number; reminderDays:number[]
  weights:number[]; grades:{min:number;ar:string;en:string}[]
  criteria?:{ar:string;en:string}[]
  teacherApproval:boolean; teacherScheduling:boolean; autoCertificate:boolean
}
export const juzOrder=Array.from({length:30},(_,i)=>i+1)
export const assessmentKinds=['practice','stage'] as const
export const errorKinds=['memory','hesitation','prompt','tajwid','pause','skip','similar'] as const
export type AssessmentError = {kind:typeof errorKinds[number];surah?:number;verse?:number;note?:string}
export type AssessmentAttempt = {
  id:string; examinerId:string; evaluator:string; state:'draft'|'submitted'|'approved'; updatedAt:string; version:number
  scores:number[]; score:number; feedback:string; errors:AssessmentError[]; questions:Segment[]
  approvedAt?:string; approvedBy?:string; passed?:boolean; retest?:boolean; grade?:{ar:string;en:string}
}
export type AssessmentAppointment = {date:string;time:string;minutes:number;mode:'onsite'|'online';place:string;examinerId:string;lessonId?:string}
export type AssessmentExtension = {id:string;days:number;reason:string;expected:string;status:'pending'|'accepted'|'declined';decidedAt?:string;decisionNote?:string}
export type ReviewTask = {date:string;segments:Segment[];focus:Segment[];note?:string;done?:boolean}
export type AssessmentCertificate = {
  id:string; issuedAt:string; studentName:string; examiner:string; approvedBy:string; score:number; grade:{ar:string;en:string}
  revokedAt?:string; revokeReason?:string
}
export type AssessmentCase = {
  id:string;kind:AssessmentKind;unit:number;parts:number[];studentId:string;circleId:string; eligibleAt:string; deadline:string
  policy:AssessmentPolicy; attempts:AssessmentAttempt[]; extensions:AssessmentExtension[]; review:ReviewTask[]
  readyStudent?:boolean;readyTeacher?:boolean;nominated?:boolean;inProgress?:boolean
  proposed?:AssessmentAppointment; appointment?:AssessmentAppointment; reminders:string[]
  certificate?:AssessmentCertificate; oldCertificates?:AssessmentCertificate[]; retryDate?:string; cancelledAt?:string
}
export type AssessmentState = {
  items:AssessmentCase[]; policy?:AssessmentPolicy; rings?:Record<string,AssessmentPolicy>; routes?:Record<string,number[]>
  lastScan?:string; scheduledRun?:number
}
export type AssessmentView = Omit<AssessmentCase,'policy'|'reminders'|'oldCertificates'> & {
  studentName:string;circleName:string;examinerName?:string; status:AssessmentStatus; remaining:number
  extendThrough:string[]; canAssess:boolean; canApprove:boolean; canSchedule:boolean; canManage:boolean
  weights:number[]; criteria:{ar:string;en:string}[]; passMark:number; suggestions?:AssessmentAppointment[]
}
export type AssessmentRoster = {id:string;name:string;circleId:string;teacherId:string;parts:number[];covered:number;tested:number;practiceParts:number[];stageParts:number[];route:number[]}
export type AssessmentDashboard = {
  items:AssessmentView[]; roster:AssessmentRoster[]; examiners:{id:string;name:string}[]
  policy?:AssessmentPolicy; rings?:Record<string,AssessmentPolicy>; routes?:Record<string,number[]>
}
export const defaultAssessmentPolicy:AssessmentPolicy = {
  active:true,order:[...juzOrder].reverse(),practiceSize:1,stageSize:2,requirePractice:true,
  workdays:[0,1,2,3],holidays:[],days:{practice:7,stage:7},passing:{practice:70,stage:70},stagePassing:{},
  extensionDays:3,extensionLimit:1,retakeDays:7,reminderDays:[3,1],weights:[60,20,10,10],
  grades:[
    {min:95,ar:'ممتاز',en:'Excellent'},{min:90,ar:'ممتاز منخفض',en:'Lower excellent'},
    {min:80,ar:'جيد جدًا',en:'Very good'},{min:70,ar:'جيد',en:'Good'},{min:0,ar:'يحتاج إلى إعادة الاختبار',en:'Retest recommended'},
  ],teacherApproval:false,teacherScheduling:false,autoCertificate:true,
}
export const defaultAssessmentCriteria=[
  {ar:'إتقان الحفظ',en:'Memorization'},{ar:'التجويد',en:'Tajwid'},
  {ar:'الطلاقة والاسترسال',en:'Fluency'},{ar:'الوقف والابتداء',en:'Stopping and starting'},
]
const offsets=[0]
for(const surah of surahs)offsets.push(offsets.at(-1)!+surah.count)
export const quranVerses=offsets.at(-1)!
const bounds=[...juzStarts.map(([surah,verse])=>offsets[surah-1]+verse-1),quranVerses]
export function assessmentSections(parts:number[]) {
  return parts.flatMap(part=>verseSegments(bounds[part-1],bounds[part]))
}
function verseSegments(start:number,end:number):Segment[] {
  return surahs.flatMap((surah,index)=>{
    const from=Math.max(start,offsets[index]),to=Math.min(end,offsets[index+1])
    return to>from?[{surah:surah.id,from:from-offsets[index]+1,to:to-offsets[index]}]:[]
  })
}
export function assessmentCovers(parts:number[],surah:number,verse:number) {
  if(!surahs[surah-1]||verse<1||verse>surahs[surah-1].count)return false
  const index=offsets[surah-1]+verse-1
  return parts.some(part=>index>=bounds[part-1]&&index<bounds[part])
}
export function assessmentCoverage(records:Daily[]) {
  const known=new Uint8Array(quranVerses)
  for(const record of records)if(record.memorizationStatus==='complete')for(const {surah,from,to} of record.memorization){
    if(surahs[surah-1]&&from>=1&&to<=surahs[surah-1].count&&to>=from)known.fill(1,offsets[surah-1]+from-1,offsets[surah-1]+to)
  }
  return {parts:juzOrder.filter(part=>!known.subarray(bounds[part-1],bounds[part]).includes(0)),covered:known.reduce((sum,verse)=>sum+verse,0)}
}
export function assessmentWorkday(date:string,calendar:Pick<AssessmentPolicy,'workdays'|'holidays'>) {
  return calendar.workdays.includes(new Date(date+'T12:00:00Z').getUTCDay())&&!calendar.holidays.includes(date)
}
export function addAssessmentDays(date:string,count:number,calendar:Pick<AssessmentPolicy,'workdays'|'holidays'>) {
  for(let steps=0;count>0&&steps<730;steps++){
    date=dayOffset(date,1)
    if(assessmentWorkday(date,calendar))count--
  }
  return date
}
export function assessmentDaysLeft(today:string,deadline:string,calendar:Pick<AssessmentPolicy,'workdays'|'holidays'>) {
  let days=0
  for(let date=dayOffset(today,1),i=0;date<=deadline&&i<730;date=dayOffset(date,1),i++)if(assessmentWorkday(date,calendar))days++
  return days
}
export function assessmentChunks(order:number[],size:number) {
  return Array.from({length:Math.ceil(order.length/size)},(_,i)=>order.slice(i*size,(i+1)*size))
}
export function assessmentQuestions(parts:number[]) {
  const count=Math.min(8,Math.max(3,parts.length*2))
  const verses=parts.flatMap(part=>Array.from({length:bounds[part]-bounds[part-1]},(_,i)=>bounds[part-1]+i))
  return Array.from({length:count},(_,i)=>{
    const index=Math.floor((i+.34)*verses.length/count)
    return verseSegments(verses[index],verses[index]+1)[0]
  })
}
export function reviewSections(parts:number[],count:number) {
  const verses=parts.flatMap(part=>Array.from({length:bounds[part]-bounds[part-1]},(_,i)=>bounds[part-1]+i))
  return Array.from({length:count},(_,i)=>{
    const chunk=verses.slice(Math.floor(i*verses.length/count),Math.floor((i+1)*verses.length/count))
    const segments:Segment[]=[]
    let start=chunk[0],previous=start
    for(const index of chunk.slice(1)){
      if(index!==previous+1){segments.push(...verseSegments(start,previous+1));start=index}
      previous=index
    }
    if(start!==undefined)segments.push(...verseSegments(start,previous+1))
    return segments
  })
}
export function assessmentPassMark(item:Pick<AssessmentCase,'kind'|'policy'|'unit'>) {
  return (item.kind==='stage'?item.policy.stagePassing[String(item.unit)]:undefined)??item.policy.passing[item.kind]
}
export function appointmentStart(item:AssessmentAppointment) {
  return Date.parse(item.date+'T'+item.time+':00+03:00')
}
export function assessmentStatus(item:AssessmentCase,today:string,now=Date.now()) {
  const result=item.attempts.at(-1)
  if(item.cancelledAt)return 'cancelled'
  if(result?.state==='submitted')return 'pending-approval'
  if(result?.passed)return 'passed'
  if(item.inProgress)return result?.state==='draft'?'recording':'in-progress'
  if(item.appointment&&appointmentStart(item.appointment)+item.appointment.minutes*60_000<now)return 'awaiting-result'
  if(today>item.deadline)return 'overdue'
  if(item.appointment)return 'scheduled'
  if(result?.state==='approved')return result.retest?'retest':'review'
  if(item.readyStudent||item.readyTeacher)return 'ready'
  return today===item.eligibleAt?'eligible':'preparing'
}
export type AssessmentStatus=ReturnType<typeof assessmentStatus>
