export type Role = 'teacher' | 'student' | 'parent' | 'admin'
export type Attendance = 'present' | 'absent' | 'leave' | 'excused' | 'pending'
export type Result = 'complete' | 'partial' | 'none'
export type DateKey = string
export type Segment = { surah: number; from: number; to: number }
export type User = { id: string; name: string; phone?: string; role: Role; status: 'active' | 'pending' | 'disabled'; studentId?: string; duplicateOf?: string }
export type Circle = { id: string; name: string; teacherId: string; days: number[]; holidays: string[] }
export type Student = { id: string; name: string; latin?: string; circleId: string; phone?: string; color: number; startingPoints: number; active: boolean }
export type Daily = {
  studentId: string; date: DateKey; memorization: Segment[]; review: Segment[]
  memorizationStatus: Result; reviewStatus: Result; nextMemorization: Segment[]; nextReview: Segment[]
  nextDate: string; attendance: Attendance; points: number; bonus: number; note: string
  version?: number; updatedAt?: string
}
export type RecordSection = 'memorization' | 'review' | 'nextMemorization' | 'nextReview' | 'attendance' | 'points' | 'note'
export type RecordEvent = { id: string; studentId: string; circleId: string; date: string; actorId: string; time: string; changes: RecordSection[] }
export type Notice = { id: string; kind: string; title: string; en?: string; body: string; bodyEn?: string; time: string; users?: string[]; studentId?: string; readBy: string[] }
export type Leave = { id: string; studentId: string; date: string; reason: string; status: 'pending' | 'accepted' | 'declined' }
export type Link = { id: string; parentId: string; studentId: string; status: 'pending' | 'accepted' | 'declined' }
export type Prize = { id: string; name: string; description: string; price: number; stock: number; image?: string; active: boolean }
export type Order = { id: string; studentId: string; prizeId: string; name: string; price: number; status: 'pending' | 'approved' | 'ready' | 'delivered' | 'cancelled'; date: string }
export type Exam = { id: string; name: string; date: string; place: string; scope: string; studentIds: string[]; results: Record<string, { score: number; feedback: string }> }
export type Audit = { time: string; actor: string; action: string; target?: string; before?: number; after?: number }
export type Chat = { id: string; circleId?: string; students: string[]; members: string[]; title: string; reports: string[]; pinnedBy: string[]; blockedBy: string[]; messages: Message[] }
export type Message = { id: string; from: string; text: string; time: string; reply?: string; readBy: string[] }
export type State = {
  sample: boolean; users: User[]; circles: Circle[]; students: Student[]; daily: Daily[]; closed: string[]
  notices: Notice[]; links: Link[]; prizes: Prize[]; orders: Order[]; exams: Exam[]; leaves: Leave[]
  rules: { memorization: number; review: number; attendance: number; chat: boolean }; chats: Chat[]; audit: Audit[]
  operations: string[]; closedAccounts?: string[]; recordEvents?: RecordEvent[]
}
export type View = Omit<State, 'operations' | 'closedAccounts' | 'users'> & { users: User[]; user: User | null; date: string; revision: number; phoneEnabled: boolean; accountAccess?: 'duplicate' | 'closure-pending' | 'closed' }

