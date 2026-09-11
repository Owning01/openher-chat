import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { ChatMessage } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';

export const DB_NAME = 'openher-chat';
export const DB_VERSION = 1;
export const CONVERSATIONS_STORE = 'conversations';
export const MESSAGES_STORE = 'messages';
export const UPDATED_AT_INDEX = 'updatedAt';
export const BY_CONVERSATION_INDEX = 'byConversation';

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
}

export type OpenHerDb = IDBPDatabase<OpenHerDbSchema>;

let dbPromise: Promise<OpenHerDb> | null = null;

/** Abre (o reutiliza) la base `openher-chat` v1. Singleton por contexto de ejecución. */
export function getDb(): Promise<OpenHerDb> {
  if (dbPromise === null) {
    dbPromise = openOpenHerDb().catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/**
 * Crea stores e índices de forma idempotente: si ya existen (upgrade a una
 * versión futura) no los recrea, evitando `ConstraintError`.
 */
export function upgradeOpenHerDb(database: IDBPDatabase<OpenHerDbSchema>): void {
  if (!database.objectStoreNames.contains(CONVERSATIONS_STORE)) {
    const conversations = database.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
    conversations.createIndex(UPDATED_AT_INDEX, 'updatedAt');
  }
  if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
    const messages = database.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
    messages.createIndex(BY_CONVERSATION_INDEX, ['conversationId', 'createdAt']);
  }
}

async function openOpenHerDb(): Promise<OpenHerDb> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB no está disponible en este entorno');
  }
  const database = await openDB<OpenHerDbSchema>(DB_NAME, DB_VERSION, { upgrade: upgradeOpenHerDb });
  requestPersistence();
  return database;
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
