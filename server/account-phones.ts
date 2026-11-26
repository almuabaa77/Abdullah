import type { State, User } from '../src/domain'
import { normalizeMobile } from '../src/phone-number'

export function hasSharedPhone(a: User, b: User) {
  const phone = normalizeMobile(a.phone ?? '')
  return a.id !== b.id && phone !== null && phone === normalizeMobile(b.phone ?? '')
}

export function retainedAccount(state: State, duplicate: User) {
  return state.users.find(account => account.id === duplicate.duplicateOf && !account.duplicateOf && hasSharedPhone(duplicate,account))
}

export async function accountFingerprint(uid: string) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('halaqat:closed-account:' + uid))
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')
}

export function removeDuplicateAccount(state: State, id: string) {
  state.users = state.users.filter(user=>user.id!==id)
  state.links = state.links.filter(link=>link.parentId!==id)
  state.operations = state.operations.filter(op=>!op.startsWith(id+':'))
  for (const circle of state.circles) if (circle.teacherId===id) circle.teacherId = ''
  for (const notice of state.notices) {
    notice.users = notice.users?.filter(user=>user!==id)
    notice.readBy = notice.readBy.filter(user=>user!==id)
  }
  for (const chat of state.chats) {
    chat.members = chat.members.filter(user=>user!==id)
    chat.pinnedBy = chat.pinnedBy.filter(user=>user!==id)
    chat.blockedBy = chat.blockedBy.filter(user=>user!==id)
    chat.reports = chat.reports.filter(user=>user!==id)
    chat.messages = chat.messages.filter(message=>message.from!==id)
    for (const message of chat.messages) message.readBy = message.readBy.filter(user=>user!==id)
  }
}
