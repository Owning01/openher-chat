import { beforeEach, describe, expect, it } from 'vitest';
import type { LegalPack } from '@/domain/types/legal';
import { IndexedDbLegalPacks } from './IndexedDbLegalPacks';
import { LEGAL_PACKS_STORE, getDb } from './idb';

function makePack(overrides: Partial<LegalPack> = {}): LegalPack {
  return {
    schema: 'openher.legal.pack/1',
    id: 'pack-ccyc',
    title: 'Código Civil y Comercial',
    version: '1.0.0',
    publishedAt: '2026-01-01',
    jurisdiction: 'national',
    matter: 'civil',
    license: { name: 'InfoLEG', url: 'https://example.test/license', attribution: 'InfoLEG' },
    sources: [{ url: 'https://example.test/ccyc', retrievedAt: '2026-01-01' }],
    norms: [{ id: 'CCyC', short: 'CCyC', long: 'Código Civil y Comercial', jurisdiction: 'national' }],
    provisions: [
      {
        id: 'CCyC-1',
        normId: 'CCyC',
        article: '1',
        text: 'Texto del artículo.',
        jurisdiction: 'national',
        sourceUrl: 'https://example.test/ccyc/1',
        sourceDate: '2026-01-01',
        textHash: 'text-hash-1',
        verificationMethod: 'manual',
        tags: ['fuentes'],
        verified: true,
      },
    ],
    hash: 'pack-hash-1',
    ...overrides,
  };
}

describe('IndexedDbLegalPacks', () => {
  let nowValue = 0;
  let store: IndexedDbLegalPacks;

  beforeEach(async () => {
    nowValue = 0;
    store = new IndexedDbLegalPacks({ now: () => nowValue });
    const db = await getDb();
    await db.clear(LEGAL_PACKS_STORE);
  });

  it('install guarda bytes/installedAt y get devuelve el pack completo', async () => {
    nowValue = 1_234;
    const pack = makePack();
    const installed = await store.install(pack, 512);

    expect(installed).toEqual({
      id: 'pack-ccyc',
      version: '1.0.0',
      hash: 'pack-hash-1',
      installedAt: 1_234,
      bytes: 512,
    });
    expect(await store.get('pack-ccyc')).toEqual(pack);
    expect(await store.get('missing')).toBeNull();
  });

  it('listInstalled devuelve metadatos sin contenido en orden (installedAt, id)', async () => {
    nowValue = 10;
    await store.install(makePack(), 100);
    nowValue = 20;
    await store.install(makePack({ id: 'pack-cpccn', version: '2.0.0', hash: 'pack-hash-2' }), 200);

    const installed = await store.listInstalled();
    expect(installed.map((pack) => pack.id)).toEqual(['pack-ccyc', 'pack-cpccn']);
    expect(installed[0]).toEqual({
      id: 'pack-ccyc',
      version: '1.0.0',
      hash: 'pack-hash-1',
      installedAt: 10,
      bytes: 100,
    });
    expect(installed[0]).not.toHaveProperty('provisions');
    expect(installed[0]).not.toHaveProperty('norms');
    expect(installed[0]).not.toHaveProperty('title');
  });

  it('install reemplaza por id (upsert) sin duplicar y actualiza metadatos', async () => {
    nowValue = 10;
    await store.install(makePack(), 100);
    nowValue = 20;
    const replaced = await store.install(
      makePack({ version: '2.0.0', hash: 'pack-hash-2' }),
      300,
    );

    expect(replaced).toEqual({
      id: 'pack-ccyc',
      version: '2.0.0',
      hash: 'pack-hash-2',
      installedAt: 20,
      bytes: 300,
    });
    expect(await store.listInstalled()).toHaveLength(1);
    expect((await store.get('pack-ccyc'))?.version).toBe('2.0.0');
    expect((await store.get('pack-ccyc'))?.hash).toBe('pack-hash-2');
  });

  it('remove borra el pack instalado', async () => {
    await store.install(makePack(), 100);
    await store.remove('pack-ccyc');
    expect(await store.get('pack-ccyc')).toBeNull();
    expect(await store.listInstalled()).toEqual([]);
  });
});
