import { getApp, getApps, initializeApp } from '@firebase/app';
import { getAuth, initializeAuth, inMemoryPersistence, RecaptchaVerifier, signInWithPhoneNumber, signOut } from '@firebase/auth';

export async function requestFirebaseCode(config, phone, lang, container, { visible = false } = {}) {
  const name = 'waslah-phone';
  const auth = getApps().some(item => item.name === name)
    ? getAuth(getApp(name))
    : initializeAuth(initializeApp(config, name), { persistence: inMemoryPersistence });
  auth.languageCode = lang;
  const widget = container.ownerDocument.createElement('div');
  container.appendChild(widget);
  let verifier;
  try {
    verifier = new RecaptchaVerifier(auth, widget, { size: visible ? 'compact' : 'invisible' });
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
    try {
      verifier?.clear();
    } finally {
      widget.remove();
    }
  }
}
