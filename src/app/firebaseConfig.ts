/**
 * Configuración web de Firebase tomada del entorno de build (`VITE_FIREBASE_*`).
 * Si falta cualquier campo imprescindible, devuelve `null` y la app arranca sin
 * autenticación (modo local-first, como hoy).
 *
 * Nota: la config web de Firebase es pública por diseño (no es un secreto); lo
 * que protege los datos son las reglas del backend. Igual se mantiene en
 * `.env.local` (gitignoreado) para no fijarla en el repo.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

type EnvLike = Record<string, unknown>;

function readString(env: EnvLike, key: string): string | null {
  const value = env[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Lee y valida la config desde un objeto tipo `import.meta.env`. */
export function readFirebaseConfig(env: EnvLike = import.meta.env as unknown as EnvLike): FirebaseWebConfig | null {
  const apiKey = readString(env, 'VITE_FIREBASE_API_KEY');
  const authDomain = readString(env, 'VITE_FIREBASE_AUTH_DOMAIN');
  const projectId = readString(env, 'VITE_FIREBASE_PROJECT_ID');
  const appId = readString(env, 'VITE_FIREBASE_APP_ID');
  if (apiKey === null || authDomain === null || projectId === null || appId === null) return null;

  const storageBucket = readString(env, 'VITE_FIREBASE_STORAGE_BUCKET');
  const messagingSenderId = readString(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID');

  const config: FirebaseWebConfig = { apiKey, authDomain, projectId, appId };
  if (storageBucket !== null) config.storageBucket = storageBucket;
  if (messagingSenderId !== null) config.messagingSenderId = messagingSenderId;
  return config;
}
