import type { FirebaseWebConfig } from '@/app/firebaseConfig';
import type { CloudSyncPort } from '@/domain/ports/SyncPort';
import type { SharePayload } from '@/domain/settings/share';
import type { SyncConfigDoc, SyncSecretsDoc } from '@/domain/sync/syncDocs';
import { fromSyncDocs, toSyncDocs } from '@/domain/sync/syncDocs';

/**
 * Espejo en Firestore de la configuración compartible.
 *
 * Documentos por usuario (ver `firestore.rules`):
 * - `users/{uid}/sync/config`  → proveedores (sin secretos) + ajustes mínimos.
 * - `users/{uid}/sync/secrets` → mapa `keyRef → secreto` en texto plano.
 *
 * El SDK de Firebase entra por imports dinámicos: sin sesión ni config no hay
 * coste en el bundle inicial. Los secretos viajan cifrados en tránsito (TLS) y
 * en reposo (Google), pero legibles desde la consola del proyecto: usar sólo
 * con cuentas propias (ver aviso en la UI).
 */
export function createFirestoreSync(config: FirebaseWebConfig): CloudSyncPort {
  return {
    async pull(): Promise<SharePayload | null> {
      const { db, uid } = await ensureSyncHandles(config);
      const { doc, getDoc } = await import('firebase/firestore');

      const configSnap = await getDoc(doc(db, syncConfigPath(uid)));
      if (!configSnap.exists()) return null;
      const configDoc = configSnap.data() as SyncConfigDoc;

      const secretsSnap = await getDoc(doc(db, syncSecretsPath(uid)));
      const secretsDoc: SyncSecretsDoc = secretsSnap.exists()
        ? (secretsSnap.data() as SyncSecretsDoc)
        : { version: 1, updatedAt: configDoc.updatedAt, keys: {} };

      const payload = fromSyncDocs(configDoc, secretsDoc);
      if (payload === null) throw new Error('La configuración guardada en la nube está corrupta.');
      return payload;
    },

    async push(payload: SharePayload): Promise<void> {
      const { db, uid } = await ensureSyncHandles(config);
      const { doc, setDoc } = await import('firebase/firestore');
      const docs = toSyncDocs(payload);
      await Promise.all([
        setDoc(doc(db, syncConfigPath(uid)), docs.config),
        setDoc(doc(db, syncSecretsPath(uid)), docs.secrets),
      ]);
    },
  };
}

/** Ruta del documento de config (sin secretos); espeja `firestore.rules`. */
export function syncConfigPath(uid: string): string {
  return `users/${uid}/sync/config`;
}

/** Ruta del documento de secretos; espeja `firestore.rules`. */
export function syncSecretsPath(uid: string): string {
  return `users/${uid}/sync/secrets`;
}

interface SyncHandles {
  db: import('firebase/firestore').Firestore;
  uid: string;
}

let cachedApp: import('firebase/app').FirebaseApp | null = null;

async function ensureSyncHandles(config: FirebaseWebConfig): Promise<SyncHandles> {
  const [{ getApp, getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);
  if (cachedApp === null) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp({ ...config });
  }
  const uid = getAuth(cachedApp).currentUser?.uid ?? null;
  if (uid === null) throw new Error('Sin sesión: iniciá sesión para sincronizar.');
  return { db: getFirestore(cachedApp), uid };
}
