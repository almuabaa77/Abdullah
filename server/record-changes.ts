import { sameSegments, type Daily, type RecordSection } from '../src/domain'

export const memorizationChanged = (previous: Daily, next: Daily) => previous.memorizationStatus!==next.memorizationStatus || !sameSegments(previous.memorization,next.memorization)
export const reviewChanged = (previous: Daily, next: Daily) => previous.reviewStatus!==next.reviewStatus || !sameSegments(previous.review,next.review)

export function recordChanges(previous: Daily, next: Daily) {
  const changes: RecordSection[] = []
  const moved = previous.nextDate!==next.nextDate
  if (memorizationChanged(previous,next)) changes.push('memorization')
  if (reviewChanged(previous,next)) changes.push('review')
  if (!sameSegments(previous.nextMemorization,next.nextMemorization) || moved && next.nextMemorization.length) changes.push('nextMemorization')
  if (!sameSegments(previous.nextReview,next.nextReview) || moved && next.nextReview.length) changes.push('nextReview')
  if (previous.attendance!==next.attendance) changes.push('attendance')
  if (previous.points!==next.points || previous.bonus!==next.bonus) changes.push('points')
  if (previous.note!==next.note) changes.push('note')
  return changes
}
