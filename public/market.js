export const specialties = {
  passports: ['الجوازات والزيارات', 'Passports & visas'],
  chamber: ['الغرفة التجارية والتصديق', 'Chamber & attestation'],
  insurance: ['التأمين', 'Insurance'],
  translation: ['الترجمة', 'Translation'],
  general: ['خدمات عامة', 'General services'],
};

export const cities = {
  riyadh: { name: ['الرياض', 'Riyadh'], coordinates: [24.7136, 46.6753] },
  jeddah: { name: ['جدة', 'Jeddah'], coordinates: [21.4858, 39.1925] },
  makkah: { name: ['مكة', 'Makkah'], coordinates: [21.3891, 39.8579] },
  madinah: { name: ['المدينة المنورة', 'Madinah'], coordinates: [24.5247, 39.5692] },
  dammam: { name: ['الدمام', 'Dammam'], coordinates: [26.4207, 50.0888] },
  khobar: { name: ['الخبر', 'Al Khobar'], coordinates: [26.2172, 50.1971] },
  taif: { name: ['الطائف', 'Taif'], coordinates: [21.2703, 40.4158] },
  abha: { name: ['أبها', 'Abha'], coordinates: [18.2465, 42.5117] },
  tabuk: { name: ['تبوك', 'Tabuk'], coordinates: [28.3838, 36.5550] },
  buraydah: { name: ['بريدة', 'Buraydah'], coordinates: [26.3592, 43.9818] },
  hail: { name: ['حائل', 'Hail'], coordinates: [27.5114, 41.7208] },
  jazan: { name: ['جازان', 'Jazan'], coordinates: [16.8892, 42.5706] },
  najran: { name: ['نجران', 'Najran'], coordinates: [17.5656, 44.2289] },
  sakaka: { name: ['سكاكا', 'Sakaka'], coordinates: [29.9697, 40.2064] },
  arar: { name: ['عرعر', 'Arar'], coordinates: [30.9753, 41.0381] },
  other: { name: ['مدينة أخرى أو عن بُعد', 'Other city or remote'] },
};

export const serviceSpecialties = {
  'family-visit': 'passports', 'residency-renewal': 'passports', 'medical-insurance': 'insurance',
  'document-attestation': 'chamber', 'business-registration': 'chamber', 'document-translation': 'translation',
};
export function suggestedSpecialty(subject) {
  if (/زيار|جواز|تأشير|تاشير|إقام|اقام|visa|visit|passport|residen/i.test(subject)) return 'passports';
  if (/تأمين|تامين|insurance/i.test(subject)) return 'insurance';
  if (/ترجم|translat/i.test(subject)) return 'translation';
  if (/تصديق|غرفة|تجاري|chamber|attest|commercial/i.test(subject)) return 'chamber';
  return 'general';
}
export const activeLimit = 3;
