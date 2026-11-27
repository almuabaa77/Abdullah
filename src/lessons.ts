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
}
export type Lesson = Omit<LessonDraft,'date'|'start'|'end'> & {
  id:string; seriesId?:string; localDate:string; startsAt:string; endsAt:string; status:LessonStatus
  revision:number; actualStart?:string; actualEnd?:string; currentStudent?:string; order:string[]
  seats:Record<string,LessonSeat>; delivered:number[]; exception?:boolean; messages?:Message[]
}
export type LessonSeries = {
  id:string; draft:LessonDraft; repeat:'daily'|'weekly'; weekdays:number[]; through:string; except:string[]; stoppedBefore?:string
}
export type LessonRestriction = {id:string; lessonId:string; uid:number; attempts:number; nextAttempt:number; reason:string; expiresAt:number}
export type LessonNotice = {id:string; revision:number; reminder?:number}
export type LessonPerson = {id:string; name:string; role:'admin'|'teacher'|'student'; studentId?:string; seat?:LessonSeat}
export type LessonView = Omit<Lesson,'seats'|'invitees'|'delivered'> & {
  manager:boolean; self?:LessonSeat; people:LessonPerson[]; waiting:number; connected:number; mediaChanging:boolean
}
export type LessonCredentials = {appId:string; channel:string; uid:number; token:string; audio:boolean; video:boolean}
export type LessonHealth = {rtcConfigured:boolean; lastRun?:string; lastError?:string; pendingRestrictions?:number; scheduleConflicts?:number}
export const lessonCapacity=24
