import { asciiDigits } from './phone-number'
import { expandRange, surahs, validateSegments, type Daily, type Segment, type Student } from './domain'

export type Intent = 'recite' | 'attendance' | 'schedule' | 'points' | 'review' | 'remaining' | 'report'

function normalize(value:string) {
  return asciiDigits(value).normalize('NFKC').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064b-\u065f\u0640]/g,'').trim()
}
const escape = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
const chapterAliases = surahs.flatMap(s=>[[normalize(s.name),s.id],[normalize(s.en),s.id],[normalize(s.en).replace(/-/g,' '),s.id]] as const)
  .sort((a,b)=>b[0].length-a[0].length)
const chaptersByAlias = new Map(chapterAliases)
const chapterExpression = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:و)?(${[...chaptersByAlias.keys()].map(escape).join('|')})(?![\\p{L}\\p{N}])`,'gu')
const verseRange = /(?:من|from)?\s*(?:الاية|اية|verse)?\s*(\d+)\s*(?:الي|حتي|to|[-–])\s*(?:الاية|اية|verse)?\s*(\d+)/
const firstVerse = /^\s*(?:من|from)?\s*(?:الاية|اية|verse)?\s*(\d+)\b/
const crossChapter = /^\s*(?:من|from)?\s*(?:الاية|اية|verse)?\s*(\d+)\s*(?:الي|حتي|to)\s*(?:سورة|surah)?\s*$/

function parseSegments(command:string) {
  const mentions = [...command.matchAll(chapterExpression)]
  const result:Segment[] = []
  const partAfter = (index:number) => command.slice(mentions[index].index+mentions[index][0].length,mentions[index+1]?.index)
  for (let index=0;index<mentions.length;index++) {
    const surah=chaptersByAlias.get(mentions[index][1])!
    const text=partAfter(index)
    const cross=text.match(crossChapter)
    if(cross&&mentions[index+1]) {
      const end=partAfter(index+1).match(firstVerse)
      if(end) {
        const first=Number(cross[1]), last=Number(end[1])
        const endSurah=chaptersByAlias.get(mentions[index+1][1])!
        result.push(...expandRange({surah,from:first,to:first},{surah:endSurah,from:last,to:last},false))
        index++
        continue
      }
    }
    const range=text.match(verseRange)
    const start=range??text.match(firstVerse)
    if(start)result.push({surah,from:Number(start[1]),to:Number(range?.[2]??start[1])})
  }
  return validateSegments(result)
}

const phases=/(?<!\p{L})و?(المراجعة|مراجعة|راجع|review|revision|الحفظ|حفظ|تسميع|حفظه|recitation|recite|memorization|memorize)(?!\p{L})/gu
function splitRecitation(command:string,defaultPhase:'memorization'|'review') {
  const marks=[...command.matchAll(phases)]
  if(!marks.length)return [{kind:defaultPhase,text:command}]
  return marks.map((mark,index)=>({
    kind:/راجع|مراجع|review|revision/.test(mark[1])?'review' as const:'memorization' as const,
    text:command.slice(mark.index+mark[0].length,marks[index+1]?.index),
  }))
}

export function parseCommand(text:string,students:Student[],previousStudent?:Student):{intent?:Intent;student?:Student;candidates?:Student[];preset:Partial<Daily>} {
  const n = normalize(text)
  const words = n.split(/[^\p{L}\p{N}]+/u)
  const active = students.filter(s=>s.active)
  const names = (s:Student) => [normalize(s.name),normalize(s.latin||'')].filter(Boolean)
  const full = active.flatMap(student=>{
    const length=Math.max(0,...names(student).filter(name=>new RegExp(`(?:^|[^\\p{L}])${escape(name)}(?!\\p{L})`,'u').test(n)).map(name=>name.length))
    return length?[{student,length}]:[]
  })
  const longest=Math.max(0,...full.map(match=>match.length))
  const candidates=longest?full.filter(match=>match.length===longest).map(match=>match.student)
    :active.filter(student=>names(student).some(name=>words.includes(name.split(' ')[0])))
  const refersBack = words.some(word=>['له','لها','نفسه','نفسها','نفس','him','her','same'].includes(word))
  const student=candidates.length===1?candidates[0]:!candidates.length&&refersBack?active.find(item=>item.id===previousStudent?.id):undefined
  const intent:Intent|undefined = /متبق|تبقي|لم يسمع|غير مكتمل|remaining|incomplete/.test(n)?'remaining'
    : /تقرير|report/.test(n)?'report'
    : /جدول|موعد|schedule|assign/.test(n)?'schedule'
    : /مراجع|راجع|revision|review/.test(n)&&!/تسميع|حفظ|recit|memoriz/.test(n)?'review'
    : /تسميع|حفظ|سمع|recit|memoriz/.test(n)?'recite'
    : /حضور|حضر|غاب|غياب|غائب|حاضر|مستاذن|استاذن|attendance|absent|present|leave/.test(n)?'attendance'
    : /نقاط|نقط|points/.test(n)?'points':undefined
  const preset:Partial<Daily> = {}
  if(intent==='attendance') {
    if(/بعذر|excused/.test(n))preset.attendance='excused'
    else if(/مستاذن|استاذن|leave/.test(n))preset.attendance='leave'
    else if(/غائب|غاب|غياب|absent/.test(n))preset.attendance='absent'
    else preset.attendance='present'
  }
  if(intent==='points') {
    const number=n.match(/-?\d+/)?.[0]
    if(number)preset.bonus=/خصم|subtract|deduct/.test(n)?-Math.abs(Number(number)):Number(number)
  }
  if(intent==='recite'||intent==='review'||intent==='schedule') {
    const parts=splitRecitation(n,intent==='review'?'review':'memorization')
    for(const kind of ['memorization','review'] as const) {
      const clauses=parts.filter(part=>part.kind===kind)
      const segments=validateSegments(clauses.flatMap(part=>parseSegments(part.text)))
      if(!segments.length)continue
      if(intent==='schedule') {
        if(kind==='review')preset.nextReview=segments
        else preset.nextMemorization=segments
      } else {
        preset[kind]=segments
        preset[kind==='review'?'reviewStatus':'memorizationStatus']=clauses.some(part=>/جزئي|partial/.test(part.text))?'partial':'complete'
      }
    }
  }
  return {intent,student,preset,candidates:candidates.length>1?candidates:undefined}
}
