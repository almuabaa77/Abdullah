export function asciiDigits(value:string) {
  return value.replace(/[٠-٩۰-۹]/g,ch=>String(ch.charCodeAt(0)-(ch<='٩'?0x660:0x6f0)))
}

export function normalizeMobile(value:string) {
  const clean=asciiDigits(value).replace(/[\s().\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069-]/g,'').replace(/^00/,'+')
  const saudi=clean.match(/^(?:\+?966)?0?(5\d{8})$/)
  const number=saudi?'+966'+saudi[1]:clean
  return /^\+[1-9]\d{7,14}$/.test(number)?number:null
}

export function groupAccountsByPhone<T extends { phone?:string }>(accounts: T[]) {
  const groups = new Map<string,T[]>()
  for (const account of accounts) {
    const phone = normalizeMobile(account.phone ?? '')
    if (!phone) continue
    const group = groups.get(phone)
    if (group) group.push(account)
    else groups.set(phone,[account])
  }
  return groups
}
