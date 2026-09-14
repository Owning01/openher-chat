import type { AuthErrorCode } from '@/domain/ports/AuthPort';

/**
 * Traduce los códigos de error del SDK de Firebase a nuestro vocabulario.
 * Es puro a propósito: el resto de la app nunca ve strings de Firebase.
 */
const CODE_MAP: Readonly<Record<string, AuthErrorCode>> = {
  'auth/invalid-credential': 'invalid-credential',
  'auth/invalid-login-credentials': 'invalid-credential',
  'auth/wrong-password': 'wrong-password',
  'auth/user-not-found': 'user-not-found',
  'auth/invalid-email': 'invalid-email',
  'auth/user-disabled': 'user-disabled',
  'auth/email-already-in-use': 'email-already-in-use',
  'auth/weak-password': 'weak-password',
  'auth/too-many-requests': 'too-many-requests',
  'auth/operation-not-allowed': 'operation-not-allowed',
  'auth/admin-restricted-operation': 'operation-not-allowed',
  'auth/unauthorized-domain': 'unauthorized-domain',
  'auth/popup-closed-by-user': 'popup-closed',
  'auth/cancelled-popup-request': 'popup-closed',
  'auth/popup-blocked': 'popup-blocked',
  'auth/network-request-failed': 'network',
};

function readCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function toAuthErrorCode(error: unknown): AuthErrorCode {
  const code = readCode(error);
  if (code === null) return 'unknown';
  return CODE_MAP[code] ?? 'unknown';
}

/** Mensaje técnico corto (para diagnóstico); la UI usa las claves i18n. */
export function toAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return readCode(error) ?? 'unknown auth error';
}
