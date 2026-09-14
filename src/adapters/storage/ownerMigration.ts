import { deleteDB, openDB } from 'idb';
import type { StoreNames } from 'idb';
import {
  CONVERSATIONS_STORE,
  DB_NAME,
  DB_OPEN_CALLBACKS,
  DB_VERSION,
  LEGAL_STORES,
  MESSAGES_STORE,
  ownerDbName,
} from './idb';
import type { OpenHerDb, OpenHerDbSchema } from './idb';
import { KEY_STORAGE_PREFIX, keyStorageKey } from './LocalKeyVault';
import { SETTINGS_STORAGE_KEY, settingsStorageKey } from './LocalSettingsRepository';

/** Prefijo del marcador de idempotencia en localStorage (`<prefijo><ownerId>` = `'1'`). */
export const MIGRATION_MARKER_PREFIX = 'openher.migrated.v1:';

/** Clave del marcador que indica que el owner ya migró el storage legacy. */
export function migrationMarkerKey(ownerId: string): string {
  return `${MIGRATION_MARKER_PREFIX}${ownerId}`;
}

export interface OwnerMigrationReport {
  alreadyMigrated: boolean;
  settings: 'copied' | 'skipped';
  keysCopied: number;
  idbCopied: Record<string, number>;
  legacyCleaned: boolean;
}

type MigratedStore = StoreNames<OpenHerDbSchema>;

/** Stores alcanzados por la migración: conversaciones, mensajes y modo legal. */
const MIGRATED_STORES: ReadonlyArray<MigratedStore> = [
  CONVERSATIONS_STORE,
  MESSAGES_STORE,
  ...LEGAL_STORES,
];

/**
 * Copia una sola vez el storage legacy global (settings, API keys e IndexedDB)
 * al namespace del owner indicado. Idempotente vía marcador en localStorage.
 * Copia sólo lo ausente en destino (nunca pisa) y limpia el legacy únicamente
 * cuando todo lo copiable se verificó por conteo (fail-closed: ante cualquier
 * fallo los originales quedan intactos y `legacyCleaned` es `false`).
 * Nunca lanza: los fallos se reportan en el resultado.
 */
export async function migrateLegacyStorageToOwner(ownerId: string): Promise<OwnerMigrationReport> {
  const report: OwnerMigrationReport = {
    alreadyMigrated: false,
    settings: 'skipped',
    keysCopied: 0,
    idbCopied: emptyIdbCopied(),
    legacyCleaned: false,
  };
  try {
    // Sin owner válido no hay namespace destino: migrar sería copiar el legacy
    // sobre sí mismo y luego borrarlo. Se reporta sin tocar nada.
    if (typeof ownerId !== 'string' || ownerId === '' || ownerDbName(ownerId) === DB_NAME) {
      return report;
    }
    const storage = getLocalStorage();
    const markerKey = migrationMarkerKey(ownerId);
    if (storage !== null && storage.getItem(markerKey) === '1') {
      // Este run no limpió nada: sólo informa que la migración ya ocurrió.
      report.alreadyMigrated = true;
      return report;
    }

    const copiedRefs = copyLocalStorageToOwner(storage, ownerId, report);
    const storesVerified = await copyIndexedDbToOwner(ownerId, report);
    report.legacyCleaned = await cleanupLegacyIfVerified(
      storage,
      markerKey,
      copiedRefs,
      storesVerified,
    );
    return report;
  } catch {
    return report;
  }
}

/** Copia settings legacy → scoped y keys legacy → scoped, sólo si no existen. */
function copyLocalStorageToOwner(
  storage: Storage | null,
  ownerId: string,
  report: OwnerMigrationReport,
): { settingsCopied: boolean; copiedRefs: string[]; skippedLegacyItems: number } {
  let settingsCopied = false;
  const copiedRefs: string[] = [];
  let skippedLegacyItems = 0;
  if (storage === null) return { settingsCopied, copiedRefs, skippedLegacyItems };

  const scopedSettingsKey = settingsStorageKey(ownerId);
  const legacySettings = storage.getItem(SETTINGS_STORAGE_KEY);
  if (legacySettings !== null) {
    if (storage.getItem(scopedSettingsKey) === null) {
      storage.setItem(scopedSettingsKey, legacySettings);
      settingsCopied = true;
      report.settings = 'copied';
    } else {
      // El destino ya tiene settings propios: no se pisa y el legacy queda pendiente.
      skippedLegacyItems += 1;
    }
  }

  for (const key of snapshotKeys(storage)) {
    const ref = legacyKeyRef(key);
    if (ref === null) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    if (storage.getItem(keyStorageKey(ref, ownerId)) === null) {
      storage.setItem(keyStorageKey(ref, ownerId), value);
      copiedRefs.push(ref);
    } else {
      skippedLegacyItems += 1;
    }
  }
  report.keysCopied = copiedRefs.length;
  return { settingsCopied, copiedRefs, skippedLegacyItems };
}

