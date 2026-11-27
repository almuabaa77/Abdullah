import type { LessonMediaRoom, LessonSeat } from '../src/lessons'

export const tokenLifetime=240
export function lessonUid(seat:LessonSeat) {
  return seat.generation*1024+seat.rtcIndex
}
export const mediaPresenceTimeout=55_000

export function newLessonMediaRoom(version:number):LessonMediaRoom {
  const base64=(length:number)=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(length))))
  return {
    channel:'halaqat-room-'+crypto.randomUUID().replaceAll('-',''),
    secret:'A9!'+base64(32),
    salt:base64(32),
    version,
  }
}
