import { deleteDB, openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACKNOWLEDGMENTS_STORE,
  AT_INDEX,
  BY_CONVERSATION_INDEX,
  CASE_ID_INDEX,
  CONVERSATIONS_STORE,
  CREATED_AT_INDEX,
  DB_NAME,
  DB_OPEN_CALLBACKS,
  DB_VERSION,
  GAPS_STORE,
  INSTALLED_AT_INDEX,
  LEGAL_ANALYSES_STORE,
  LEGAL_CASES_STORE,
  LEGAL_DOCUMENTS_STORE,
  LEGAL_PACKS_STORE,
  LEGAL_STORES,
  MESSAGES_STORE,
  SKILLS_STORE,
  UPDATED_AT_INDEX,
  closeOwnerDb,
  getDb,
  handleDbBlocked,
  handleDbBlocking,
  ownerDbName,
  sanitizeOwnerId,
  upgradeOpenHerDb,
} from './idb';
import type { OpenHerDbSchema, StoredLegalPack } from './idb';
import type { ChatMessage } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';

const CONVERSATION: Conversation = {
  id: 'conv-1',
  title: 'Prueba',
  createdAt: 1,
  updatedAt: 2,
  providerId: null,
  modelId: null,
  systemPromptOverride: null,
  researchMode: false,
  messageCount: 1,
  lastMessagePreview: 'hola',
  status: 'active',
};

const MESSAGE: ChatMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  role: 'user',
  status: 'complete',
  content: [{ type: 'text', text: 'hola' }],
  createdAt: 1,
  updatedAt: 2,
};

/** Todos los stores del esquema v2, como literales para poder consultarlos por nombre. */
const ALL_STORES = [CONVERSATIONS_STORE, MESSAGES_STORE, SKILLS_STORE, ...LEGAL_STORES] as const;

/** Esquema v1 real (sólo conversaciones y mensajes) para simular una base existente. */
function upgradeV1(database: IDBPDatabase<OpenHerDbSchema>): void {
  if (!database.objectStoreNames.contains(CONVERSATIONS_STORE)) {
    database
      .createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' })
      .createIndex(UPDATED_AT_INDEX, 'updatedAt');
  }
  if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
    database
      .createObjectStore(MESSAGES_STORE, { keyPath: 'id' })
      .createIndex(BY_CONVERSATION_INDEX, ['conversationId', 'createdAt']);
  }
}

