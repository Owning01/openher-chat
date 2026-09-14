import { openDB } from 'idb';
import type {
  DBSchema,
  IDBPDatabase,
  IDBPTransaction,
  OpenDBCallbacks,
  StoreNames,
} from 'idb';
import type { ChatMessage } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import type {
  AcknowledgmentRecord,
  CaseAnalysis,
  GapReportEntry,
  LegalCase,
  LegalDocument,
  LegalPack,
} from '@/domain/types/legal';

// ---------------------------------------------------------------------------
// Nombres canónicos de base, stores e índices. Los repositorios y los tests
// consumen estas constantes para no duplicar literales.
// ---------------------------------------------------------------------------

export const DB_NAME = 'openher-chat';
/** Versión 2: agrega los stores del modo legal sin tocar los datos de v1. */
export const DB_VERSION = 2;
export const CONVERSATIONS_STORE = 'conversations';
export const MESSAGES_STORE = 'messages';
export const LEGAL_CASES_STORE = 'legalCases';
export const LEGAL_DOCUMENTS_STORE = 'legalDocuments';
export const LEGAL_ANALYSES_STORE = 'legalAnalyses';
export const LEGAL_PACKS_STORE = 'legalPacks';
export const ACKNOWLEDGMENTS_STORE = 'acknowledgments';
export const GAPS_STORE = 'gaps';

export const UPDATED_AT_INDEX = 'updatedAt';
export const BY_CONVERSATION_INDEX = 'byConversation';
export const CASE_ID_INDEX = 'caseId';
export const CREATED_AT_INDEX = 'createdAt';
export const INSTALLED_AT_INDEX = 'installedAt';
export const AT_INDEX = 'at';

/** Stores incorporados por el esquema v2 (v1 sólo tenía conversaciones y mensajes). */
export const LEGAL_STORES = [
  LEGAL_CASES_STORE,
  LEGAL_DOCUMENTS_STORE,
  LEGAL_ANALYSES_STORE,
  LEGAL_PACKS_STORE,
  ACKNOWLEDGMENTS_STORE,
  GAPS_STORE,
] as const;

/**
 * Pack persistido: contenido completo más los metadatos de instalación.
 * `listInstalled` expone los metadatos sin el contenido; `get` devuelve el pack.
 */
export interface StoredLegalPack extends LegalPack {
  installedAt: number;
  bytes: number;
}

export interface OpenHerDbSchema extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { updatedAt: number };
  };
  messages: {
    key: string;
    value: ChatMessage;
    indexes: { byConversation: [string, number] };
  };
  legalCases: {
    key: string;
    value: LegalCase;
    indexes: { updatedAt: number };
  };
  legalDocuments: {
    key: string;
    value: LegalDocument;
    indexes: { caseId: string; updatedAt: number };
  };
  /** `CaseAnalysis` no expone `updatedAt`: su orden natural de listado es `createdAt`. */
  legalAnalyses: {
    key: string;
    value: CaseAnalysis;
    indexes: { caseId: string; createdAt: number };
  };
  legalPacks: {
    key: string;
    value: StoredLegalPack;
    indexes: { installedAt: number };
  };
  acknowledgments: {
    key: string;
    value: AcknowledgmentRecord;
    indexes: { caseId: string; at: number };
  };
  gaps: {
    key: string;
    value: GapReportEntry;
    indexes: { caseId: string; at: number };
  };
}

export type OpenHerDb = IDBPDatabase<OpenHerDbSchema>;

type UpgradeTransaction = IDBPTransaction<OpenHerDbSchema, StoreNames<OpenHerDbSchema>[], 'versionchange'>;

/** Singletons por nombre de base: la global (`DB_NAME`) y una por cada owner. */
const dbPromises = new Map<string, Promise<OpenHerDb>>();
const liveConnections = new Map<string, OpenHerDb>();

/** Largo máximo del tramo saneado del owner dentro del nombre de la base. */
const MAX_OWNER_ID_LENGTH = 64;

/**
 * Sanea un ownerId para usarlo en el nombre de la base: conserva sólo
 * `[A-Za-z0-9_-]` (los UID de Firebase ya son así) y recorta a 64.
 * Si no queda nada saneable cae a un hash corto determinista del original.
 */