const names = 'الفاتحة البقرة آل_عمران النساء المائدة الأنعام الأعراف الأنفال التوبة يونس هود يوسف الرعد إبراهيم الحجر النحل الإسراء الكهف مريم طه الأنبياء الحج المؤمنون النور الفرقان الشعراء النمل القصص العنكبوت الروم لقمان السجدة الأحزاب سبأ فاطر يس الصافات ص الزمر غافر فصلت الشورى الزخرف الدخان الجاثية الأحقاف محمد الفتح الحجرات ق الذاريات الطور النجم القمر الرحمن الواقعة الحديد المجادلة الحشر الممتحنة الصف الجمعة المنافقون التغابن الطلاق التحريم الملك القلم الحاقة المعارج نوح الجن المزمل المدثر القيامة الإنسان المرسلات النبأ النازعات عبس التكوير الانفطار المطففين الانشقاق البروج الطارق الأعلى الغاشية الفجر البلد الشمس الليل الضحى الشرح التين العلق القدر البينة الزلزلة العاديات القارعة التكاثر العصر الهمزة الفيل قريش الماعون الكوثر الكافرون النصر المسد الإخلاص الفلق الناس'.split(' ')
const roman = 'Al-Fatihah Al-Baqarah Ali_Imran An-Nisa Al-Maidah Al-Anam Al-Araf Al-Anfal At-Tawbah Yunus Hud Yusuf Ar-Rad Ibrahim Al-Hijr An-Nahl Al-Isra Al-Kahf Maryam Ta-Ha Al-Anbiya Al-Hajj Al-Muminun An-Nur Al-Furqan Ash-Shuara An-Naml Al-Qasas Al-Ankabut Ar-Rum Luqman As-Sajdah Al-Ahzab Saba Fatir Ya-Sin As-Saffat Sad Az-Zumar Ghafir Fussilat Ash-Shura Az-Zukhruf Ad-Dukhan Al-Jathiyah Al-Ahqaf Muhammad Al-Fath Al-Hujurat Qaf Adh-Dhariyat At-Tur An-Najm Al-Qamar Ar-Rahman Al-Waqiah Al-Hadid Al-Mujadilah Al-Hashr Al-Mumtahanah As-Saff Al-Jumuah Al-Munafiqun At-Taghabun At-Talaq At-Tahrim Al-Mulk Al-Qalam Al-Haqqah Al-Maarij Nuh Al-Jinn Al-Muzzammil Al-Muddaththir Al-Qiyamah Al-Insan Al-Mursalat An-Naba An-Naziat Abasa At-Takwir Al-Infitar Al-Mutaffifin Al-Inshiqaq Al-Buruj At-Tariq Al-Ala Al-Ghashiyah Al-Fajr Al-Balad Ash-Shams Al-Layl Ad-Duha Ash-Sharh At-Tin Al-Alaq Al-Qadr Al-Bayyinah Az-Zalzalah Al-Adiyat Al-Qariah At-Takathur Al-Asr Al-Humazah Al-Fil Quraysh Al-Maun Al-Kawthar Al-Kafirun An-Nasr Al-Masad Al-Ikhlas Al-Falaq An-Nas'.split(' ')
const counts = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6]
export const surahs = names.map((name, i) => ({ id: i + 1, name: name.replace('_', ' '), en: roman[i].replace('_', ' '), count: counts[i] }))
export const verseCount = (segments: Segment[]) => segments.reduce((sum, item) => sum + item.to - item.from + 1, 0)
export const segmentLabel = (segments: Segment[], en = false) => segments.map(item => `${en ? surahs[item.surah - 1].en : surahs[item.surah - 1].name} ${item.from}–${item.to}`).join(en ? ', ' : '، ')
export function dateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(x => x.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function dayOffset(date: string, days: number) {
  const at = new Date(date + 'T12:00:00Z')
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
export function nextCircleDate(date: string, circle?: Circle) {
  for (let i = 1; i < 366; i++) {
    const next = dayOffset(date, i)
    if (circleMeets(next, circle)) return next
  }
  throw new Error('لا يوجد موعد قادم للحلقة')
}
export const circleMeets = (date: string, circle?: Circle) => (!circle || (circle.days.includes(new Date(date + 'T12:00:00Z').getUTCDay()) && !circle.holidays.includes(date)))
export function validateSegments(input: unknown) {
  if (!Array.isArray(input) || input.length > 114) throw new Error('تحقق من المقاطع المدخلة')
  const segments: Segment[] = []
  for (const raw of input) {
    const surah = Number(raw?.surah)
    const from = Number(raw?.from)
    const to = Number(raw?.to)
    if (![surah, from, to].every(Number.isInteger) || !surahs[surah - 1] || from < 1 || to < from || to > surahs[surah - 1].count) throw new Error('تحقق من السورة وأرقام الآيات')
    if (segments.some(x => x.surah === surah && from <= x.to && to >= x.from)) throw new Error('تتداخل بعض الآيات في المقاطع المدخلة')
    segments.push({ surah, from, to })
  }
  return segments
}
export function expandRange(start: Segment, end: Segment, descending: boolean) {
  const step = descending ? -1 : 1
  if ((end.surah - start.surah) * step < 0 || !surahs[start.surah - 1] || !surahs[end.surah - 1]) throw new Error('تحقق من ترتيب سورتي البداية والنهاية')
  const result: Segment[] = []
  for (let i = start.surah; ; i += step) {
    result.push({ surah: i, from: i === start.surah ? start.from : 1, to: i === end.surah ? end.to : surahs[i - 1].count })
    if (i === end.surah) break
  }
  return validateSegments(result)
}
export function suggestNext(segments: Segment[]) {
  const last = segments.at(-1)
  if (!last) return []
  const direction = segments.length > 1 && segments[0].surah > last.surah ? -1 : 1
  let surah = last.surah
  let from = last.to + 1
  if (from > surahs[surah - 1].count) { surah += direction; from = 1 }
  if (!surahs[surah - 1]) return []
  const remaining = Math.min(Math.max(verseCount(segments), 1), 10)
  const end = Math.min(surahs[surah - 1].count, from + remaining - 1)
  const result = [{ surah, from, to: end }]
  const extra = remaining - (end - from + 1)
  if (extra && surahs[surah + direction - 1]) result.push({ surah: surah + direction, from: 1, to: Math.min(extra, surahs[surah + direction - 1].count) })
  return result
}
export function emptyDaily(studentId: string, date: string, circle?: Circle): Daily {
  return { studentId, date, memorization: [], review: [], nextMemorization: [], nextReview: [],
    memorizationStatus: 'none', reviewStatus: 'none', nextDate: nextCircleDate(date, circle), attendance: 'pending', points: 0, bonus: 0, note: '' }
}
export function assignmentFor(records: Daily[], studentId: string, date: string) {
  return records.reduce<Daily|undefined>((latest,record) => {
    if (record.studentId!==studentId || record.date>=date || record.nextDate!==date || !(record.nextMemorization.length || record.nextReview.length)) return latest
    return !latest || record.date>latest.date ? record : latest
  },undefined)
}
export function sameSegments(a: Segment[], b: Segment[]) {
  return a.length===b.length && a.every((segment,index)=>segment.surah===b[index].surah && segment.from===b[index].from && segment.to===b[index].to)
}
export const pointsFor = (record: Daily, rules: State['rules']) => (record.memorizationStatus === 'complete' ? rules.memorization : 0) + (record.reviewStatus === 'complete' ? rules.review : 0) + (record.attendance === 'present' ? rules.attendance : 0) + record.bonus
export const balanceFor = (student: Student, state: Pick<State, 'daily' | 'orders'>) => student.startingPoints + state.daily.filter(x => x.studentId === student.id).reduce((sum, x) => sum + x.points, 0) - state.orders.filter(x => x.studentId === student.id && x.status !== 'cancelled').reduce((sum, x) => sum + x.price, 0)
export const statusFor = (d?: Daily) => {
  if (d?.attendance === 'absent') return 'absent'
  if (d?.attendance === 'leave' || d?.attendance === 'excused') return 'leave'
  if (d?.memorizationStatus === 'complete' && d.reviewStatus === 'complete' && d.attendance === 'present' && (d.nextMemorization.length || d.nextReview.length)) return 'complete'
  if (d && (d.attendance === 'present' || d.memorization.length || d.review.length)) return 'partial'
  return 'pending'
}
export const idFor = () => crypto.randomUUID()

export type RecitationStatus = 'complete' | 'awaiting' | 'partial' | 'absent' | 'leave'
export function recitationStatus(record?: Daily): RecitationStatus {
  if (record?.memorization.length && record.memorizationStatus === 'complete') return 'complete'
  if (record?.memorization.length && record.memorizationStatus === 'partial') return 'partial'
  if (record?.attendance === 'absent') return 'absent'
  if (record?.attendance === 'leave' || record?.attendance === 'excused') return 'leave'
  return 'awaiting'
}
export const isRecitationDue = (record?: Daily) => ['awaiting', 'partial'].includes(recitationStatus(record))
