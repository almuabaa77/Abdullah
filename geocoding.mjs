function distanceMeters(origin, point) {
  const { latitude, longitude } = point || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLat = radians(latitude - origin.latitude);
  const deltaLng = radians(longitude - origin.longitude);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(latitude)) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(Math.min(1, h))));
}

async function nearestLandmark(key, position, language) {
  if (!key) return null;
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
  if (!response.ok) return null;
  const place = (await response.json()).places?.[0];
  const name = place?.displayName?.text;
  const distance = distanceMeters(position, place?.location);
  return typeof name === 'string' && name.trim() && distance !== null ? { name: name.trim().slice(0, 180), distance } : null;
}

export async function lookupAddress(key, position, language, placesKey) {
  const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  endpoint.searchParams.set('latlng', `${position.latitude.toFixed(6)},${position.longitude.toFixed(6)}`);
  endpoint.searchParams.set('language', language);
  endpoint.searchParams.set('region', 'sa');
  endpoint.searchParams.set('key', key);
  const nearby = nearestLandmark(placesKey, position, language).catch(() => null);
  const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Geocoding request failed');
  const result = await response.json();
  if (!['OK', 'ZERO_RESULTS'].includes(result.status)) throw new Error('Geocoding unavailable');
  const results = result.results || [];
  const addressTypes = ['street_address', 'premise', 'subpremise', 'route'];
  const match = results.find(address => addressTypes.some(type => address.types?.includes(type)));
  const components = (match || results[0])?.address_components || [];
  const component = type => components.find(item => item.types.includes(type))?.long_name || null;
  const display = match?.formatted_address?.trim();
  const coordinate = match?.geometry?.location;
  return {
    address: display?.length >= 10 ? display.slice(0, 240) : null,
    city: component('locality') || component('postal_town') || component('administrative_area_level_2'),
    street: component('route'),
    distance: distanceMeters(position, { latitude: coordinate?.lat, longitude: coordinate?.lng }),
    landmark: await nearby,
  };
}
