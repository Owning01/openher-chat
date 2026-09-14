// ---------------------------------------------------------------------------
// Adaptadores del corpus legal: loader, verificación y ciclo de vida del
// índice. Todo con dobles en memoria (sin red ni IndexedDB).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { normalizeForDigest, sha256Hex } from '@/domain/legal/hash';
import { computePackHash } from '@/domain/legal/packs';
import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';
import type { LegalPackStore } from '@/domain/ports/LegalPackStore';
import type { InstalledPack, LegalPack, LegalProvision } from '@/domain/types/legal';
import { createLegalCorpus } from './LegalCorpus';
import {
  fetchAndVerifyPack,
  loadManifest,
  manifestRequestUrl,
  packRequestUrl,
} from './packLoader';
import { verifyPack } from './packVerifier';

/** `HttpClient` fake: rutas por pathname (ignora el query del cache-buster). */
class FakeHttpClient implements HttpClient {
  readonly requestedUrls: string[] = [];
  private readonly routes = new Map<string, HttpResponse>();

  route(pathname: string, response: HttpResponse): void {
    this.routes.set(pathname, response);
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requestedUrls.push(request.url);
    const pathname = new URL(request.url, 'http://localhost/').pathname;
    return this.routes.get(pathname) ?? { status: 404, headers: {}, text: 'no encontrado' };
  }
}

/** `LegalPackStore` en memoria local al test (con contadores para espiar). */
class MemoryLegalPackStore implements LegalPackStore {
  getCalls = 0;
  installCalls = 0;
  private readonly packs = new Map<string, { pack: LegalPack; meta: InstalledPack }>();

  async listInstalled(): Promise<InstalledPack[]> {
    return [...this.packs.values()].map((entry) => ({ ...entry.meta }));
  }

  async get(id: string): Promise<LegalPack | null> {
    this.getCalls += 1;
    const entry = this.packs.get(id);
    return entry === undefined ? null : (JSON.parse(JSON.stringify(entry.pack)) as LegalPack);
  }

  async install(pack: LegalPack, bytes: number): Promise<InstalledPack> {
    this.installCalls += 1;
    const meta: InstalledPack = {
      id: pack.id,
      version: pack.version,
      hash: pack.hash,
      installedAt: 1,
      bytes,
    };
    this.packs.set(pack.id, {
      pack: JSON.parse(JSON.stringify(pack)) as LegalPack,
      meta,
    });
    return { ...meta };
  }

  async remove(id: string): Promise<void> {
    this.packs.delete(id);
  }
}

const FIXTURE_TEXT =
  'El plazo de prescripción del crédito del unicornio es de cinco años contados desde que la prestación es exigible.';
const MANIFEST_PATH = 'legal/packs/index.json';
const PACK_PATH = 'legal/packs/test-pack.json';

/** Pack mínimo válido, firmado con los hash reales (`sha256Hex` + canon). */
function buildFixturePack(): LegalPack {
  const provision: LegalProvision = {
    id: 'TEST-1',
    normId: 'TEST',
    article: '1',
    title: 'Plazo del unicornio',
    text: FIXTURE_TEXT,
    jurisdiction: 'national',
    sourceUrl: 'https://example.invalid/fuente',
    sourceDate: '2026-09-14',
    textHash: sha256Hex(normalizeForDigest(FIXTURE_TEXT)),
    verificationMethod: 'manual',
    tags: ['prescripcion', 'unicornio'],
    verified: true,
  };
  const unsigned: LegalPack = {
    schema: 'openher.legal.pack/1',
    id: 'test-pack',
    title: 'Pack de prueba',
    version: '1.0.0',
    publishedAt: '2026-09-14',
    jurisdiction: 'national',
    matter: 'civil',
    license: {
      name: 'Dominio público',
      url: 'https://example.invalid/licencia',
      attribution: 'Fixture de test',
    },
    sources: [{ url: 'https://example.invalid/fuente', retrievedAt: '2026-09-14' }],
    norms: [{ id: 'TEST', short: 'TEST', long: 'Norma de prueba', jurisdiction: 'national' }],
    provisions: [provision],
    hash: '',
  };
  return { ...unsigned, hash: computePackHash(unsigned) };
}

/** Manifiesto con una sola entrada que describe al pack dado. */
function buildManifest(pack: LegalPack): string {
  return JSON.stringify({
    schema: 'openher.legal.packs/1',
    packs: [
      {
        id: pack.id,
        version: pack.version,
        hash: pack.hash,
        url: PACK_PATH,
        available: true,
        bytes: 1234,
      },
    ],
  });
}

