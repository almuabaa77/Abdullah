import type { Notice, State, Student, User } from '../src/domain'

export function announcementVisible(notice:Notice,state:State,user:User,students:Student[]) {
  const item=notice.announcement
  if(!item||user.role==='admin')return true
  if(item.withdrawn||!item.publishedAt)return false
  if(item.audience==='all')return true
  if(item.audience==='parent')return user.role==='parent'&&user.id===item.targetId
  if(item.audience==='student')return user.role==='student'&&user.studentId===item.targetId&&students.some(s=>s.id===item.targetId)
  return students.some(s=>s.circleId===item.targetId)
    || user.role==='teacher'&&state.circles.some(c=>c.id===item.targetId&&c.teacherId===user.id)
}

export function publishScheduled(state:State,now=new Date().toISOString()) {
  const due=state.notices.filter(notice=>notice.announcement&&!notice.announcement.publishedAt&&!notice.announcement.withdrawn&&notice.announcement.publishAt<=now)
  for(const notice of due)notice.announcement!.publishedAt=now
  return due
}
