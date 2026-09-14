import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/domain/types/chat';
import { IndexedDbConversations } from './IndexedDbConversations';
import { IndexedDbLegalCases } from './IndexedDbLegalCases';
import {
  CONVERSATIONS_STORE,
  DB_NAME,
  LEGAL_CASES_STORE,
  MESSAGES_STORE,
  closeOwnerDb,
  closeStaleConnection,
  getDb,
  ownerDbName,
  upgradeOpenHerDb,
} from './idb';
import { KEY_STORAGE_PREFIX, keyStorageKey } from './LocalKeyVault';
import { SETTINGS_STORAGE_KEY, settingsStorageKey } from './LocalSettingsRepository';
import { migrateLegacyStorageToOwner, migrationMarkerKey } from './ownerMigration';

const OWNER = 'uid-migracion-1';
const OWNER_FRESH = 'uid-migracion-2';
const OWNER_FULL = 'uid-destino-lleno';
const OWNER_FAIL = 'uid-fallo-owner';
const OWNERS = [OWNER, OWNER_FRESH, OWNER_FULL, OWNER_FAIL];

const SETTINGS_JSON = '{"locale":"es"}';
const LEGACY_KEY = `${KEY_STORAGE_PREFIX}provider:groq`;
const LEGACY_SECRET = 'sk-legacy';

/** Siembra settings, una key, una conversación con mensaje y un caso en el storage legacy global. */
async function seedLegacy(): Promise<{ conversationId: string; caseId: string }> {
  const conversations = new IndexedDbConversations({ newId: () => 'conv-legacy-1', now: () => 100 });
  const conversation = await conversations.create({ title: 'Legacy' });
  const message: ChatMessage = {
    id: 'msg-legacy-1',
    conversationId: conversation.id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: 'hola' }],
    createdAt: 100,
    updatedAt: 100,
  };
  await conversations.appendMessage(message);

  const cases = new IndexedDbLegalCases({ newId: () => 'case-legacy-1', now: () => 100 });
  const legalCase = await cases.create({
    title: 'Desalojo',
    jurisdiction: 'caba',
    court: 'JNC Civil 12',
    matter: 'civil',
    clientRole: 'plaintiff',
  });

  localStorage.setItem(SETTINGS_STORAGE_KEY, SETTINGS_JSON);
  localStorage.setItem(LEGACY_KEY, LEGACY_SECRET);
  return { conversationId: conversation.id, caseId: legalCase.id };
}

