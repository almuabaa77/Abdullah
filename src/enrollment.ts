export function threePartName(value:unknown) {
  if(typeof value!=='string')return null
  const name=value.normalize('NFC').trim().replace(/\s+/g,' ')
  return name.length<=90 && !name.includes('ـ') && /^(?:\p{L}[\p{L}\p{M}]* ){2}\p{L}[\p{L}\p{M}]*$/u.test(name) ? name : null
}

export function enrollmentNameKey(name:string) {
  return name.normalize('NFC').toLowerCase().replace(/\p{M}/gu,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').trim().replace(/\s+/g,' ')
}
