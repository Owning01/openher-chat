/** Identidad mínima que la app necesita del proveedor de autenticación. */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
}

/** Errores de autenticación normalizados (independientes del proveedor). */
export type AuthErrorCode =
  | 'invalid-credential'
  | 'invalid-email'
  | 'user-disabled'
  | 'user-not-found'
  | 'wrong-password'
  | 'email-already-in-use'
  | 'weak-password'
  | 'too-many-requests'
  | 'operation-not-allowed'
  | 'unauthorized-domain'
  | 'popup-closed'
  | 'popup-blocked'
  | 'network'
  | 'unknown';

/** Error de autenticación normalizado que lanzan los adaptadores. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Puerto de autenticación. Es opcional en `AppServices`: si la app no está
 * configurada con un backend de auth, el servicio no existe y no hay puerta de
 * login (la app sigue siendo local-first).
 */
export interface AuthPort {
  /** Usuario actual o `null` si la sesión no está iniciada (aún). */
  currentUser(): AuthUser | null;
  /** Notifica el estado inicial y cada cambio de sesión; devuelve el unsubscribe. */
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  signUpWithEmail(email: string, password: string): Promise<AuthUser>;
  /** Google: disponible en web; en nativo requiere un plugin nativo (ver docs/firebase.md). */
  signInWithGoogle(): Promise<AuthUser>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}
