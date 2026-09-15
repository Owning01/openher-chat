import type { SharePayload } from '@/domain/settings/share';

/**
 * Espejo en la nube de la configuración compartible (Firestore). La app lo
 * usa solo con sesión iniciada y `ui.cloudSync`; todo fallo es silencioso
 * (local-first: la nube nunca rompe el uso local).
 */
export interface CloudSyncPort {
  /** Baja el paquete (`null` = la nube está vacía para este usuario). */
  pull(): Promise<SharePayload | null>;
  /** Sube el paquete actual. */
  push(payload: SharePayload): Promise<void>;
}
