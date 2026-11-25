import { dateKey, emptyDaily, pointsFor, type State, type User, type Student } from '../src/domain'
export function createState(user?: User, sample = false): State {
  const state: State = {
    sample, users: user ? [user] : [], circles: [], students: [], daily: [], closed: [], notices: [], links: [], prizes: [],
    orders: [], exams: [], leaves: [], chats: [], audit: [], operations: [], rules: { memorization: 4, review: 4, attendance: 2, chat: true }
  }
  if (!sample || !user) return state
  state.users.push({id:'demo-teacher',name:'عبدالرحمن آل سرحان',role:'teacher',status:'active'},{id:'demo-student',name:'عبدالله الشهري',role:'student',status:'active',studentId:'student-1'},{id:'demo-parent',name:'ولي أمر عبدالله',role:'parent',status:'active'})
  state.links.push({id:'demo-link',parentId:'demo-parent',studentId:'student-1',status:'accepted'})
  const id = 'circle-1'
  const date = dateKey()
  state.circles = [{ id, name: 'حلقة الإمام عاصم', teacherId: 'demo-teacher', days: [0,1,2,3,4], holidays: [] }]
  const names = [
    ['عبدالله الشهري','Abdullah Al-Shehri'], ['محمد القحطاني','Mohammed Al-Qahtani'], ['عمر الأسمري','Omar Al-Asmari'],
    ['يوسف الشهراني','Yousef Al-Shahrani'], ['أنس عسيري','Anas Asiri'], ['إبراهيم آل سرحان','Ibrahim Al-Sarhan'],
    ['زياد أحمد','Ziyad Ahmed'], ['خالد العمري','Khalid Al-Omari'], ['معاذ علي','Muadh Ali'], ['حسن محمد','Hassan Mohammed'],
    ['تركي مسفر','Turki Misfer'], ['سعد عبدالله','Saad Abdullah'],
  ]
  state.students = names.map(([name, latin], i): Student => ({ id: `student-${i+1}`, name, latin, circleId: id, color: i % 5, startingPoints: 40 + i * 7, active: true }))
  const modes = ['complete','partial','pending','absent','complete','complete','complete','complete','complete','complete','partial','pending']
  state.daily = state.students.flatMap((student, i) => {
    const mode = modes[i]
    if (mode === 'pending') return []
    const d = emptyDaily(student.id, date, state.circles[0])
    if (mode === 'absent') d.attendance = 'absent'
    else {
      d.attendance = 'present'
      if (mode === 'complete' || i === 10) {
        d.memorization = i === 0 ? [{surah:78,from:37,to:40},{surah:79,from:1,to:4}] : [{ surah: 78 + i % 3, from: 1, to: 8 }]
        d.memorizationStatus = 'complete'
      } else {
        d.memorization = [{surah: 78,from: 1,to: 6}]
        d.memorizationStatus = 'partial'
      }
      if (mode === 'complete') {
        d.review = [{ surah: 112, from: 1, to: 4 }]
        d.reviewStatus = 'complete'
        d.nextMemorization = [{surah: 79, from: 5, to: 12}]
        d.nextReview = [{surah: 113, from: 1, to: 5}]
      }
    }
    d.points = pointsFor(d, state.rules)
    return [d]
  })
  const now = new Date().toISOString()
  state.notices = [
    { id: 'notice-1', kind: 'daily', title: 'تم تسجيل تسميع عبدالله الشهري', en: 'Abdullah’s recitation was recorded', body: 'أضيفت 10 نقاط إلى رصيد الطالب.', bodyEn: '10 points were awarded.', time: now, readBy: [] },
    { id: 'notice-2', kind: 'exam', title: 'موعد اختبار الحلقة الأسبوعي', en: 'Weekly circle assessment', body: 'يمكنك متابعة الاختبارات من قائمة المزيد.', bodyEn: 'View assessments from the More menu.', time: now, readBy: [] },
  ]
  state.prizes = [
    { id: 'p1', name: 'مصحف فاخر', description: 'مصحف بحجم مناسب للحمل والمراجعة', price: 50, stock: 8, active: true },
    { id: 'p2', name: 'دفتر الإنجاز', description: 'دفتر لتدوين خطة الحفظ والمراجعة اليومية', price: 25, stock: 12, active: true },
    { id: 'p3', name: 'طقم الأقلام', description: 'أقلام وأدوات مكتبية مميزة', price: 35, stock: 5, active: true },
  ]
  state.chats = [{ id: 'chat-1', circleId:id, title: 'مجموعة حلقة الإمام عاصم', students: state.students.map(s => s.id), members: [user.id,'demo-teacher'], reports: [], pinnedBy:[], blockedBy:[], messages: [
    { id: 'm1', from: user.id, text: 'السلام عليكم ورحمة الله وبركاته، نلتقي اليوم في موعد الحلقة المعتاد بإذن الله.', time: now, readBy: [user.id] },
  ] }]
  return state
}
