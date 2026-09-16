/**
 * Registry de tools legales (`legal_search`, `cite_article`) sobre el índice
 * léxico del corpus instalado. Los errores se devuelven como `ToolResult`
 * (nunca lanzan hacia el agent loop) y la cita siempre sale del pack.
 *
 * El filtrado "solo en modo legal" lo hace el caller: este registry siempre
 * expone ambas tools y T19 lo compone con `composeToolRegistries` según el
 * `legalCaseId` de la conversación.
 */
import { truncateText } from '@/domain/chat/truncateText';
import { searchLegalPassages } from '@/domain/legal/retrieval';
import type { ToolResult } from '@/domain/types/chat';
import type {
  LegalIndex,
  LegalJurisdiction,
  LegalPassage,
  LegalProvision,
} from '@/domain/types/legal';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { ToolExecutionError } from '../errors';

export const LEGAL_SEARCH_TOOL_NAME = 'legal_search';
export const CITE_ARTICLE_TOOL_NAME = 'cite_article';
export const LEGAL_SEARCH_TIMEOUT_MS = 10_000;
export const CITE_ARTICLE_TIMEOUT_MS = 10_000;
export const LEGAL_SEARCH_MAX_RESULT_CHARS = 6_000;
export const CITE_ARTICLE_MAX_RESULT_CHARS = 6_000;

/** Límite de pasajes por defecto cuando no se indica `limit`. */
const DEFAULT_SEARCH_LIMIT = 5;
/** Cota superior de pasajes por llamada (igual que `web_search`). */
const MAX_SEARCH_LIMIT = 10;

/** Jurisdicciones aceptadas en el filtro opcional de `legal_search`. */
const LEGAL_JURISDICTIONS: readonly LegalJurisdiction[] = [
  'national',
  'caba',
  'pba',
  'cordoba',
  'tucuman',
];

/** Vista mínima del corpus que necesitan las tools (sin acoplar `LegalCorpus`). */
export interface LegalToolCorpus {
  ensureIndex(): Promise<LegalIndex>;
  getIndex(): LegalIndex | null;
}

/** Entrada del gap report local (la persiste el caller, acá sólo se notifica). */
export interface LegalGapEntry {
  query: string;
  missingNorm?: string;
  missingArticle?: string;
}

/** Deps propias de las tools legales (no tocan `ToolRegistryDeps`, congelado). */
export interface LegalToolDeps {
  corpus: LegalToolCorpus;
  reportGap?: (entry: LegalGapEntry) => void;
  now?: () => number;
}

/**
 * Crea el registry con las tools legales. No filtra por modo: el caller
 * decide cuándo exponerlo (T19).
 */
export function createLegalToolRegistry(deps: LegalToolDeps): ToolRegistry {
  const now = deps.now ?? Date.now;
  const legalSearch = createLegalSearchTool(deps, now);
  const citeArticle = createCiteArticleTool(deps, now);
  return {
    list: () => [legalSearch, citeArticle],
    get: (name: string): ToolDefinition | undefined => {
      if (name === legalSearch.name) return legalSearch;
      if (name === citeArticle.name) return citeArticle;
      return undefined;
    },
  };
}

function createLegalSearchTool(deps: LegalToolDeps, now: () => number): ToolDefinition {
  return {
    name: LEGAL_SEARCH_TOOL_NAME,
    description:
      'Search the installed Argentine legal corpus (civil and commercial). Returns matching provisions with their citation (norm, article, pack version) and text for human verification.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Legal question or keywords. Include the norm or article number when known.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of passages to return (1-10). Defaults to 5.',
        },
        jurisdiction: {
          type: 'string',
          enum: ['national', 'caba', 'pba', 'cordoba', 'tucuman'],
          description: 'Filter passages by jurisdiction. Omit to search all jurisdictions.',
        },
      },
      required: ['query'],
    },
    timeoutMs: LEGAL_SEARCH_TIMEOUT_MS,
    maxResultChars: LEGAL_SEARCH_MAX_RESULT_CHARS,
    async execute(args, context) {
      void context;
      const startedAt = now();
      try {
        // Los args se validan antes de tocar el índice/corpus.
        const record = ensureRecord(args);
        const query = readStringArg(record, 'query');
        if (query === null) {
          throw new ToolExecutionError(
            'invalid_args',
            'The "query" argument is required and must be a non-empty string.',
          );
        }
        const limit = readSearchLimit(record);
        const jurisdiction = readJurisdictionArg(record);
        const index = await loadIndex(deps);
        const passages = safeSearch(index, query, limit);
        const filtered =
          jurisdiction === null
            ? passages
            : passages.filter((passage) => passage.provision.jurisdiction === jurisdiction);
        if (filtered.length === 0) {
          notifyGap(deps, { query });
          const result: ToolResult = {
            ok: true,
            content:
              `No legal passages found for "${query}" in the installed corpus. ` +
              `Try rephrasing the query with different terms, synonyms, or an article number.`,
            durationMs: Math.max(0, now() - startedAt),
          };
          return withLimit(result, LEGAL_SEARCH_MAX_RESULT_CHARS);
        }
        const result: ToolResult = {
          ok: true,
          content: filtered
            .map((passage, position) => formatPassage(passage, position + 1))
            .join('\n\n'),
          durationMs: Math.max(0, now() - startedAt),
        };
        return withLimit(result, LEGAL_SEARCH_MAX_RESULT_CHARS);
      } catch (error) {
        return mapLegalError(error, now, startedAt);
      }
    },
  };
}

