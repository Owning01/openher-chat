import type { CloudSyncPort } from '@/domain/ports/SyncPort';
import type { SharePayload } from '@/domain/settings/share';

import type { SettingsStore } from './settingsStore';

export type CloudSyncOutcome = 'pulled' | 'pushed' | 'in-sync' | 'disabled' | 'error';

export interface AutoSyncHandle {
  /** Primera reconciliación (corre al iniciar; la UI la usa para el estado). */
  ready: Promise<CloudSyncOutcome>;
  /** Reconcilia ahora (p. ej. al activar el toggle). */
  syncNow(): Promise<CloudSyncOutcome>;
  /** Sube lo local sin mirar la nube (botón "Subir ahora"). */
  pushNow(): Promise<'pushed' | 'disabled' | 'error'>;
  stop(): void;
}

export interface AutoSyncOptions {
  /** Antirrebote de la subida automática (ms). En tests usar un valor chico. */
  debounceMs?: number;
}

/**
 * Reconcilia el store local con la nube (last-write-wins por timestamp):
 * - sync apagado o store sin cargar → `disabled` / `error` sin tocar la red
 *   (salvo el `pull`, que es el que revela si hay algo).
 * - nube vacía + local con proveedores → sube (`pushed`).
 * - nube con datos + local vacío o más viejo → aplica (`pulled`).
 * - mismo contenido → `in-sync` sin escribir.
 * - cualquier fallo de red o aplicación corrupta → `error`, local intacto.
 *
 * Nunca lanza: todo fallo se reporta como `error` (local-first).
 */
export async function synchronizeWithCloud(
  store: SettingsStore,
  cloud: CloudSyncPort,
): Promise<CloudSyncOutcome> {
  const state = store.getState();
  if (state.settings.ui.cloudSync !== true) return 'disabled';
  if (!state.ready) return 'error';

  let remote: SharePayload | null;
  try {
    remote = await cloud.pull();
  } catch {
    return 'error';
  }

  let local: SharePayload;
  try {
    local = await state.exportShareConfig();
  } catch {
    return 'error';
  }

  if (remote === null) {
    if (local.providers.length === 0) return 'in-sync';
    try {
      await cloud.push(local);
      return 'pushed';
    } catch {
      return 'error';
    }
  }

  if (sharedSnapshot(local) === sharedSnapshot(remote)) return 'in-sync';

  if (local.providers.length === 0 || remote.exportedAt > state.settings.updatedAt) {
    const result = await state.applyShareConfig(remote);
    return result.added + result.reused + result.keysSet > 0 ? 'pulled' : 'error';
  }

  try {
    await cloud.push(local);
    return 'pushed';
  } catch {
    return 'error';
  }
}

/**
 * Sincronización continua para la página de Ajustes: corre una reconciliación
 * inicial y después sube (con antirrebote) cada cambio del store cuyo contenido
 * compartible difiera del último sincronizado. La comparación por contenido
 * evita el ping-pong pull→push sin banderas de supresión.
 */
export function startCloudAutoSync(
  store: SettingsStore,
  cloud: CloudSyncPort,
  options: AutoSyncOptions = {},
): AutoSyncHandle {
  const debounceMs = options.debounceMs ?? 2000;
  let stopped = false;
  let primed = false;
  let syncing = false;
  let baseline: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const readLocal = async (): Promise<SharePayload | null> => {
    try {
      return await store.getState().exportShareConfig();
    } catch {
      return null;
    }
  };

  const pushIfChanged = async (): Promise<void> => {
    if (stopped || syncing || !primed) return;
    const state = store.getState();
    if (!state.ready || state.settings.ui.cloudSync !== true) return;
    const local = await readLocal();
    if (local === null || stopped) return;
    const snapshot = sharedSnapshot(local);
    if (snapshot === baseline) return;
    syncing = true;
    try {
      await cloud.push(local);
      baseline = snapshot;
    } catch {
      // Local-first: se reintenta en el próximo cambio.
    } finally {
      syncing = false;
    }
  };

  const schedule = (): void => {
    if (stopped || !primed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void pushIfChanged();
    }, debounceMs);
  };

  const syncNow = async (): Promise<CloudSyncOutcome> => {
    if (stopped) return 'error';
    const outcome = await synchronizeWithCloud(store, cloud);
    const local = await readLocal();
    if (local !== null) baseline = sharedSnapshot(local);
    primed = true;
    return outcome;
  };

  const pushNow = async (): Promise<'pushed' | 'disabled' | 'error'> => {
    if (stopped) return 'error';
    const state = store.getState();
    if (!state.ready || state.settings.ui.cloudSync !== true) return 'disabled';
    const local = await readLocal();
    if (local === null) return 'error';
    try {
      await cloud.push(local);
      baseline = sharedSnapshot(local);
      primed = true;
      return 'pushed';
    } catch {
      return 'error';
    }
  };

  const unsubscribe = store.subscribe(() => schedule());
  const ready = syncNow();

  return {
    ready,
    syncNow,
    pushNow,
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe();
    },
  };
}

/** Contenido compartible sin `exportedAt`: lo que viaja, sin el sello de tiempo. */
function sharedSnapshot(payload: SharePayload): string {
  return JSON.stringify({ providers: payload.providers, settings: payload.settings });
}
