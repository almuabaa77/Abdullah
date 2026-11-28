import { circleMeets, completedVerses, dateKey, dayOffset, idFor, nextCircleDate, type Circle, type Notice, type State, type Student } from '../src/domain'

export function scheduleAssessment(state:State,student:Student,circle?:Circle):Notice|undefined {
  const rule=circle?.autoExam
  if(!student.active||!circle||!rule)return
  const previous=state.exams.filter(exam=>exam.autoThreshold!==undefined&&exam.studentIds.includes(student.id))
  if(previous.some(exam=>!exam.results[student.id]||exam.autoThreshold!>=rule.threshold))return
  if(completedVerses(state.daily.filter(record=>record.studentId===student.id&&!record.historicalImport))<rule.threshold)return
  const earliest=dayOffset(dateKey(),rule.leadDays)
  let date=earliest
  if(!circleMeets(earliest,circle)) {
    try {date=nextCircleDate(earliest,circle)}
    catch {return}
  }
  const exam={id:idFor(),name:'اختبار الحفظ',studentIds:[student.id],date,time:rule.time,place:rule.place,
    scope:`مراجعة الحفظ المثبت في سجل الطالب عند بلوغ ${rule.threshold} آية مكتملة.`,results:{},autoThreshold:rule.threshold,circleId:circle.id}
  state.exams.unshift(exam)
  return {id:idFor(),kind:'exam',title:'حُدد موعد اختبار الحفظ',en:'Memorization assessment scheduled',
    body:`${date} · ${rule.time} · ${rule.place}`,time:new Date().toISOString(),studentId:student.id,readBy:[]}
}