function createCiteArticleTool(deps: LegalToolDeps, now: () => number): ToolDefinition {
  return {
    name: CITE_ARTICLE_TOOL_NAME,
    description:
      'Return the verbatim text of a single article from the installed legal corpus. Use it to verify a citation before quoting it.',
    parameters: {
      type: 'object',
      properties: {
        norm: {
          type: 'string',
          description: 'Norm identifier, e.g. "CCyC", "CPCCN" or "LDC".',
        },
        article: {
          type: 'string',
          description: 'Article number as stored in the pack, e.g. "2560" or "52 bis".',
        },
      },
      required: ['norm', 'article'],
    },
    timeoutMs: CITE_ARTICLE_TIMEOUT_MS,
    maxResultChars: CITE_ARTICLE_MAX_RESULT_CHARS,
    async execute(args, context) {
      void context;
      const startedAt = now();
      try {
        // Los args se validan antes de tocar el índice/corpus.
        const record = ensureRecord(args);
        const norm = readStringArg(record, 'norm');
        if (norm === null) {
          throw new ToolExecutionError(
            'invalid_args',
            'The "norm" argument is required and must be a non-empty string.',
          );
        }
        const article = readStringArg(record, 'article');
        if (article === null) {
          throw new ToolExecutionError(
            'invalid_args',
            'The "article" argument is required and must be a non-empty string.',
          );
        }
        const index = await loadIndex(deps);
        const provision = safeGet(index, norm, article);
        if (provision === null) {
          notifyGap(deps, { query: `${norm} ${article}`, missingNorm: norm, missingArticle: article });
          const result: ToolResult = {
            ok: true,
            content:
              `Article "${article}" of norm "${norm}" was not found in the installed corpus. ` +
              `Search for it with legal_search or rephrase the citation.`,
            durationMs: Math.max(0, now() - startedAt),
          };
          return withLimit(result, CITE_ARTICLE_MAX_RESULT_CHARS);
        }
        const provenance = resolveProvenance(index, provision);
        const result: ToolResult = {
          ok: true,
          content: formatProvision(provision, provenance.packId, provenance.packVersion),
          durationMs: Math.max(0, now() - startedAt),
        };
        return withLimit(result, CITE_ARTICLE_MAX_RESULT_CHARS);
      } catch (error) {
        return mapLegalError(error, now, startedAt);
      }
    },
  };
}

/** Normaliza los args a registro; lo que no es objeto es arg malformado. */
function ensureRecord(args: unknown): Record<string, unknown> {
  if (typeof args === 'object' && args !== null) return args as Record<string, unknown>;
  throw new ToolExecutionError('invalid_args', 'Tool arguments must be an object.');
}

/** Lee un string no vacío (recortado) o `null` si falta o no es string. */
function readStringArg(args: Record<string, unknown>, key: string): string | null {
  const value: unknown = args[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Lee `limit` con default y clamp 1-10; lo no entero es `invalid_args`. */
function readSearchLimit(args: Record<string, unknown>): number {
  const raw: unknown = args.limit;
  if (raw === undefined || raw === null) return DEFAULT_SEARCH_LIMIT;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new ToolExecutionError('invalid_args', 'The "limit" argument must be an integer between 1 and 10.');
  }
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, raw));
}

/** Lee el filtro opcional de jurisdicción; valor desconocido es `invalid_args`. */
function readJurisdictionArg(args: Record<string, unknown>): LegalJurisdiction | null {
  const raw: unknown = args.jurisdiction;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    for (const candidate of LEGAL_JURISDICTIONS) {
      if (candidate === trimmed) return candidate;
    }
  }
  throw new ToolExecutionError(
    'invalid_args',
    'The "jurisdiction" argument must be one of: national, caba, pba, cordoba, tucuman.',
  );
}

