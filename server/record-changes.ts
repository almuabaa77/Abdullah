import { sameSegments, type Daily, type RecordSection } from '../src/domain'

export const memorizationChanged = (previous: Daily, next: Daily) => previous.memorizationStatus!==next.memorizationStatus || !sameSegments(previous.memorization,next.memorization)
export const reviewChanged = (previous: Daily, next: Daily) => previous.reviewStatus!==next.reviewStatus || !sameSegments(previous.review,next.review)

export function recordChanges(previous: Daily, next: Daily) {
  const changes: RecordSection[] = []
  const moved = previous.nextDate!==next.nextDate
  if (memorizationChanged(previous,next)) changes.push('memorization')
  if (reviewChanged(previous,next)) changes.push('review')
  for(const field of ['nextMemorization','nextReview'] as const) {
    const cleared=Boolean(next.clearedAssignment?.includes(field))
    const wasCleared=Boolean(previous.clearedAssignment?.includes(field))
    if(cleared!==wasCleared||!sameSegments(previous[field],next[field])||moved&&next[field].length)changes.push(field)
  }
  if (previous.attendance!==next.attendance || previous.attendanceSource!==next.attendanceSource) changes.push('attendance')
  if (previous.points!==next.points || previous.bonus!==next.bonus) changes.push('points')
  if (previous.note!==next.note) changes.push('note')
  return changes
}
