export function asciiDigits(value:string) {
  return value.replace(/[٠-٩۰-۹]/g,ch=>String(ch.charCodeAt(0)-(ch<='٩'?0x660:0x6f0)))
}

export function normalizeMobile(value:string) {
  const clean=asciiDigits(value).trim().replace(/[\s().-]/g,'').replace(/^00/,'+')
  const number=/^05\d{8}$/.test(clean)?'+966'+clean.slice(1):/^5\d{8}$/.test(clean)?'+966'+clean:/^9665\d{8}$/.test(clean)?'+'+clean:clean
  return /^\+[1-9]\d{7,14}$/.test(number)?number:null
}