/** Carga el índice; cualquier fallo interno degrada a `parse_error`, nunca throw. */
async function loadIndex(deps: LegalToolDeps): Promise<LegalIndex> {
  try {
    const index = await deps.corpus.ensureIndex();
    if (index === null || index === undefined) {
      throw new ToolExecutionError('parse_error', 'The legal index is not available yet. Try again later.');
    }
    return index;
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    throw new ToolExecutionError('parse_error', 'The legal index failed. Try again later.');
  }
}

/** Búsqueda tolerante: si el índice lanza, degrada a `parse_error`. */
function safeSearch(index: LegalIndex, query: string, limit: number): LegalPassage[] {
  try {
    const passages = searchLegalPassages(index, query, limit);
    return Array.isArray(passages) ? passages : [];
  } catch {
    throw new ToolExecutionError('parse_error', 'The legal search failed. Try again later.');
  }
}

/** Lectura puntual tolerante: si el índice lanza, degrada a `parse_error`. */
function safeGet(index: LegalIndex, norm: string, article: string): LegalProvision | null {
  try {
    return index.get(norm, article);
  } catch {
    throw new ToolExecutionError('parse_error', 'The legal lookup failed. Try again later.');
  }
}

/**
 * Resuelve la procedencia del pack para una provisión puntual: primero por
 * `search` (match exacto de `id`), con respaldo en el mapa `versions`.
 */
function resolveProvenance(
  index: LegalIndex,
  provision: LegalProvision,
): { packId: string; packVersion: string } {
  try {
    const hits = index.search(`${provision.normId} ${provision.article}`, 10);
    if (Array.isArray(hits)) {
      const exact = hits.find((hit) => hit.provision.id === provision.id);
      if (exact !== undefined) return { packId: exact.packId, packVersion: exact.packVersion };
      const same = hits.find(
        (hit) =>
          hit.provision.normId === provision.normId &&
          hit.provision.article === provision.article,
      );
      if (same !== undefined) return { packId: same.packId, packVersion: same.packVersion };
    }
  } catch {
    // Cae al respaldo de `versions` (no lanza hacia el loop).
  }
  try {
    const entries = Object.entries(index.versions);
    if (entries.length === 1) {
      const only = entries[0];
      if (only !== undefined) {
        const [packId, packVersion] = only;
        if (typeof packId === 'string' && typeof packVersion === 'string') {
          return { packId, packVersion };
        }
      }
    }
  } catch {
    // Sin procedencia disponible (se informa como desconocida).
  }
  return { packId: '', packVersion: '' };
}

/** Formatea un pasaje con su cita (norma + artículo + pack) y texto verificable. */
function formatPassage(passage: LegalPassage, position: number): string {
  return formatProvision(passage.provision, passage.packId, passage.packVersion, position);
}

/** Formatea una provisión con su cita y fuente oficial para cotejo humano. */
function formatProvision(
  provision: LegalProvision,
  packId: string,
  packVersion: string,
  position?: number,
): string {
  const prefix = position === undefined ? '' : `[${position}] `;
  const pack = packId !== '' && packVersion !== '' ? ` (pack: ${packId}@${packVersion})` : ' (pack: unknown)';
  const lines = [`${prefix}${provision.normId} art. ${provision.article}${pack}`];
  if (provision.title !== undefined && provision.title.trim() !== '') {
    lines.push(`Title: ${provision.title.trim()}`);
  }
  lines.push(provision.text);
  lines.push(`Source: ${provision.sourceUrl} (${provision.sourceDate})`);
  return lines.join('\n');
}

/** Notifica el gap sin romper el turno: el reporte nunca lanza. */
function notifyGap(deps: LegalToolDeps, entry: LegalGapEntry): void {
  if (deps.reportGap === undefined) return;
  try {
    deps.reportGap(entry);
  } catch {
    // El gap report es observabilidad local; un fallo no afecta el resultado.
  }
}

/** Traduce errores a `ToolResult`: `invalid_args` se preserva, el resto es `parse_error`. */
function mapLegalError(error: unknown, now: () => number, startedAt: number): ToolResult {
  const durationMs = Math.max(0, now() - startedAt);
  if (error instanceof ToolExecutionError) {
    return { ok: false, content: error.message, error: { code: error.code, message: error.message }, durationMs };
  }
  const message = error instanceof Error ? error.message : 'The legal tool failed. Try again later.';
  return { ok: false, content: message, error: { code: 'parse_error', message }, durationMs };
}

function withLimit(result: ToolResult, maxResultChars: number): ToolResult {
  return { ...result, content: truncateText(result.content, maxResultChars) };
}