export function sanitizeOwnerId(ownerId: string): string {
  const cleaned = ownerId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_OWNER_ID_LENGTH);
  if (cleaned.length > 0) return cleaned;
  return `h${hashOwnerId(ownerId)}`;
}

/**
 * Nombre de la base para un owner: `DB_NAME` sin owner, `` `${DB_NAME}:<owner>` ``
 * con owner. Sin owner el comportamiento es idéntico al histórico (base global).
 */
export function ownerDbName(ownerId: string | null | undefined): string {
  if (ownerId === null || ownerId === undefined || ownerId === '') return DB_NAME;
  return `${DB_NAME}:${sanitizeOwnerId(ownerId)}`;
}

/** Abre (o reutiliza) la base del owner indicado. Sin argumento usa la base global. */
export function getDb(ownerId?: string | null): Promise<OpenHerDb> {
  const name = ownerDbName(ownerId);
  const existing = dbPromises.get(name);
  if (existing !== undefined) return existing;
  const pending = openNamedDb(name).catch((error: unknown) => {
    if (dbPromises.get(name) === pending) dbPromises.delete(name);
    throw error;
  });
  dbPromises.set(name, pending);
  return pending;
}

/**
 * Cierra la conexión del owner indicado (o la global sin argumento) e invalida
 * sólo su singleton, de modo que el próximo `getDb(owner)` reabra usable.
 * Se usa al cambiar de sesión; las demás conexiones quedan intactas.
 */
export function closeOwnerDb(ownerId?: string | null): void {
  const name = ownerDbName(ownerId);
  const connection = liveConnections.get(name);
  const pending = dbPromises.get(name);
  liveConnections.delete(name);
  dbPromises.delete(name);
  if (connection !== undefined) {
    connection.close();
    return;
  }
  if (pending !== undefined) {
    // La apertura seguía en vuelo: al resolverse se cierra la conexión huérfana
    // (salvo que ya sea la vigente tras una reapertura) para no bloquear futuros `deleteDB`.
    void pending.then(
      (database) => {
        if (liveConnections.get(name) !== database) {
          database.close();
        } else {
          database.close();
          liveConnections.delete(name);
        }
      },
      () => undefined,
    );
  }
}

/**
 * Cierra la conexión global (si existe) e invalida su singleton, de modo que
 * el próximo `getDb()` reabra con una conexión usable. Equivale a
 * `closeOwnerDb()` sin owner. Se usa en los handlers `blocked`/`blocking`
 * y cuando el navegador termina la conexión.
 */
export function closeStaleConnection(): void {
  closeOwnerDb();
}

/** Handler `blocked`: otra pestaña conserva la versión vieja y bloquea este upgrade. */
export function handleDbBlocked(): void {
  closeStaleConnection();
}

/** Handler `blocking`: esta conexión vieja bloquea el upgrade de otra pestaña; se cierra. */
export function handleDbBlocking(): void {
  closeStaleConnection();
}

/** Handlers registrados en `openDB`; exportados para poder verificarlos en tests. */
export const DB_OPEN_CALLBACKS: OpenDBCallbacks<OpenHerDbSchema> = {
  upgrade: upgradeOpenHerDb,
  blocked: handleDbBlocked,
  blocking: handleDbBlocking,
  terminated: closeStaleConnection,
};

/**
 * Crea los stores e índices de forma idempotente: `contains(...)` evita
 * `ConstraintError` al reabrir con una versión mayor. **Nunca** borra ni
 * recrea un store existente (los datos de v1 quedan intactos).
 */
