import { deleteDB, openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION, getDb, upgradeOpenHerDb } from './idb';
import type { OpenHerDbSchema } from './idb';

describe('idb', () => {
  it('getDb abre el esquema v1 con stores e índices', async () => {
    const db = await getDb();
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    expect(db.objectStoreNames.contains('conversations')).toBe(true);
    expect(db.objectStoreNames.contains('messages')).toBe(true);
    expect(db.transaction('conversations').store.indexNames.contains('updatedAt')).toBe(true);
    expect(db.transaction('messages').store.indexNames.contains('byConversation')).toBe(true);
  });

  it('getDb es singleton dentro del mismo contexto', async () => {
    expect(getDb()).toBe(getDb());
  });

  it('upgradeOpenHerDb es idempotente al reabrir con versión mayor', async () => {
    const name = 'openher-chat-upgrade-test';
    const first = await openDB<OpenHerDbSchema>(name, 1, { upgrade: upgradeOpenHerDb });
    first.close();
    const second = await openDB<OpenHerDbSchema>(name, 2, { upgrade: upgradeOpenHerDb });
    expect(second.objectStoreNames.contains('conversations')).toBe(true);
    expect(second.objectStoreNames.contains('messages')).toBe(true);
    second.close();
    await deleteDB(name);
  });
});
