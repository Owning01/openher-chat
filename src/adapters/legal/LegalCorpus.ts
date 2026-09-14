// ---------------------------------------------------------------------------
// Corpus legal instalado: sincroniza packs desde el manifiesto y expone un
// índice léxico async, idempotente y memoizado. Delega la red en `HttpClient`
// y la persistencia en `LegalPackStore`; `syncFromManifest` nunca lanza.
// ---------------------------------------------------------------------------

import { sha256Hex, type Hasher } from '@/domain/legal/hash';
import { buildLegalIndex } from '@/domain/legal/retrieval';
import type { HttpClient } from '@/domain/ports/HttpClient';
import type { LegalPackStore } from '@/domain/ports/LegalPackStore';
import type { InstalledPack, LegalIndex, LegalPack } from '@/domain/types/legal';
import { fetchAndVerifyPack, loadManifest, packRequestUrl } from './packLoader';

/** Manifiesto servido como asset same-origin (`public/legal/packs/index.json`). */
const DEFAULT_MANIFEST_URL = 'legal/packs/index.json';

/** Dependencias del corpus; reloj y hasher inyectables para tests deterministas. */
export interface LegalCorpusDeps {
  http: HttpClient;
  packs: LegalPackStore;
  hasher?: Hasher;
  now?: () => number;
  manifestUrl?: string;
  baseUrl?: string;
}

/** Pack que no pudo instalarse, con errores explicables. */
export interface FailedPack {
  id: string;
  errors: string[];
}

/** Resumen de `syncFromManifest`: instalados, omitidos y fallidos (por id). */
export interface LegalSyncSummary {
  installed: string[];
  skipped: string[];
  failed: FailedPack[];
}

/** Ciclo de vida del corpus instalado y su índice léxico derivado. */
export interface LegalCorpus {
  syncFromManifest(): Promise<LegalSyncSummary>;
  ensureIndex(): Promise<LegalIndex>;
  getIndex(): LegalIndex | null;
  listInstalled(): Promise<InstalledPack[]>;
}

/** Crea el corpus; el índice arranca vacío hasta el primer `ensureIndex`. */
export function createLegalCorpus(deps: LegalCorpusDeps): LegalCorpus {
  const http = deps.http;
  const store = deps.packs;
  const hasher = deps.hasher ?? sha256Hex;
  const now = deps.now ?? Date.now;
  const manifestUrl = deps.manifestUrl ?? DEFAULT_MANIFEST_URL;
  const baseUrl = deps.baseUrl ?? '';

  let cachedIndex: LegalIndex | null = null;
  let cachedKey = '';
  let pending: Promise<LegalIndex> | null = null;

  // Une `baseUrl` con la ruta relativa del manifiesto (`legal/packs/…`);
  // las absolutas (con esquema o `/…`) se usan tal cual.
  function resolvePackUrl(entryUrl: string): string {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entryUrl) || entryUrl.startsWith('/')) {
      return entryUrl;
    }
    return `${baseUrl}${entryUrl}`;
  }

  function invalidateIndex(): void {
    cachedIndex = null;
    cachedKey = '';
    pending = null;
  }

  // Baja el manifiesto, instala sólo lo que cambió de `hash`/`version` (y sólo
  // si verifica OK) y devuelve el resumen. Nunca elimina packs (sólo suma o
  // actualiza) y nunca lanza: cada fallo degrada a `skipped`/`failed`.
  async function syncFromManifest(): Promise<LegalSyncSummary> {
    const summary: LegalSyncSummary = { installed: [], skipped: [], failed: [] };
    try {
      const manifest = await loadManifest(http, manifestUrl, { hasher, now });
      if (manifest === null) return summary;
      const installedById = new Map<string, InstalledPack>();
      try {
        for (const meta of await store.listInstalled()) installedById.set(meta.id, meta);
      } catch {
        // Sin metadatos se reintenta instalar todo (el `install` es un upsert).
      }
      for (const entry of manifest.packs) {
        if (!entry.available) {
          summary.skipped.push(entry.id);
          continue;
        }
        const current = installedById.get(entry.id);
        if (
          current !== undefined &&
          current.version === entry.version &&
          current.hash === entry.hash
        ) {
          summary.skipped.push(entry.id);
          continue;
        }
        try {
          // La URL lleva `?v=<hash>`: cada versión es única y el service worker
          // nunca sirve un pack viejo (ver `packLoader.ts` y `public/sw.js`).
          const url = packRequestUrl(resolvePackUrl(entry.url), entry.hash);
          const result = await fetchAndVerifyPack(http, url, {
            hasher,
            expectedHash: entry.hash,
          });
          if (result.pack === null) {
            summary.failed.push({ id: entry.id, errors: result.errors });
            continue;
          }
          const bytes = entry.bytes >= 0 ? entry.bytes : result.bytes;
          await store.install(result.pack, bytes);
          installedById.set(entry.id, {
            id: entry.id,
            version: entry.version,
            hash: entry.hash,
            installedAt: now(),
            bytes,
          });
          summary.installed.push(entry.id);
        } catch {
          summary.failed.push({ id: entry.id, errors: [`pack: no se pudo instalar ${entry.id}`] });
        }
      }
      if (summary.installed.length > 0) invalidateIndex();
      return summary;
    } catch {
      return summary;
    }
  }

  // Clave de memoización: el conjunto `(packId, packVersion, packHash)`
  // instalado (B13: el hash es obligatorio porque el contenido puede cambiar
  // con la misma versión ante una reinstalación directa fuera de `sync`).
  // Si no cambió, devuelve el índice ya construido sin releer contenidos.
  async function buildIndex(): Promise<LegalIndex> {
    const metas = [...(await store.listInstalled())].sort((a, b) => compareStrings(a.id, b.id));
    const key = metas.map((meta) => `${meta.id}@${meta.version}@${meta.hash}`).join(',');
    if (cachedIndex !== null && key === cachedKey) return cachedIndex;
    const packs: LegalPack[] = [];
    for (const meta of metas) {
      const pack = await store.get(meta.id);
      if (pack !== null) packs.push(pack);
    }
    const index = buildLegalIndex(packs);
    cachedIndex = index;
    cachedKey = key;
    return index;
  }

  // Comparte la construcción en vuelo (llamadas concurrentes no duplican
  // trabajo); al terminar libera el pendiente para que el próximo llamado
  // revalide la clave `(packId, packVersion, packHash)` antes de reusar el memo.
  async function ensureIndex(): Promise<LegalIndex> {
    if (pending !== null) return pending;
    try {
      pending = buildIndex();
      return await pending;
    } finally {
      pending = null;
    }
  }

  // Índice memoizado para consumidores que ya llamaron a `ensureIndex`;
  // `null` si todavía no se construyó ninguno.
  function getIndex(): LegalIndex | null {
    return cachedIndex;
  }

  function listInstalled(): Promise<InstalledPack[]> {
    return store.listInstalled();
  }

  return { syncFromManifest, ensureIndex, getIndex, listInstalled };
}

/** Comparación estable de strings (sin `localeCompare`, independiente del entorno). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
