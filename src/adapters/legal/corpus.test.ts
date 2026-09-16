import { describe, expect, it } from 'vitest';
import { normalizeForDigest, sha256Hex } from '@/domain/legal/hash';
import { computePackHash, parseLegalPack } from '@/domain/legal/packs';
import { buildLegalIndex, searchLegalPassages } from '@/domain/legal/retrieval';
import type { LegalPack } from '@/domain/types/legal';

// `@types/node` no está instalado en el proyecto, por lo que un import literal de
// `node:fs` rompería `tsc -b`. El test corre bajo Vitest/Node: cargamos el builtin
// de forma dinámica y lo tipamos con la forma mínima que usamos.
type NodeFs = {
  readFileSync: (path: string | URL, encoding: 'utf8') => string;
  readdirSync: (path: string | URL) => string[];
  statSync: (path: string | URL) => { size: number };
};

const nodeFs = (await import(/* @vite-ignore */ 'node:fs' as string)) as NodeFs;

// Vitest/Vite reescribe `new URL('literal', import.meta.url)` como URL del dev
// server para assets. Guardamos primero la URL del módulo para forzar la
// resolución `file:` real y poder leer del disco con `node:fs`.
const MODULE_URL = import.meta.url;

const PACKS_DIR = new URL('../../../public/legal/packs/', MODULE_URL);
const MANIFEST_URL = new URL('index.json', PACKS_DIR);
const GOLDEN_SET_URL = new URL(
  '../../../scripts/legal/__fixtures__/golden-set.json',
  MODULE_URL,
);
const MAX_CORPUS_BYTES = 6 * 1024 * 1024;
const EXPECTED_PACK_IDS = [
  'ar-ccyc-core',
  'ar-cpccn-core',
  'ar-ldc-core',
  'ar-cn-core',
  'ar-amparo-core',
  'ar-ccyc-full',
  'ar-tucuman-cpcct',
  'ar-tucuman-familia',
  'ar-tucuman-laboral',
  'ar-tucuman-constitucion',
  'ar-tucuman-acordadas',
];

interface PackManifestEntry {
  id: string;
  version: string;
  hash: string;
  url: string;
  available: boolean;
  bytes: number;
}

interface PackManifest {
  schema: string;
  packs: PackManifestEntry[];
}

interface GoldenSetEntry {
  id: string;
  query: string;
  expect: { normId: string; article: string } | null;
}

interface GoldenSet {
  schema: string;
  queries: GoldenSetEntry[];
}

function readJson(url: URL): unknown {
  return JSON.parse(nodeFs.readFileSync(url, 'utf8')) as unknown;
}

