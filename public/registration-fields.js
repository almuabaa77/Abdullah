import { cities } from './market.js';

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
  return location?.source !== 'manual' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= maxLocationAccuracy;
}

export function validRegistrationLocation(location) {
  if (preciseLocation(location)) return true;
  const { latitude, longitude, accuracy, source } = location || {};
  return source === 'manual' && accuracy === null
    && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function distanceMeters(origin, point) {
  const { latitude, longitude } = point || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLat = radians(latitude - origin.latitude);
  const deltaLng = radians(longitude - origin.longitude);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(latitude)) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(Math.min(1, h))));
}

export function nearestRegistrationCity(location) {
  if (!validRegistrationLocation(location)) return null;
  let nearest = null;
  for (const [key, { coordinates }] of Object.entries(cities)) {
    if (!coordinates) continue;
    const [latitude, longitude] = coordinates;
    const distance = distanceMeters(location, { latitude, longitude });
    if (distance <= 30_000 && (!nearest || distance < nearest.distance)) nearest = { key, distance };
  }
  return nearest;
}