function jsonResponse(text: string): HttpResponse {
  return { status: 200, headers: {}, text };
}

describe('adaptadores del corpus legal', () => {
  it('loadManifest degrada a null ante basura o forma inválida', async () => {
    const garbage = new FakeHttpClient();
    garbage.route('/legal/packs/index.json', jsonResponse('basura { no es json'));
    expect(await loadManifest(garbage, MANIFEST_PATH)).toBeNull();

    const wrongSchema = new FakeHttpClient();
    wrongSchema.route('/legal/packs/index.json', jsonResponse('{"schema":"otro/1","packs":[]}'));
    expect(await loadManifest(wrongSchema, MANIFEST_PATH)).toBeNull();

    const missingHash = new FakeHttpClient();
    missingHash.route(
      '/legal/packs/index.json',
      jsonResponse(
        '{"schema":"openher.legal.packs/1","packs":[{"id":"x","version":"1","url":"u","available":true,"bytes":1}]}',
      ),
    );
    expect(await loadManifest(missingHash, MANIFEST_PATH)).toBeNull();
  });

  it('syncFromManifest no lanza con manifiesto basura y no instala nada', async () => {
    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse('basura total'));
    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({ http, packs: store, manifestUrl: MANIFEST_PATH });
    expect(corpus.getIndex()).toBeNull();
    const summary = await corpus.syncFromManifest();
    expect(summary).toEqual({ installed: [], skipped: [], failed: [] });
    expect(await store.listInstalled()).toEqual([]);
  });

  it('rechaza el pack con hash alterado: no se instala y errors no vacío', async () => {
    const pack = buildFixturePack();
    const tampered: LegalPack = { ...pack, hash: '0'.repeat(64) };
    expect(verifyPack(tampered).ok).toBe(false);

    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse(buildManifest(pack)));
    http.route('/legal/packs/test-pack.json', jsonResponse(JSON.stringify(tampered)));

    const direct = await fetchAndVerifyPack(http, PACK_PATH);
    expect(direct.pack).toBeNull();
    expect(direct.errors.length).toBeGreaterThan(0);

    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({ http, packs: store, manifestUrl: MANIFEST_PATH });
    const summary = await corpus.syncFromManifest();
    expect(summary.installed).toEqual([]);
    expect(summary.failed.map((entry) => entry.id)).toEqual(['test-pack']);
    expect(summary.failed[0]?.errors.length ?? 0).toBeGreaterThan(0);
    expect(await store.listInstalled()).toEqual([]);
  });

  it('rechaza el pack con textHash alterado: no se instala y errors no vacío', async () => {
    const pack = buildFixturePack();
    const tampered: LegalPack = {
      ...pack,
      provisions: pack.provisions.map((provision) => ({ ...provision, textHash: 'f'.repeat(64) })),
    };

    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse(buildManifest(pack)));
    http.route('/legal/packs/test-pack.json', jsonResponse(JSON.stringify(tampered)));

    const direct = await fetchAndVerifyPack(http, PACK_PATH);
    expect(direct.pack).toBeNull();
    expect(direct.errors.length).toBeGreaterThan(0);

    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({ http, packs: store, manifestUrl: MANIFEST_PATH });
    const summary = await corpus.syncFromManifest();
    expect(summary.installed).toEqual([]);
    expect(summary.failed.map((entry) => entry.id)).toEqual(['test-pack']);
    expect(await store.listInstalled()).toEqual([]);
  });

  it('instala el pack válido y ensureIndex encuentra la provisión', async () => {
    const pack = buildFixturePack();
    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse(buildManifest(pack)));
    http.route('/legal/packs/test-pack.json', jsonResponse(JSON.stringify(pack)));
    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({ http, packs: store, manifestUrl: MANIFEST_PATH });

    const summary = await corpus.syncFromManifest();
    expect(summary).toEqual({ installed: ['test-pack'], skipped: [], failed: [] });
    expect((await store.listInstalled()).map((meta) => meta.bytes)).toEqual([1234]);

    const index = await corpus.ensureIndex();
    expect(corpus.getIndex()).toBe(index);
    expect(index.get('TEST', '1')?.id).toBe('TEST-1');
    const hits = index.search('unicornio', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.provision.id).toBe('TEST-1');
  });

  it('ensureIndex es idempotente: no reconstruye y devuelve el mismo objeto', async () => {
    const pack = buildFixturePack();
    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse(buildManifest(pack)));
    http.route('/legal/packs/test-pack.json', jsonResponse(JSON.stringify(pack)));
    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({ http, packs: store, manifestUrl: MANIFEST_PATH });
    await corpus.syncFromManifest();

    const first = await corpus.ensureIndex();
    const getCallsAfterFirst = store.getCalls;
    expect(getCallsAfterFirst).toBeGreaterThan(0);
    const second = await corpus.ensureIndex();
    expect(second).toBe(first);
    expect(store.getCalls).toBe(getCallsAfterFirst);
  });

  it('syncFromManifest omite lo ya instalado sin reinstalar ni redescargar', async () => {
    const pack = buildFixturePack();
    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse(buildManifest(pack)));
    http.route('/legal/packs/test-pack.json', jsonResponse(JSON.stringify(pack)));
    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({ http, packs: store, manifestUrl: MANIFEST_PATH });

    const first = await corpus.syncFromManifest();
    expect(first.installed).toEqual(['test-pack']);
    expect(store.installCalls).toBe(1);
    const packRequestsBefore = http.requestedUrls.filter((url) =>
      url.includes('test-pack.json'),
    ).length;

    const second = await corpus.syncFromManifest();
    expect(second.installed).toEqual([]);
    expect(second.skipped).toEqual(['test-pack']);
    expect(second.failed).toEqual([]);
    expect(store.installCalls).toBe(1);
    expect(
      http.requestedUrls.filter((url) => url.includes('test-pack.json')).length,
    ).toBe(packRequestsBefore);
  });

  it('las URLs llevan el cache-buster esperado (t= en manifiesto, v=hash en pack)', async () => {
    const pack = buildFixturePack();
    const http = new FakeHttpClient();
    http.route('/legal/packs/index.json', jsonResponse(buildManifest(pack)));
    http.route('/legal/packs/test-pack.json', jsonResponse(JSON.stringify(pack)));
    const store = new MemoryLegalPackStore();
    const corpus = createLegalCorpus({
      http,
      packs: store,
      manifestUrl: MANIFEST_PATH,
      now: () => 42,
    });
    await corpus.syncFromManifest();

    const manifestUrl = http.requestedUrls.find((url) => url.includes('index.json')) ?? '';
    expect(manifestUrl).toContain('t=42');
    const packUrl = http.requestedUrls.find((url) => url.includes('test-pack.json')) ?? '';
    expect(packUrl).toContain(`v=${pack.hash}`);

    expect(manifestRequestUrl('legal/packs/index.json', () => 42)).toBe(
      'legal/packs/index.json?t=42',
    );
    expect(packRequestUrl('legal/packs/test-pack.json', 'abc123')).toBe(
      'legal/packs/test-pack.json?v=abc123',
    );
  });

  it('ensureIndex reconstruye si cambia el hash con la misma versión (B13)', async () => {
    const packA = buildFixturePack();
    const store = new MemoryLegalPackStore();
    await store.install(packA, 1234);
    const corpus = createLegalCorpus({
      http: new FakeHttpClient(),
      packs: store,
      manifestUrl: MANIFEST_PATH,
    });

    const first = await corpus.ensureIndex();
    expect(first.get('TEST', '1')?.id).toBe('TEST-1');
    const getCallsAfterFirst = store.getCalls;

    // Mismo id y versión, contenido distinto: el hash cambia y el memo debe caer.
    const dragonText =
      'El dragón de la guarda custodia el plazo del unicornio con fuego lento y ceniza fría.';
    const base = packA.provisions[0];
    if (base === undefined) throw new Error('sin provisiones en el fixture');
    const unsigned: LegalPack = {
      ...packA,
      provisions: [
        {
          ...base,
          text: dragonText,
          textHash: sha256Hex(normalizeForDigest(dragonText)),
        },
      ],
      hash: '',
    };
    const packB: LegalPack = { ...unsigned, hash: computePackHash(unsigned) };
    expect(packB.version).toBe(packA.version);
    expect(packB.hash).not.toBe(packA.hash);
    await store.install(packB, 1234);

    const second = await corpus.ensureIndex();
    expect(second).not.toBe(first);
    expect(store.getCalls).toBeGreaterThan(getCallsAfterFirst);
    expect(second.get('TEST', '1')?.text).toBe(dragonText);
  });
});
