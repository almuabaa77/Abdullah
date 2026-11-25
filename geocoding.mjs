export async function lookupAddress(key, { latitude, longitude }, language) {
  const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  endpoint.searchParams.set('latlng', `${latitude.toFixed(6)},${longitude.toFixed(6)}`);
  endpoint.searchParams.set('language', language);
  endpoint.searchParams.set('region', 'sa');
  endpoint.searchParams.set('key', key);
  const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Geocoding request failed');
  const result = await response.json();
  if (result.status === 'ZERO_RESULTS') return null;
  if (result.status !== 'OK') throw new Error('Geocoding unavailable');
  const addressTypes = ['street_address', 'premise', 'subpremise', 'route'];
  const resultWithStreet = result.results?.find(address => addressTypes.some(type => address.types?.includes(type)));
  const address = resultWithStreet?.formatted_address;
  return typeof address === 'string' && address.trim().length >= 10 ? address.trim().slice(0, 240) : null;
}
