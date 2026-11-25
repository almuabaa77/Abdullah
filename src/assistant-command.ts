import { asciiDigits } from './phone-number'
import { surahs, validateSegments, type Daily, type Segment, type Student } from './domain'

export type Intent = 'recite' | 'attendance' | 'schedule' | 'points' | 'review' | 'remaining' | 'report'

function normalize(value:string) {
  return asciiDigits(value).normalize('NFKC').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064b-\u065f\u0640]/g,'').trim()
}
const escape = (value:string) => value.replace(/[.*+?^$${}()|[\]\\]/g,'\\$&')
const chapterAliases = surahs.flatMap(s=>[[normalize(s.name),s.id],[normalize(s.en),s.id],[normalize(s.en).replace(/-/g,' '),s.id]] as const)
  .sort((a,b)=>b[0].length-a[0].length)
const chaptersByAlias = new Map(chapterAliases)
const chapterExpression = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:و)?(${[...chaptersByAlias.keys()].map(escape).join('|')})(?![\\p{L}\\p{N}])`,'gu')
const verseRange = /(?:من|from)?\s*(?:الاية|اية|verse)?\s*(\d+)\s*(?:الي|to|[-–])\s*(?:الاية|اية|verse)?\s*(\d+)/
function parseSegments(command:string) {
  const mentions = [...command.matchAll(chapterExpression)]
  const result:Segment[] = []
  for (const [index,match] of mentions.entries()) {
    const text = command.slice(match.index+match[0].length,mentions[index+1]?.index)
    const range = text.match(verseRange)
    if (range) result.push({surah:chaptersByAlias.get(match[1])!,from:Number(range[1]),to:Number(range[2])})
    else {
      const single = text.match(/^\s*(?:الاية|اية|verse)\s*(\d+)/)
      if (single) result.push({surah:chaptersByAlias.get(match[1])!,from:Number(single[1]),to:Number(single[1])})
    }
  }
  return validateSegments(result)
}
export function parseCommand(text:string,students:Student[]):{intent?:Intent;student?:Student;preset:Partial<Daily>} {
  const n = normalize(text)
  const words = n.split(/[^\p{L}\p{N}]+/u)
  const active = students.filter(s=>s.active)
  const names = (s:Student) => [normalize(s.name),normalize(s.latin||'')].filter(Boolean)
  const full = active.filter(s=>names(s).some(name=>n.includes(name)))
  const first = active.filter(s=>names(s).some(name=>words.includes(name.split(' ')[0])))
  const student = full.length===1 ? full[0] : !full.length&&first.length===1 ? first[0] : undefined
  const intent:Intent|undefined = /متبق|لم يسمع|غير مكتمل|remaining|incomplete/.test(n)?'remaining'
    : /تقرير|report/.test(n)?'report'
    : /جدول|موعد|schedule|assign/.test(n)?'schedule'
    : /حضور|غاب|غياب|غائب|حاضر|مستاذن|attendance|absent|present|leave/.test(n)?'attendance'
    : /نقاط|نقط|points/.test(n)?'points'
    : /مراجع|revision|review/.test(n)?'review'
    : /تسميع|حفظ|سمع|recit|memoriz/.test(n)?'recite':undefined
  const preset:Partial<Daily> = {}
  if (intent==='attendance') {
    if (/بعذر|excused/.test(n)) preset.attendance='excused'
    else if (/مستاذن|leave/.test(n)) preset.attendance='leave'
    else if (/غائب|غاب|غياب|absent/.test(n)) preset.attendance='absent'
    else if (/حاضر|حضور|present/.test(n)) preset.attendance='present'
  }
  if (intent==='points') {
    const number = n.match(/-?\d+/)?.[0]
    if (number) preset.bonus=/خصم|subtract|deduct/.test(n)?-Math.abs(Number(number)):Number(number)
  }
  if (intent==='recite'||intent==='review'||intent==='schedule') {
    const segments = parseSegments(n)
    if (segments.length) {
      const status = /جزئي|partial/.test(n)?'partial':'complete'
      if (intent==='recite') Object.assign(preset,{memorization:segments,memorizationStatus:status})
      if (intent==='review') Object.assign(preset,{review:segments,reviewStatus:status})
      if (intent==='schedule') Object.assign(preset,/مراجع|review|revision/.test(n)?{nextReview:segments}:{nextMemorization:segments})
    }
  }
  return {intent,student,preset}
}
