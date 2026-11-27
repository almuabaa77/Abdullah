import type { Message } from './domain'

export type LessonKind = 'circle' | 'private' | 'meeting' | 'urgent'
export type LessonMedia = 'audio' | 'video'
export type LessonStatus = 'scheduled' | 'live' | 'completed' | 'cancelled'
export type LessonDraft = {
  title:string; kind:LessonKind; circleId?:string; studentId?:string; invitees:string[]
  teacherId?:string; substituteId?:string; zone:string; date:string; start:string; end:string
  media:LessonMedia; roomMinutes:number; reminders:number[]; notes:string; chatId?:string
}
export type LessonAttendance = {from:string; to?:string}
export type LessonSeat = {
  status:'waiting'|'admitted'|'declined'|'left'|'removed'
  at:string; rtcIndex:number; generation:number; hand?:boolean; periods:LessonAttendance[]; lastSeen?:string
  micRequested?:boolean; joinOrder?:number
}
export type LessonMediaRoom = {channel:string; secret:string; salt:string; version:number}
export type Lesson = Omit<LessonDraft,'date'|'start'|'end'> & {
  id:string; seriesId?:string; localDate:string; startsAt:string; endsAt:string; status:LessonStatus
  revision:number; actualStart?:string; actualEnd?:string; currentStudent?:string; order:string[]
  closedAt?:string; turnStartedAt?:string; finishedTurns?:string[]
  seats:Record<string,LessonSeat>; delivered:number[]; exception?:boolean; messages?:Message[]
  mediaRoom?:LessonMediaRoom
}
export type LessonSeries = {
  id:string; draft:LessonDraft; repeat:'daily'|'weekly'; weekdays:number[]; through:string; except:string[]; stoppedBefore?:string
}
export type LessonRestriction = {id:string; lessonId:string; uid:number; attempts:number; nextAttempt:number; reason:string; expiresAt:number}
export type LessonNotice = {id:string; revision:number; reminder?:number}
export type LessonPerson = {id:string; name:string; role:'admin'|'teacher'|'student'; studentId?:string; seat?:LessonSeat; mediaUid?:number; canPublish?:boolean; joinOrder?:number}
export type LessonView = Omit<Lesson,'seats'|'invitees'|'delivered'|'mediaRoom'> & {
  manager:boolean; self?:LessonSeat; people:LessonPerson[]; waiting:number; connected:number; mediaChanging:boolean
  inviteCount:number; mediaVersion?:number
}
export type LessonCredentials = {appId:string; channel:string; uid:number; audio:boolean; video:boolean} & (
  {token:string; encryption?:never; version?:never}|
  {token:null; encryption:{secret:string;salt:string}; version:number}
)
export type LessonRtcStatus = {
  appId:string; certificate:boolean; customerId:boolean; customerSecret:boolean; coHostConfirmed:boolean
  rest:'pending'|'accepted'|'rejected'|'unavailable'
  mode?:'signed'|'encrypted'|'disabled'; probe?:LessonCredentials
}
export type LessonHealth = {rtcConfigured:boolean; encryptedMode?:boolean; lastRun?:string; lastError?:string; pendingRestrictions?:number; scheduleConflicts?:number}
export const lessonCapacity=24
export const lessonAgendaGraceMs=120_000
export function lessonClosed(lesson:Pick<Lesson,'status'|'endsAt'>,now=Date.now()) {
  return lesson.status==='completed'||lesson.status==='cancelled'||now>=Date.parse(lesson.endsAt)
}
export function lessonInAgenda(lesson:Pick<Lesson,'status'|'endsAt'|'actualEnd'|'closedAt'>,now=Date.now()) {
  if(lesson.status==='cancelled'&&!lesson.closedAt&&!lesson.actualEnd)return false
  return now<Date.parse(lesson.closedAt??lesson.actualEnd??lesson.endsAt)+lessonAgendaGraceMs
}