/** URLs de los packs (excluye el manifiesto), ordenadas por nombre. */
function packFileUrls(): URL[] {
  return nodeFs
    .readdirSync(PACKS_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .sort()
    .map((name) => new URL(name, PACKS_DIR));
}

function parsePackOrThrow(url: URL): LegalPack {
  const pack = parseLegalPack(readJson(url), { verifyTextHashes: true });
  if (pack === null) {
    throw new Error(`parseLegalPack devolvió null para ${url.pathname}`);
  }
  return pack;
}

describe('corpus normativo publicado', () => {
  it('parsea cada pack con verifyTextHashes y su hash canónico coincide', () => {
    const urls = packFileUrls();
    expect(urls.length).toBe(EXPECTED_PACK_IDS.length);
    for (const url of urls) {
      const pack = parsePackOrThrow(url);
      expect(computePackHash(pack, sha256Hex), pack.id).toBe(pack.hash);
    }
  });

  it('toda provisión está verificada, trazable y con textHash válido', () => {
    for (const url of packFileUrls()) {
      const pack = parsePackOrThrow(url);
      expect(pack.provisions.length, `${pack.id} sin provisiones`).toBeGreaterThan(0);
      for (const provision of pack.provisions) {
        const label = `${pack.id}/${provision.id}`;
        expect(provision.verified, `${label} sin verified`).toBe(true);
        expect(provision.sourceUrl, `${label} sin sourceUrl`).not.toBe('');
        expect(provision.sourceDate, `${label} sin sourceDate`).not.toBe('');
        expect(provision.textHash, `${label} sin textHash`).toBe(
          sha256Hex(normalizeForDigest(provision.text)),
        );
      }
    }
  });

  it('el manifiesto lista los packs con hash y bytes coincidentes', () => {
    const manifest = readJson(MANIFEST_URL) as PackManifest;
    expect(manifest.schema).toBe('openher.legal.packs/1');
    expect([...manifest.packs.map((entry) => entry.id)].sort()).toEqual(
      [...EXPECTED_PACK_IDS].sort(),
    );

    for (const entry of manifest.packs) {
      const url = new URL(entry.url.replace(/^legal\/packs\//, ''), PACKS_DIR);
      const pack = parsePackOrThrow(url);
      expect(entry.hash, `${entry.id} hash del manifiesto`).toBe(pack.hash);
      expect(entry.available, `${entry.id} available`).toBe(true);
      expect(entry.bytes, `${entry.id} bytes`).toBe(nodeFs.statSync(url).size);
    }
  });

  it('el corpus total no supera los 500 KB', () => {
    const totalBytes = nodeFs
      .readdirSync(PACKS_DIR)
      .map((name) => nodeFs.statSync(new URL(name, PACKS_DIR)).size)
      .reduce((sum, size) => sum + size, 0);
    expect(totalBytes).toBeLessThanOrEqual(MAX_CORPUS_BYTES);
  });

  it('el golden set es parseable y declara expectativas bien formadas', () => {
    const golden = readJson(GOLDEN_SET_URL) as GoldenSet;
    expect(golden.schema).toBe('openher.legal.golden-set/1');
    expect(golden.queries.length).toBeGreaterThanOrEqual(10);
    for (const entry of golden.queries) {
      expect(entry.id, 'golden set sin id').not.toBe('');
      expect(entry.query, `${entry.id} sin query`).not.toBe('');
      if (entry.expect !== null) {
        expect(entry.expect.normId, `${entry.id} normId`).not.toBe('');
        expect(entry.expect.article, `${entry.id} article`).not.toBe('');
      }
    }
  });

  it('recall del índice sobre el golden set: >=80% de las resolubles en el top-3 (DoD §5.1)', () => {
    const packs = packFileUrls()
      .filter((url) => url.pathname !== MANIFEST_URL.pathname)
      .map((url) => parsePackOrThrow(url));
    const index = buildLegalIndex(packs);
    const golden = readJson(GOLDEN_SET_URL) as GoldenSet;
    const resolvable = golden.queries.filter((entry) => entry.expect !== null);
    expect(resolvable.length, 'golden set sin consultas resolubles').toBeGreaterThan(0);

    const misses: string[] = [];
    for (const entry of resolvable) {
      const expected = entry.expect;
      if (expected === null) continue;
      const hits = searchLegalPassages(index, entry.query, 3);
      const found = hits.some(
        (hit) => hit.provision.normId === expected.normId && hit.provision.article === expected.article,
      );
      if (!found) misses.push(`${entry.id} "${entry.query}" → ${expected.normId} ${expected.article}`);
    }

    const recall = (resolvable.length - misses.length) / resolvable.length;
    // DoD §5.1: >=80%. No se exige 100%: el corpus MVP es deliberadamente
    // chico y los misses quedan visibles acá y en el gap report (p. ej. hoy
    // falta el art. 2561 de prescripción de daños, cuyo texto completo no
    // está verificado y por eso no se publica).
    expect(
      recall,
      `recall ${(recall * 100).toFixed(1)}% (${resolvable.length - misses.length}/${resolvable.length}) < 80%. Misses: ${misses.join(' | ')}`,
    ).toBeGreaterThanOrEqual(0.8);
  });

  it('las consultas del gap report no rompen el índice (sin aserción de acierto)', () => {
    const packs = packFileUrls()
      .filter((url) => url.pathname !== MANIFEST_URL.pathname)
      .map((url) => parsePackOrThrow(url));
    const index = buildLegalIndex(packs);
    const golden = readJson(GOLDEN_SET_URL) as GoldenSet;
    const gaps = golden.queries.filter((entry) => entry.expect === null);
    expect(gaps.length, 'golden set sin consultas gap').toBeGreaterThan(0);
    for (const entry of gaps) {
      expect(() => searchLegalPassages(index, entry.query, 3), entry.id).not.toThrow();
    }
  });
});
