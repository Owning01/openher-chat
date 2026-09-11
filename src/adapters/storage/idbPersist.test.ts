import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getDb y almacenamiento persistente', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('solicita navigator.storage.persist() una sola vez al abrir', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { storage: { persist } });
    const { getDb } = await import('./idb');
    await getDb();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('tolera que persist rechace sin romper la apertura', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { storage: { persist } });
    const { getDb } = await import('./idb');
    await expect(getDb()).resolves.toBeDefined();
  });
});
