import { getApp, getApps, initializeApp } from '@firebase/app';
import { getAuth, initializeAuth, inMemoryPersistence, RecaptchaVerifier, signInWithPhoneNumber } from '@firebase/auth';

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
    return confirmation.verificationId;
  } finally {
    try {
      verifier?.clear();
    } finally {
      widget.remove();
    }
  }
}