describe('migrateLegacyStorageToOwner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    for (const owner of OWNERS) {
      closeOwnerDb(owner);
      await deleteDB(ownerDbName(owner));
    }
    closeStaleConnection();
    await deleteDB(DB_NAME);
  });

  it('copia settings, keys, conversaciones, mensajes y un store legal; limpia el legacy', async () => {
    const seed = await seedLegacy();

    const report = await migrateLegacyStorageToOwner(OWNER);

    expect(report.alreadyMigrated).toBe(false);
    expect(report.settings).toBe('copied');
    expect(report.keysCopied).toBe(1);
    expect(report.idbCopied[CONVERSATIONS_STORE]).toBe(1);
    expect(report.idbCopied[MESSAGES_STORE]).toBe(1);
    expect(report.idbCopied[LEGAL_CASES_STORE]).toBe(1);
    expect(report.legacyCleaned).toBe(true);

    // El destino verifica valores iguales a los legacy.
    expect(localStorage.getItem(settingsStorageKey(OWNER))).toBe(SETTINGS_JSON);
    expect(localStorage.getItem(keyStorageKey('provider:groq', OWNER))).toBe(LEGACY_SECRET);
    const ownerConversations = new IndexedDbConversations({ ownerId: OWNER });
    expect(await ownerConversations.get(seed.conversationId)).not.toBeNull();
    expect(await ownerConversations.listMessages(seed.conversationId)).toHaveLength(1);
    const ownerCases = new IndexedDbLegalCases({ ownerId: OWNER });
    expect(await ownerCases.get(seed.caseId)).not.toBeNull();

    // El legacy queda limpio y el marcador sella la idempotencia.
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(migrationMarkerKey(OWNER))).toBe('1');
    const legacyDb = await getDb();
    expect(await legacyDb.count(CONVERSATIONS_STORE)).toBe(0);
  });

  it('sin legacy previo verifica trivialmente, limpia y sella el marcador', async () => {
    const report = await migrateLegacyStorageToOwner(OWNER_FRESH);

    expect(report.alreadyMigrated).toBe(false);
    expect(report.settings).toBe('skipped');
    expect(report.keysCopied).toBe(0);
    expect(report.idbCopied[CONVERSATIONS_STORE]).toBe(0);
    expect(report.legacyCleaned).toBe(true);
    expect(localStorage.getItem(migrationMarkerKey(OWNER_FRESH))).toBe('1');
  });

  it('la segunda corrida se marca alreadyMigrated y no pisa el destino', async () => {
    await seedLegacy();
    const first = await migrateLegacyStorageToOwner(OWNER);
    expect(first.legacyCleaned).toBe(true);

    const ownerConversations = new IndexedDbConversations({
      newId: () => 'conv-nueva',
      now: () => 200,
      ownerId: OWNER,
    });
    await ownerConversations.create({ title: 'Nueva' });

    const second = await migrateLegacyStorageToOwner(OWNER);
    expect(second.alreadyMigrated).toBe(true);
    expect(second.settings).toBe('skipped');
    expect(second.keysCopied).toBe(0);
    expect(second.legacyCleaned).toBe(false);
    expect(await ownerConversations.get('conv-nueva')).not.toBeNull();
    expect(await ownerConversations.list()).toHaveLength(2);
  });

  it('no pisa un store destino no vacío y conserva el legacy (fail-closed)', async () => {
    const ownerConversations = new IndexedDbConversations({
      newId: () => 'conv-owner',
      now: () => 50,
      ownerId: OWNER_FULL,
    });
    await ownerConversations.create({ title: 'Del owner' });
    const seed = await seedLegacy();

    const report = await migrateLegacyStorageToOwner(OWNER_FULL);

    expect(report.idbCopied[CONVERSATIONS_STORE]).toBe(0);
    expect((await ownerConversations.list()).map((conversation) => conversation.id)).toEqual([
      'conv-owner',
    ]);
    expect(await ownerConversations.get(seed.conversationId)).toBeNull();

    expect(report.legacyCleaned).toBe(false);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(SETTINGS_JSON);
    expect(localStorage.getItem(migrationMarkerKey(OWNER_FULL))).toBeNull();
    const legacyConversations = new IndexedDbConversations();
    expect(await legacyConversations.get(seed.conversationId)).not.toBeNull();
  });

  it('un fallo de apertura del owner no lanza y deja los originales intactos', async () => {
    const seed = await seedLegacy();
    const name = ownerDbName(OWNER_FAIL);
    const newer = await openDB(name, 99, { upgrade: upgradeOpenHerDb });
    newer.close();

    const report = await migrateLegacyStorageToOwner(OWNER_FAIL);

    expect(report.alreadyMigrated).toBe(false);
    expect(report.legacyCleaned).toBe(false);
    const legacyConversations = new IndexedDbConversations();
    expect(await legacyConversations.get(seed.conversationId)).not.toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(SETTINGS_JSON);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(LEGACY_SECRET);
    expect(localStorage.getItem(migrationMarkerKey(OWNER_FAIL))).toBeNull();
  });

  it('sin owner válido no toca nada y nunca lanza', async () => {
    const seed = await seedLegacy();

    const report = await migrateLegacyStorageToOwner('');

    expect(report.alreadyMigrated).toBe(false);
    expect(report.legacyCleaned).toBe(false);
    expect(report.keysCopied).toBe(0);
    const legacyConversations = new IndexedDbConversations();
    expect(await legacyConversations.get(seed.conversationId)).not.toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(SETTINGS_JSON);
  });
});
