import { getApp, getApps, initializeApp } from '@firebase/app';
import { getAuth, initializeAuth, inMemoryPersistence, RecaptchaVerifier, signInWithPhoneNumber, signOut } from '@firebase/auth';

export async function requestFirebaseCode(config, phone, lang, container) {
  const name = 'waslah-phone';
  const auth = getApps().some(item => item.name === name)
    ? getAuth(getApp(name))
    : initializeAuth(initializeApp(config, name), { persistence: inMemoryPersistence });
  auth.languageCode = lang;
  const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
  try {
    const confirmation = await signInWithPhoneNumber(auth, phone, verifier);
    return async code => {
      const result = await confirmation.confirm(code);
      try {
        return await result.user.getIdToken();
      } finally {
        await signOut(auth).catch(() => {});
      }
    };
  } finally {
    verifier.clear();
  }
}
