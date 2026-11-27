import type { LessonSeat } from '../src/lessons'

export const tokenLifetime=240
export function lessonUid(seat:LessonSeat) {
  return seat.generation*1024+seat.rtcIndex
}
