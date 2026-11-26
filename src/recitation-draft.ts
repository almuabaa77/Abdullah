import { assignmentFor, emptyDaily, type Circle, type Daily } from './domain'
import type { WizardMode } from './ui'

export const recitationKinds = ['memorization','review'] as const
export type RecitationKind = typeof recitationKinds[number]
export const outcome = {memorization:'memorizationStatus',review:'reviewStatus'} as const

export function prepareRecitation(records: Daily[], studentId: string, date: string, circle: Circle | undefined, mode: WizardMode, preset?: Partial<Daily>) {
  const saved = records.find(record=>record.studentId===studentId&&record.date===date)
  const base = saved ?? emptyDaily(studentId,date,circle)
  const draft = {...base,...preset,studentId,date}
  const suggested:RecitationKind[] = []
  if (mode==='recite'||mode==='review') {
    const plan = assignmentFor(records,studentId,date)
    for (const kind of recitationKinds) {
      if (base[kind].length) {
        draft[kind] = base[kind]
        draft[outcome[kind]] = base[outcome[kind]]
        continue
      }
      if (mode==='review'&&kind==='memorization' || preset?.[kind]!==undefined) continue
      const segments = kind==='memorization' ? plan?.nextMemorization : plan?.nextReview
      if (!segments?.length) continue
      draft[kind] = segments
      draft[outcome[kind]] = 'none'
      suggested.push(kind)
    }
  }
  return {base,draft,suggested}
}