export function upgradeOpenHerDb(
  database: IDBPDatabase<OpenHerDbSchema>,
  _oldVersion: number,
  _newVersion: number | null,
  transaction: UpgradeTransaction,
): void {
  ensureStore(database, CONVERSATIONS_STORE, { keyPath: 'id' });
  const conversations = transaction.objectStore(CONVERSATIONS_STORE);
  if (!conversations.indexNames.contains(UPDATED_AT_INDEX)) {
    conversations.createIndex(UPDATED_AT_INDEX, 'updatedAt');
  }

  ensureStore(database, MESSAGES_STORE, { keyPath: 'id' });
  const messages = transaction.objectStore(MESSAGES_STORE);
  if (!messages.indexNames.contains(BY_CONVERSATION_INDEX)) {
    messages.createIndex(BY_CONVERSATION_INDEX, ['conversationId', 'createdAt']);
  }

  ensureStore(database, LEGAL_CASES_STORE, { keyPath: 'id' });
  const cases = transaction.objectStore(LEGAL_CASES_STORE);
  if (!cases.indexNames.contains(UPDATED_AT_INDEX)) {
    cases.createIndex(UPDATED_AT_INDEX, 'updatedAt');
  }

  ensureStore(database, LEGAL_DOCUMENTS_STORE, { keyPath: 'id' });
  const documents = transaction.objectStore(LEGAL_DOCUMENTS_STORE);
  if (!documents.indexNames.contains(CASE_ID_INDEX)) {
    documents.createIndex(CASE_ID_INDEX, 'caseId');
  }
  if (!documents.indexNames.contains(UPDATED_AT_INDEX)) {
    documents.createIndex(UPDATED_AT_INDEX, 'updatedAt');
  }

  ensureStore(database, LEGAL_ANALYSES_STORE, { keyPath: 'id' });
  const analyses = transaction.objectStore(LEGAL_ANALYSES_STORE);
  if (!analyses.indexNames.contains(CASE_ID_INDEX)) {
    analyses.createIndex(CASE_ID_INDEX, 'caseId');
  }
  if (!analyses.indexNames.contains(CREATED_AT_INDEX)) {
    analyses.createIndex(CREATED_AT_INDEX, 'createdAt');
  }

  ensureStore(database, LEGAL_PACKS_STORE, { keyPath: 'id' });
  const packs = transaction.objectStore(LEGAL_PACKS_STORE);
  if (!packs.indexNames.contains(INSTALLED_AT_INDEX)) {
    packs.createIndex(INSTALLED_AT_INDEX, 'installedAt');
  }

  ensureStore(database, ACKNOWLEDGMENTS_STORE, { keyPath: 'id' });
  const acknowledgments = transaction.objectStore(ACKNOWLEDGMENTS_STORE);
  if (!acknowledgments.indexNames.contains(CASE_ID_INDEX)) {
    acknowledgments.createIndex(CASE_ID_INDEX, 'caseId');
  }
  if (!acknowledgments.indexNames.contains(AT_INDEX)) {
    acknowledgments.createIndex(AT_INDEX, 'at');
  }

  ensureStore(database, GAPS_STORE, { keyPath: 'id' });
  const gaps = transaction.objectStore(GAPS_STORE);
  if (!gaps.indexNames.contains(CASE_ID_INDEX)) {
    gaps.createIndex(CASE_ID_INDEX, 'caseId');
  }
  if (!gaps.indexNames.contains(AT_INDEX)) {
    gaps.createIndex(AT_INDEX, 'at');
  }
}

/** Crea un store sólo si falta; reabrir con versión mayor no lanza `ConstraintError`. */
function ensureStore(
  database: IDBPDatabase<OpenHerDbSchema>,
  name: StoreNames<OpenHerDbSchema>,
  options: IDBObjectStoreParameters,
): void {
  if (!database.objectStoreNames.contains(name)) {
    database.createObjectStore(name, options);
  }
}

async function openNamedDb(name: string): Promise<OpenHerDb> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB no está disponible en este entorno');
  }
  const database = await openDB<OpenHerDbSchema>(name, DB_VERSION, DB_OPEN_CALLBACKS);
  liveConnections.set(name, database);
  requestPersistence();
  return database;
}

/** Hash FNV-1a de 32 bits en hex: fallback determinista cuando no queda nada saneable. */
function hashOwnerId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Best-effort: pide almacenamiento persistente para reducir el riesgo de desalojo. */
function requestPersistence(): void {
  try {
    const manager = globalThis.navigator?.storage;
    if (manager === undefined || typeof manager.persist !== 'function') return;
    void manager.persist().catch(() => undefined);
  } catch {
    // Sin StorageManager disponible: la app sigue funcionando con IndexedDB normal.
  }
}
