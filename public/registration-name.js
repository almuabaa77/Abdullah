const word = /^(?:(?=\p{L})[\p{Script=Arabic}\p{Script=Latin}]\p{M}*){2,30}$/u;

export function registrationName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim().replace(/ +/g, ' ');
  const words = name.split(' ');
  if (name.length > 72 || words.length !== 3 || !words.every(part => word.test(part))) return null;
  const letters = words.map(part => part.toLowerCase().replace(/\p{M}/gu, ''));
  if (new Set(letters).size < 2 || letters.some(part => /(.)\1{3}/u.test(part))) return null;
  return name;
}
