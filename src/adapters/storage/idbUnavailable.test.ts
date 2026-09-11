import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, getDb } from './idb';

describe('getDb sin indexedDB', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rechaza con error claro y permite reintentar cuando indexedDB vuelve', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(getDb()).rejects.toThrow(/IndexedDB/);
    vi.unstubAllGlobals();
    const db = await getDb();
    expect(db.name).toBe(DB_NAME);
  });
});
