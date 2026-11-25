import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const allowedDomain = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
export function readFirebaseConfig(value) {
  if (!value) return null;
  try {
    const { apiKey, authDomain, projectId, appId } = JSON.parse(value);
    if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{20,150}$/.test(apiKey)
        || typeof authDomain !== 'string' || authDomain.length > 253 || !allowedDomain.test(authDomain)
        || typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
        || typeof appId !== 'string' || !/^1:\d+:web:[a-z0-9]+$/i.test(appId)) throw new Error();
    return { apiKey, authDomain: authDomain.toLowerCase(), projectId, appId };
  } catch {
    throw new Error('FIREBASE_WEB_CONFIG must contain a valid Firebase Web app configuration.');
  }
}

export function verifierFor(projectId) {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('The live Firebase sign-in integration requires the production Firebase Auth endpoint.');
  }
  const name = 'waslah:' + projectId;
  const app = getApps().find(item => item.name === name) || initializeApp({ projectId }, name);
  return token => getAuth(app).verifyIdToken(token);
}

export function verifiedPhone(claims, projectId, time = Date.now()) {
  const seconds = Math.floor(time / 1000);
  if (claims?.aud !== projectId || claims?.iss !== 'https://securetoken.google.com/' + projectId
      || claims.firebase?.sign_in_provider !== 'phone' || !Number.isInteger(claims.auth_time)
      || claims.auth_time < seconds - 600 || claims.auth_time > seconds + 30
      || typeof claims.phone_number !== 'string' || !/^\+[1-9]\d{7,14}$/.test(claims.phone_number)) return null;
  return claims.phone_number;
}

export async function exchangeFirebaseCode(config, sessionInfo, code, origin) {
  const endpoint = new URL('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber');
  endpoint.searchParams.set('key', config.apiKey);
  const headers = { 'Content-Type': 'application/json' };
  if (/^https:\/\/[a-z\d.-]+(?::\d+)?$/i.test(origin || '')) headers.Referer = origin + '/';
  const response = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify({ sessionInfo, code }),
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (response.ok && typeof result.idToken === 'string') return result.idToken;
  const message = result.error?.message?.split(' : ')[0];
  if (['INVALID_CODE', 'INVALID_SESSION_INFO', 'SESSION_EXPIRED', 'CODE_EXPIRED'].includes(message)) return null;
  throw new Error('Firebase phone code exchange failed.');
}