describe('idb', () => {
  it('getDb abre la base v3 con todos los stores e índices', async () => {
    const db = await getDb();
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect(DB_VERSION).toBe(3);

    for (const store of ALL_STORES) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }

    expect(db.transaction(CONVERSATIONS_STORE).store.indexNames.contains(UPDATED_AT_INDEX)).toBe(true);
    expect(db.transaction(MESSAGES_STORE).store.indexNames.contains(BY_CONVERSATION_INDEX)).toBe(true);
    expect(db.transaction(LEGAL_CASES_STORE).store.indexNames.contains(UPDATED_AT_INDEX)).toBe(true);

    const documents = db.transaction(LEGAL_DOCUMENTS_STORE).store;
    expect(documents.indexNames.contains(CASE_ID_INDEX)).toBe(true);
    expect(documents.indexNames.contains(UPDATED_AT_INDEX)).toBe(true);

    const analyses = db.transaction(LEGAL_ANALYSES_STORE).store;
    expect(analyses.indexNames.contains(CASE_ID_INDEX)).toBe(true);
    expect(analyses.indexNames.contains(CREATED_AT_INDEX)).toBe(true);

    expect(db.transaction(LEGAL_PACKS_STORE).store.indexNames.contains(INSTALLED_AT_INDEX)).toBe(true);
    expect(db.transaction(ACKNOWLEDGMENTS_STORE).store.indexNames.contains(AT_INDEX)).toBe(true);
    expect(db.transaction(GAPS_STORE).store.indexNames.contains(AT_INDEX)).toBe(true);
    expect(db.transaction(SKILLS_STORE).store.indexNames.contains(UPDATED_AT_INDEX)).toBe(true);
  });

  it('getDb es singleton dentro del mismo contexto', async () => {
    expect(getDb()).toBe(getDb());
  });

  it('upgrade v1 -> v2 conserva los datos de v1 y crea los stores nuevos', async () => {
    const name = 'openher-chat-v1-to-v2';
    await deleteDB(name);

    const v1 = await openDB<OpenHerDbSchema>(name, 1, { upgrade: upgradeV1 });
    await v1.put(CONVERSATIONS_STORE, CONVERSATION);
    await v1.put(MESSAGES_STORE, MESSAGE);
    v1.close();

    const v2 = await openDB<OpenHerDbSchema>(name, 2, { upgrade: upgradeOpenHerDb });
    expect(v2.version).toBe(2);

    // Los datos de v1 sobreviven a la migración.
    expect(await v2.get(CONVERSATIONS_STORE, CONVERSATION.id)).toEqual(CONVERSATION);
    expect(await v2.get(MESSAGES_STORE, MESSAGE.id)).toEqual(MESSAGE);

    for (const store of LEGAL_STORES) {
      expect(v2.objectStoreNames.contains(store)).toBe(true);
    }
    expect(v2.transaction(LEGAL_DOCUMENTS_STORE).store.indexNames.contains(CASE_ID_INDEX)).toBe(true);
    expect(v2.transaction(LEGAL_ANALYSES_STORE).store.indexNames.contains(CREATED_AT_INDEX)).toBe(true);
    expect(v2.transaction(GAPS_STORE).store.indexNames.contains(AT_INDEX)).toBe(true);

    v2.close();
    await deleteDB(name);
  });

  it('upgradeOpenHerDb es idempotente al reejecutarse sobre un esquema ya creado', async () => {
    const name = 'openher-chat-idempotent';
    await deleteDB(name);

    const first = await openDB<OpenHerDbSchema>(name, 2, { upgrade: upgradeOpenHerDb });
    await first.put(CONVERSATIONS_STORE, CONVERSATION);
    first.close();

    // Un segundo upgrade (versión mayor) no debe lanzar ConstraintError ni borrar nada.
    const second = await openDB<OpenHerDbSchema>(name, 3, { upgrade: upgradeOpenHerDb });
    expect(second.version).toBe(3);
    expect(await second.get(CONVERSATIONS_STORE, CONVERSATION.id)).toEqual(CONVERSATION);

    for (const store of ALL_STORES) {
      expect(second.objectStoreNames.contains(store)).toBe(true);
    }
    expect(second.transaction(LEGAL_CASES_STORE).store.indexNames.contains(UPDATED_AT_INDEX)).toBe(true);
    expect(second.transaction(LEGAL_DOCUMENTS_STORE).store.indexNames.contains(CASE_ID_INDEX)).toBe(true);

    second.close();
    await deleteDB(name);
  });

  it('los nombres exportados coinciden con los usados por el upgrade', () => {
    expect([
      CONVERSATIONS_STORE,
      MESSAGES_STORE,
      LEGAL_CASES_STORE,
      LEGAL_DOCUMENTS_STORE,
      LEGAL_ANALYSES_STORE,
      LEGAL_PACKS_STORE,
      ACKNOWLEDGMENTS_STORE,
      GAPS_STORE,
    ]).toEqual([
      'conversations',
      'messages',
      'legalCases',
      'legalDocuments',
      'legalAnalyses',
      'legalPacks',
      'acknowledgments',
      'gaps',
    ]);
    expect([
      UPDATED_AT_INDEX,
      BY_CONVERSATION_INDEX,
      CASE_ID_INDEX,
      CREATED_AT_INDEX,
      INSTALLED_AT_INDEX,
      AT_INDEX,
    ]).toEqual(['updatedAt', 'byConversation', 'caseId', 'createdAt', 'installedAt', 'at']);
  });

  it('persiste packs con metadatos e índice installedAt en legalPacks', async () => {
    const name = 'openher-chat-packs';
    await deleteDB(name);

    const db = await openDB<OpenHerDbSchema>(name, DB_VERSION, { upgrade: upgradeOpenHerDb });
    const pack: StoredLegalPack = {
      schema: 'openher.legal.pack/1',
      id: 'pack-1',
      title: 'CCyC',
      version: '1.0.0',
      publishedAt: '2026-01-01',
      jurisdiction: 'national',
      matter: 'civil',
      license: { name: 'InfoLEG', url: 'https://example.test', attribution: 'InfoLEG' },
      sources: [{ url: 'https://example.test', retrievedAt: '2026-01-01' }],
      norms: [],
      provisions: [],
      hash: 'hash-1',
      installedAt: 10,
      bytes: 128,
    };
    await db.put(LEGAL_PACKS_STORE, pack);
    expect(await db.get(LEGAL_PACKS_STORE, pack.id)).toEqual(pack);
    expect(await db.getAllFromIndex(LEGAL_PACKS_STORE, INSTALLED_AT_INDEX, 10)).toEqual([pack]);

    db.close();
    await deleteDB(name);
  });

  it('blocked espera y el upgrade se resuelve al cerrar la conexión vieja', async () => {
    const name = 'openher-chat-blocked';
    await deleteDB(name);

    const older = await openDB<OpenHerDbSchema>(name, 1, { upgrade: upgradeV1 });
    let blockedCalled = false;

    const pending = openDB<OpenHerDbSchema>(name, 2, {
      upgrade: upgradeOpenHerDb,
      blocked: () => {
        blockedCalled = true;
      },
    });

    // Deja que se dispare el evento `blocked` mientras la conexión vieja sigue abierta.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(blockedCalled).toBe(true);

    older.close();
    const upgraded = await pending;
    expect(upgraded.version).toBe(2);
    expect(upgraded.objectStoreNames.contains(LEGAL_CASES_STORE)).toBe(true);

    upgraded.close();
    await deleteDB(name);
  });

  it('blocking cierra la conexión vieja y no rompe la apertura', async () => {
    const name = 'openher-chat-blocking';
    await deleteDB(name);

    let blockingCalled = false;
    const older = await openDB<OpenHerDbSchema>(name, 1, {
      upgrade: upgradeV1,
      blocking: () => {
        blockingCalled = true;
        older.close();
      },
    });

    const upgraded = await openDB<OpenHerDbSchema>(name, 2, { upgrade: upgradeOpenHerDb });
    expect(blockingCalled).toBe(true);
    expect(upgraded.version).toBe(2);
    expect(upgraded.objectStoreNames.contains(LEGAL_PACKS_STORE)).toBe(true);

    upgraded.close();
    await deleteDB(name);
  });

  it('registra los handlers blocked/blocking en la apertura', () => {
    expect(DB_OPEN_CALLBACKS.upgrade).toBe(upgradeOpenHerDb);
    expect(DB_OPEN_CALLBACKS.blocked).toBe(handleDbBlocked);
    expect(DB_OPEN_CALLBACKS.blocking).toBe(handleDbBlocking);
  });

  it('handleDbBlocking cierra la conexión vigente sin perder datos y getDb reabre usable', async () => {
    const db = await getDb();
    const conversation: Conversation = { ...CONVERSATION, id: 'blocking-conv' };
    await db.put(CONVERSATIONS_STORE, conversation);

    handleDbBlocking();
    expect(() => db.transaction(CONVERSATIONS_STORE)).toThrow();

    const reopened = await getDb();
    expect(await reopened.get(CONVERSATIONS_STORE, conversation.id)).toEqual(conversation);
  });

  it('handleDbBlocked invalida el singleton y getDb devuelve una conexión usable', async () => {
    const db = await getDb();
    const conversation: Conversation = { ...CONVERSATION, id: 'blocked-conv' };
    await db.put(CONVERSATIONS_STORE, conversation);

    handleDbBlocked();

    const reopened = await getDb();
    expect(await reopened.get(CONVERSATIONS_STORE, conversation.id)).toEqual(conversation);
  });
});

