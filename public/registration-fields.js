export const maxLocationAccuracy = 50;

export function validNationalId(value) {
  if (typeof value !== 'string' || !/^[12]\d{9}$/.test(value)) return false;
  const checksum = [...value].reduce((sum, digit, index) => {
    const weighted = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return sum + (weighted > 9 ? weighted - 9 : weighted);
  }, 0);
  return checksum % 10 === 0;
}

export function preciseLocation(location) {
  const { latitude, longitude, accuracy } = location || {};
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= maxLocationAccuracy;
}
