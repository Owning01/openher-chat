// ---------------------------------------------------------------------------
// Carga de packs legales por HTTP: manifiesto + packs con verificación de
// integridad. Sin dependencias y sin lanzar por contenido inválido: lo que no
// verifica degrada a `null`/`errors` (los fallos de transporte del
// `HttpClient` también se capturan y degradan).
// ---------------------------------------------------------------------------

import { sha256Hex, type Hasher } from '@/domain/legal/hash';
import { parseLegalPack } from '@/domain/legal/packs';
import type { HttpClient } from '@/domain/ports/HttpClient';
import type { LegalPack } from '@/domain/types/legal';
import { verifyPack } from './packVerifier';

/** Entrada del manifiesto (`public/legal/packs/index.json`, formato T16). */
export interface LegalPackManifestEntry {
  id: string;
  version: string;
  hash: string;
  url: string;
  available: boolean;
  bytes: number;
}

/** Manifiesto de packs publicados. */
export interface LegalPackManifest {
  schema: 'openher.legal.packs/1';
  packs: LegalPackManifestEntry[];
}

/** Opciones de carga; hasher y reloj inyectables para tests deterministas. */
export interface PackLoaderOptions {
  hasher?: Hasher;
  now?: () => number;
  timeoutMs?: number;
}

/** Opciones de descarga de un pack (suma el hash esperado del manifiesto). */
export interface FetchPackOptions extends PackLoaderOptions {
  /**
   * Hash declarado por el manifiesto para este pack. Si se indica y difiere
   * del `hash` verificado del contenido, el pack se rechaza aunque su firma
   * interna sea válida (liga el manifiesto con el contenido).
   */
  expectedHash?: string;
}

/** Resultado de descargar y verificar un pack; nunca lanza. */
export interface FetchPackResult {
  pack: LegalPack | null;
  errors: string[];
  /** Largo en caracteres del cuerpo recibido (respaldo para `bytes` al instalar). */
  bytes: number;
}

/**
 * URL de pedido del manifiesto con cache-buster temporal (`?t=<ahora>`).
 * Por qué: `public/sw.js` cachea los assets same-origin, así que sin un
 * parámetro que cambie en cada lectura el manifiesto quedaría pegado en la
 * caché y el corpus nunca se actualizaría sin reinstalar la PWA.
 */
export function manifestRequestUrl(url: string, now: () => number = Date.now): string {
  return withQueryParam(url, 't', String(now()));
}

/**
 * URL de pedido de un pack con cache-buster por versión (`?v=<hash>`).
 * El hash cambia con cada versión, así que cada versión tiene una URL única:
 * el service worker y la caché HTTP pueden cachear agresivo sin riesgo de
 * servir un pack viejo. Sin hash conocido se devuelve la URL tal cual.
 */
export function packRequestUrl(url: string, hash?: string): string {
  if (hash === undefined || hash === '') return url;
  return withQueryParam(url, 'v', hash);
}

/** Agrega (o encadena con `&`) un parámetro de consulta a la URL. */
function withQueryParam(url: string, name: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${name}=${encodeURIComponent(value)}`;
}

/**
 * Descarga y valida el manifiesto con el `HttpClient` inyectado (sin `fetch`
 * directo). Degrada a `null` ante cualquier fallo: red, HTTP no 2xx, JSON
 * inválido o forma inesperada. Nunca lanza.
 */
export async function loadManifest(
  http: HttpClient,
  url: string,
  options: PackLoaderOptions = {},
): Promise<LegalPackManifest | null> {
  try {
    const response = await http.request({
      url: manifestRequestUrl(url, options.now ?? Date.now),
      method: 'GET',
      timeoutMs: options.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) return null;
    return parseManifest(response.text);
  } catch {
    return null;
  }
}

/**
 * Descarga un pack y lo verifica en dos capas: `parseLegalPack` con
 * `verifyTextHashes` (forma + `textHash` de cada provisión) y `verifyPack`
 * (hash del canon + `textHash`). Degrada a `{ pack: null, errors }` ante
 * cualquier fallo. Nunca lanza.
 */
export async function fetchAndVerifyPack(
  http: HttpClient,
  url: string,
  options: FetchPackOptions = {},
): Promise<FetchPackResult> {
  const hasher = options.hasher ?? sha256Hex;
  try {
    const response = await http.request({ url, method: 'GET', timeoutMs: options.timeoutMs });
    const bytes = response.text.length;
    if (response.status < 200 || response.status >= 300) {
      return { pack: null, errors: [`pack: HTTP ${response.status} al descargar ${url}`], bytes };
    }
    const parsed = parseLegalPack(response.text, { verifyTextHashes: true, hasher });
    if (parsed === null) {
      return {
        pack: null,
        errors: [`pack: contenido inválido o con textHash corrupto (${url})`],
        bytes,
      };
    }
    const verification = verifyPack(parsed, { hasher });
    if (!verification.ok) {
      return { pack: null, errors: verification.errors, bytes };
    }
    if (options.expectedHash !== undefined && parsed.hash !== options.expectedHash) {
      return {
        pack: null,
        errors: [
          `hash: el manifiesto declara ${options.expectedHash} pero el pack verificado es ${parsed.hash}`,
        ],
        bytes,
      };
    }
    return { pack: parsed, errors: [], bytes };
  } catch {
    return { pack: null, errors: [`pack: no se pudo descargar (${url})`], bytes: 0 };
  }
}

/** Valida la forma del manifiesto; `null` si algo no cumple (fail-closed). */
function parseManifest(text: string): LegalPackManifest | null {
  try {
    const value: unknown = JSON.parse(text) as unknown;
    if (!isRecord(value)) return null;
    if (value.schema !== 'openher.legal.packs/1') return null;
    if (!Array.isArray(value.packs)) return null;
    const packs: LegalPackManifestEntry[] = [];
    for (const entry of value.packs) {
      const parsed = parseManifestEntry(entry);
      if (parsed === null) return null;
      packs.push(parsed);
    }
    return { schema: 'openher.legal.packs/1', packs };
  } catch {
    return null;
  }
}

/** Valida una entrada del manifiesto (`available` ausente = disponible). */
function parseManifestEntry(raw: unknown): LegalPackManifestEntry | null {
  if (!isRecord(raw)) return null;
  const { id, version, hash, url, available, bytes } = raw;
  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(version) ||
    !isNonEmptyString(hash) ||
    !isNonEmptyString(url)
  ) {
    return null;
  }
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  const availableFlag = available === undefined ? true : available;
  if (typeof availableFlag !== 'boolean') return null;
  return { id, version, hash, url, available: availableFlag, bytes };
}

// Guardas mínimas locales (`domain` no las exporta y no se agregan dependencias).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