describe('idb por owner', () => {
  const OWNER_A = 'test-owner-a';
  const OWNER_B = 'test-owner-b';
  const OWNER_C = 'test-owner-c';

  afterEach(async () => {
    for (const owner of [OWNER_A, OWNER_B, OWNER_C]) {
      closeOwnerDb(owner);
      await deleteDB(ownerDbName(owner));
    }
  });

  it('sanitizeOwnerId conserva [A-Za-z0-9_-], recorta a 64 y cae a hash si queda vacío', () => {
    expect(sanitizeOwnerId('abcXYZ019_-')).toBe('abcXYZ019_-');
    expect(sanitizeOwnerId('uid con espacios@y!/')).toBe('uidconespaciosy');
    expect(sanitizeOwnerId('a'.repeat(100))).toBe('a'.repeat(64));
    const first = sanitizeOwnerId('!!!');
    expect(first).toBe(sanitizeOwnerId('!!!'));
    expect(first).toMatch(/^h[0-9a-f]{8}$/);
    expect(sanitizeOwnerId('???')).not.toBe(first);
  });

  it('ownerDbName usa DB_NAME sin owner y sufija con el owner saneado', () => {
    expect(ownerDbName(null)).toBe(DB_NAME);
    expect(ownerDbName(undefined)).toBe(DB_NAME);
    expect(ownerDbName('')).toBe(DB_NAME);
    expect(ownerDbName('uid123')).toBe(`${DB_NAME}:uid123`);
    expect(ownerDbName('a b')).toBe(`${DB_NAME}:ab`);
  });

  it('getDb por owner aísla los datos entre owners y respecto del legacy', async () => {
    const dbA = await getDb(OWNER_A);
    expect(dbA.name).toBe(ownerDbName(OWNER_A));
    await dbA.put(CONVERSATIONS_STORE, { ...CONVERSATION, id: 'owner-a-conv' });

    const dbB = await getDb(OWNER_B);
    expect(await dbB.get(CONVERSATIONS_STORE, 'owner-a-conv')).toBeUndefined();

    const legacy = await getDb();
    expect(await legacy.get(CONVERSATIONS_STORE, 'owner-a-conv')).toBeUndefined();
    expect(await dbA.get(CONVERSATIONS_STORE, 'owner-a-conv')).toBeDefined();
  });

  it('getDb es singleton por nombre de base', async () => {
    await getDb(OWNER_A);
    await getDb(OWNER_B);
    expect(getDb(OWNER_A)).toBe(getDb(OWNER_A));
    expect(getDb(OWNER_A)).not.toBe(getDb(OWNER_B));
    expect(getDb(OWNER_A)).not.toBe(getDb());
  });

  it('closeOwnerDb cierra sólo esa conexión y permite reabrir usable sin tocar la global', async () => {
    const dbA = await getDb(OWNER_C);
    await dbA.put(CONVERSATIONS_STORE, { ...CONVERSATION, id: 'owner-c-conv' });

    const legacy = await getDb();
    await legacy.put(CONVERSATIONS_STORE, { ...CONVERSATION, id: 'legacy-conv' });

    closeOwnerDb(OWNER_C);
    expect(() => dbA.transaction(CONVERSATIONS_STORE)).toThrow();

    expect(await legacy.get(CONVERSATIONS_STORE, 'legacy-conv')).toEqual({
      ...CONVERSATION,
      id: 'legacy-conv',
    });

    const reopened = await getDb(OWNER_C);
    expect(await reopened.get(CONVERSATIONS_STORE, 'owner-c-conv')).toEqual({
      ...CONVERSATION,
      id: 'owner-c-conv',
    });
  });
});