/**
 * Copia cada store legacy al owner con `put` sólo de registros ausentes, previa
 * verificación por `count()`: si el destino no está vacío, ese store no se toca.
 * Devuelve `true` sólo si todos los stores quedaron verificados.
 */
async function copyIndexedDbToOwner(
  ownerId: string,
  report: OwnerMigrationReport,
): Promise<boolean> {
  let legacyDb: OpenHerDb | null = null;
  let ownerDb: OpenHerDb | null = null;
  try {
    // Sin upgrade: si el legacy no existe se abre vacío y todo verifica trivialmente.
    legacyDb = await openDB<OpenHerDbSchema>(DB_NAME);
    ownerDb = await openDB(ownerDbName(ownerId), DB_VERSION, DB_OPEN_CALLBACKS);
    let allVerified = true;
    for (const store of MIGRATED_STORES) {
      const outcome = await copyStoreIfEmpty(legacyDb, ownerDb, store);
      report.idbCopied[store] = outcome.copied;
      if (!outcome.verified) allVerified = false;
    }
    return allVerified;
  } catch {
    return false;
  } finally {
    legacyDb?.close();
    ownerDb?.close();
  }
}

/**
 * Limpieza fail-closed: borra la base legacy, las keys legacy copiadas y el
 * settings legacy copiado, y sella el marcador. Sólo corre si la copia IndexedDB
 * quedó verificada y no quedaron ítems legacy sin copiar; cualquier fallo deja
 * los originales intactos y devuelve `false`.
 */
async function cleanupLegacyIfVerified(
  storage: Storage | null,
  markerKey: string,
  copied: { settingsCopied: boolean; copiedRefs: string[]; skippedLegacyItems: number },
  storesVerified: boolean,
): Promise<boolean> {
  if (!storesVerified || copied.skippedLegacyItems > 0) return false;
  try {
    await deleteDB(DB_NAME);
    if (storage !== null) {
      if (copied.settingsCopied) storage.removeItem(SETTINGS_STORAGE_KEY);
      for (const ref of copied.copiedRefs) {
        storage.removeItem(KEY_STORAGE_PREFIX + ref);
      }
      storage.setItem(markerKey, '1');
    }
    return true;
  } catch {
    return false;
  }
}

/** Copia un store legacy al destino sólo si el destino está vacío; verifica por conteo. */
async function copyStoreIfEmpty(
  legacyDb: OpenHerDb,
  ownerDb: OpenHerDb,
  store: MigratedStore,
): Promise<{ copied: number; verified: boolean }> {
  const legacyCount = legacyDb.objectStoreNames.contains(store) ? await legacyDb.count(store) : 0;
  if (legacyCount === 0) return { copied: 0, verified: true };
  if ((await ownerDb.count(store)) > 0) return { copied: 0, verified: false };
  const values = await legacyDb.getAll(store);
  let copied = 0;
  for (const value of values) {
    await ownerDb.put(store, value);
    copied += 1;
  }
  return { copied, verified: (await ownerDb.count(store)) >= legacyCount };
}

/**
 * Distingue una key legacy (`openher.key.<ref>`) de una ya migrada
 * (`openher.key.<owner>:<ref>`): las scoped tienen ≥2 `:` en el sufijo porque
 * la ref (`provider:<id>`, `search:<proveedor>`) ya aporta uno.
 */
function legacyKeyRef(key: string): string | null {
  if (!key.startsWith(KEY_STORAGE_PREFIX)) return null;
  const suffix = key.slice(KEY_STORAGE_PREFIX.length);
  if (suffix.length === 0 || suffix.split(':').length > 2) return null;
  return suffix;
}

/** Foto de las claves para iterar sin ver las scoped que se agregan durante la copia. */
function snapshotKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function emptyIdbCopied(): Record<string, number> {
  const copied: Record<string, number> = {};
  for (const store of MIGRATED_STORES) copied[store] = 0;
  return copied;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
