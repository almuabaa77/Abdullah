export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) % 16))
    .replace(/[\s()-]/g, '');
  if (/^0?5\d{8}$/.test(digits)) return '+966' + digits.slice(-9);
  if (/^(\+|00)?9665\d{8}$/.test(digits)) return '+' + digits.slice(-12);
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
