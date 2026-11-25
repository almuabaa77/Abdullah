import { distanceMeters } from './public/registration-fields.js';

async function nearestLandmark(key, position, language) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location',
    },
    body: JSON.stringify({
      locationRestriction: { circle: { center: { latitude: position.latitude, longitude: position.longitude }, radius: 1500 } },
      includedTypes: ['mosque', 'hospital', 'park', 'shopping_mall', 'school', 'tourist_attraction'],
      rankPreference: 'DISTANCE', maxResultCount: 1, languageCode: language,
    }),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const place = (await response.json()).places?.[0];
  const name = place?.displayName?.text;
  const distance = distanceMeters(position, place?.location);
  return typeof name === 'string' && name.trim() && distance !== null ? { name: name.trim().slice(0, 180), distance } : null;
}

async function reverseGeocode(key, position, language) {
  const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  endpoint.searchParams.set('latlng', `${position.latitude.toFixed(6)},${position.longitude.toFixed(6)}`);
  endpoint.searchParams.set('language', language);
  endpoint.searchParams.set('region', 'sa');
  endpoint.searchParams.set('key', key);
  const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const result = await response.json();
  if (!['OK', 'ZERO_RESULTS'].includes(result.status)) {
    const status = ['REQUEST_DENIED', 'OVER_DAILY_LIMIT', 'OVER_QUERY_LIMIT', 'INVALID_REQUEST', 'UNKNOWN_ERROR'].includes(result.status)
      ? result.status : 'INVALID_RESPONSE';
    throw new Error(status);
  }
  const results = result.results || [];
  const addressTypes = ['street_address', 'premise', 'subpremise', 'route'];
  const match = results.find(address => addressTypes.some(type => address.types?.includes(type)));
  const components = [...(match?.address_components || []), ...results.flatMap(item => item.address_components || [])];
  const component = type => components.find(item => item.types?.includes(type))?.long_name || null;
  const display = match?.formatted_address?.trim();
  const coordinate = match?.geometry?.location;
  return {
    address: display?.length >= 10 ? display.slice(0, 240) : null,
    city: component('locality') || component('postal_town'),
    street: component('route'),
    neighborhood: component('neighborhood') || component('sublocality_level_1'),
    distance: distanceMeters(position, { latitude: coordinate?.lat, longitude: coordinate?.lng }),
  };
}

export async function lookupAddress(key, position, language, placesKey) {
  const [address, landmark] = await Promise.allSettled([
    key ? reverseGeocode(key, position, language) : null,
    placesKey ? nearestLandmark(placesKey, position, language) : null,
  ]);
  for (const [provider, result] of [['Geocoding', address], ['Places', landmark]]) {
    if (result.status !== 'rejected') continue;
    const message = result.reason?.message || '';
    const safe = /^(HTTP \d{3}|REQUEST_DENIED|OVER_DAILY_LIMIT|OVER_QUERY_LIMIT|INVALID_REQUEST|UNKNOWN_ERROR|INVALID_RESPONSE)$/.test(message);
    console.warn('[waslah] Google ' + provider + ' lookup failed:', safe ? message : 'NETWORK_OR_RESPONSE_ERROR');
  }
  return {
    ...address.value,
    landmark: landmark.value || null,
    ...(address.status === 'rejected' ? { addressUnavailable: true } : {}),
    ...(landmark.status === 'rejected' ? { landmarkUnavailable: true } : {}),
  };
}
