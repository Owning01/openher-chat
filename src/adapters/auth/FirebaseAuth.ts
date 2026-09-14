import { Capacitor } from '@capacitor/core';

import type { FirebaseWebConfig } from '@/app/firebaseConfig';
import { AuthError } from '@/domain/ports/AuthPort';
import type { AuthPort, AuthUser } from '@/domain/ports/AuthPort';

import { toAuthErrorCode, toAuthErrorMessage } from './firebaseErrors';

/** El SDK vive detrás de imports dinámicos: no entra al bundle si no hay auth. */
interface AuthHandles {
  auth: import('firebase/auth').Auth;
  authModule: typeof import('firebase/auth');
}

interface SdkUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface FirebaseAuthOptions {
  /** Fuerza el modo nativo (tests); por defecto lo detecta Capacitor. */
  isNative?: boolean;
}

const GOOGLE_NATIVE_MESSAGE =
  'Iniciar sesión con Google en Android/iOS requiere un plugin nativo; usá correo y contraseña.';

function mapUser(user: SdkUser | null): AuthUser | null {
  if (user === null) return null;
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoUrl: user.photoURL ?? null,
  };
}

async function initialize(config: FirebaseWebConfig): Promise<AuthHandles> {
  const [appModule, authModule] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = appModule.getApps().length > 0 ? appModule.getApp() : appModule.initializeApp(config);
  const auth = authModule.getAuth(app);
  try {
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);
  } catch {
    // Persistencia por defecto del entorno: la sesión igual se recupera.
  }
  try {
    // Resuelve el retorno de un redirect pendiente (web/nativo).
    await authModule.getRedirectResult(auth);
  } catch {
    // Sin redirect pendiente.
  }
  return { auth, authModule };
}

/**
 * Adaptador de Firebase Auth. `AppServices.auth` sólo existe cuando hay config,
 * así que la ausencia de servicio ya significa "auth deshabilitada".
 */
export function createFirebaseAuth(config: FirebaseWebConfig, options: FirebaseAuthOptions = {}): AuthPort {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  let handles: Promise<AuthHandles> | null = null;
  let current: AuthUser | null = null;

  const ensure = (): Promise<AuthHandles> => {
    handles ??= initialize(config);
    return handles;
  };

  const run = async (operation: (handles: AuthHandles) => Promise<SdkUser | null>): Promise<AuthUser> => {
    try {
      const resolved = await ensure();
      const user = mapUser(await operation(resolved));
      if (user === null) throw new AuthError('unknown', 'auth operation returned no user');
      current = user;
      return user;
    } catch (cause) {
      if (cause instanceof AuthError) throw cause;
      throw new AuthError(toAuthErrorCode(cause), toAuthErrorMessage(cause));
    }
  };

  return {
    currentUser: () => current,

    subscribe(listener) {
      let cancelled = false;
      let unsubscribe: () => void = () => undefined;
      void ensure()
        .then(({ auth, authModule }) => {
          if (cancelled) return;
          unsubscribe = authModule.onAuthStateChanged(auth, (user) => {
            current = mapUser(user);
            listener(current);
          });
        })
        .catch(() => {
          if (!cancelled) listener(null);
        });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    },

    signInWithEmail(email, password) {
      return run(async ({ auth, authModule }) => (await authModule.signInWithEmailAndPassword(auth, email, password)).user);
    },

    signUpWithEmail(email, password) {
      return run(async ({ auth, authModule }) => (await authModule.createUserWithEmailAndPassword(auth, email, password)).user);
    },

    async signInWithGoogle() {
      // En WebView el popup/redirect de Google no vuelve a la app sin un plugin nativo.
      if (isNative) throw new AuthError('operation-not-allowed', GOOGLE_NATIVE_MESSAGE);
      return run(async ({ auth, authModule }) => {
        const provider = new authModule.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return (await authModule.signInWithPopup(auth, provider)).user;
      });
    },

    async sendPasswordReset(email) {
      try {
        const { auth, authModule } = await ensure();
        await authModule.sendPasswordResetEmail(auth, email);
      } catch (cause) {
        if (cause instanceof AuthError) throw cause;
        throw new AuthError(toAuthErrorCode(cause), toAuthErrorMessage(cause));
      }
    },

    async signOut() {
      try {
        const { auth, authModule } = await ensure();
        await authModule.signOut(auth);
        current = null;
      } catch (cause) {
        if (cause instanceof AuthError) throw cause;
        throw new AuthError(toAuthErrorCode(cause), toAuthErrorMessage(cause));
      }
    },
  };
}
