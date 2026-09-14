// ---------------------------------------------------------------------------
// Recuperación léxica BM25 propia (offline, determinista) sobre packs legales.
// Puro y sin dependencias: no importa adapters/features/app ni usa IO.
// Incluye normalización de acentos, stopwords, sufijos livianos y
// canonicalización de abreviaturas jurídicas y aliases de norma.
// ---------------------------------------------------------------------------

import type {
  LegalIndex,
  LegalNorm,
  LegalPack,
  LegalPassage,
  LegalProvision,
} from '../types/legal';

/** Parámetros clásicos de BM25 (k1 suaviza la saturacion de tf, b el largo). */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Peso del match estructural exacto (norma + articulo) detectado en la consulta. */
const NORM_ARTICLE_BOOST = 10;
/** Peso por cada token de la consulta presente en tags/aliases/sinonimos del pack. */
const TAG_ALIAS_BOOST = 1.5;

// ---------------------------------------------------------------------------
// Léxico curado: stopwords, abreviaturas, aliases de norma y variantes legales.
// Todo en minúsculas y sin acentos (espacio de tokens plegados).
// ---------------------------------------------------------------------------

/** Stopwords del español; no incluye términos con carga jurídica (`ley`, `plazo`). */
const BASE_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'al',
  'algo',
  'ante',
  'bajo',
  'como',
  'con',
  'contra',
  'cual',
  'cuales',
  'cuando',
  'de',
  'del',
  'desde',
  'donde',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'entre',
  'era',
  'es',
  'esa',
  'ese',
  'eso',
  'esos',
  'esta',
  'estas',
  'este',
  'esto',
  'estos',
  'fue',
  'ha',
  'han',
  'hasta',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'me',
  'mi',
  'mis',
  'mucho',
  'muy',
  'ni',
  'no',
  'nos',
  'o',
  'os',
  'otra',
  'otro',
  'para',
  'pero',
  'por',
  'pues',
  'que',
  'quien',
  'quienes',
  'se',
  'ser',
  'si',
  'sin',
  'sobre',
  'son',
  'su',
  'sus',
  'tal',
  'tan',
  'te',
  'tras',
  'tu',
  'tus',
  'u',
  'un',
  'una',
  'unas',
  'uno',
  'unos',
  'y',
]);

/** Abreviaturas de artículo que colapsan al token canónico `art`. */
const ART_ALIASES: ReadonlySet<string> = new Set([
  'art',
  'arts',
  'arto',
  'artos',
  'articulo',
  'articulos',
]);

/**
 * Aliases de norma de un solo token → `normId` canónico. Los valores identidad
 * se listan igual para dejar explícito el léxico y servir de documentación.
 */
const NORM_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  ['ccyc', 'ccyc'],
  ['cccn', 'ccyc'],
  ['cpccn', 'cpccn'],
  ['cpcc', 'cpccn'],
  ['lgs', 'lgs'],
  ['lcq', 'lcq'],
  ['ldc', 'ldc'],
  ['cp', 'cp'],
]);

/**
 * Aliases de norma multi-token → `normId` canónico. Las claves están en el
 * espacio de tokens plegados (incluyen stopwords tal como aparecen).
 */
const NORM_PHRASES: ReadonlyMap<string, string> = new Map<string, string>([
  ['codigo civil y comercial', 'ccyc'],
  ['codigo civil y comercial de la nacion', 'ccyc'],
  ['ley 26994', 'ccyc'],
  ['codigo procesal civil y comercial de la nacion', 'cpccn'],
  ['ley 24240', 'ldc'],
  ['ley 19550', 'lgs'],
  ['ley 24522', 'lcq'],
]);

/** Variantes morfológicas no cubiertas por sufijos → token canónico. */
const LEGAL_SYNONYMS: ReadonlyMap<string, string> = new Map<string, string>([
  ['prescribe', 'prescripcion'],
  ['prescriben', 'prescripcion'],
  ['prescribir', 'prescripcion'],
  ['prescripto', 'prescripcion'],
  ['prescripta', 'prescripcion'],
  ['prescriptivo', 'prescripcion'],
  ['prescriptiva', 'prescripcion'],
]);

/** Cantidad máxima de tokens de una frase de norma (para el ventaneo). */
const MAX_PHRASE_TOKENS = Math.max(
  ...[...NORM_PHRASES.keys()].map((phrase) => phrase.split(' ').length),
);

// ---------------------------------------------------------------------------
// Normalización de texto.
// ---------------------------------------------------------------------------

/** Pliega acentos (NFD + strip de diacríticos) y baja a minúsculas, sin separar. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Token crudo: pliega, separa por no alfanumérico y descarta vacíos. */
function foldAndSplit(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Limpia un token individual a `[a-z0-9]`. */
function cleanToken(token: string): string {
  return fold(token).replace(/[^a-z0-9]/g, '');
}

/** `true` si el caracter (en la posición dada) es vocal simple. */
function isVowel(char: string): boolean {
  return char === 'a' || char === 'e' || char === 'i' || char === 'o' || char === 'u';
}

/**
 * Sufijos livianos (deliberadamente conservadores para no sobre-stemmear):
 *  - `-ciones` → `-cion` (prescripciones → prescripcion)
 *  - `-dades`  → `-dad`  (responsabilidades → responsabilidad)
 *  - `-mente`  → se descarta (solidariamente → solidaria)
 *  - plural `-es` (leyes → ley) cuando la raíz conserva al menos 3 letras
 *  - plural `-s` tras vocal (plazos → plazo) cuando la raíz conserva al menos 3 letras
 */
function normalizeSuffix(token: string): string {
  if (token.length >= 7 && token.endsWith('ciones')) return token.slice(0, -2);
  if (token.length >= 6 && token.endsWith('dades')) return token.slice(0, -2);
  if (token.length >= 8 && token.endsWith('mente')) return token.slice(0, -5);
  if (token.length >= 5 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length >= 4 && token.endsWith('s') && isVowel(token.charAt(token.length - 2))) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Canonicaliza abreviaturas jurídicas de un token ya separado: `art`/`arts`/
 * `articulo`/`articulos` → `art`, y aliases de norma (`cccn` → `ccyc`).
 * No aplica sufijos ni stopwords: es la capa de abreviaturas.
 */
export function canonicalizeAbbrev(token: string): string {
  const clean = cleanToken(token);
  if (ART_ALIASES.has(clean)) return 'art';
  return NORM_ALIASES.get(clean) ?? clean;
}

/**
 * Normaliza un token individual: abreviaturas, aliases de norma, sufijos
 * livianos y variantes legales. No filtra stopwords (lo hace `tokenizeLegal`).
 */
export function normalizeToken(token: string): string {
  const clean = cleanToken(token);
  if (clean.length === 0) return '';
  if (ART_ALIASES.has(clean)) return 'art';
  const alias = NORM_ALIASES.get(clean);
  if (alias !== undefined) return alias;
  const stem = normalizeSuffix(clean);
  return LEGAL_SYNONYMS.get(stem) ?? stem;
}

/**
 * Colapsa frases de norma conocidas (p. ej. `codigo civil y comercial`) al
 * `normId` canónico. Ventaneo greedy de mayor a menor cantidad de tokens.
 */
function canonicalizePhrases(tokens: string[]): string[] {
  const output: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const remaining = tokens.length - index;
    const widest = Math.min(MAX_PHRASE_TOKENS, remaining);
    let consumed = 0;
    for (let size = widest; size >= 2; size -= 1) {
      const phrase = tokens.slice(index, index + size).join(' ');
      const canonical = NORM_PHRASES.get(phrase);
      if (canonical !== undefined) {
        output.push(canonical);
        consumed = size;
        break;
      }
    }
    if (consumed === 0) {
      output.push(tokens[index] ?? '');
      index += 1;
    } else {
      index += consumed;
    }
  }
  return output;
}

/** Arma el set de stopwords base más las extra indicadas por opciones. */
function buildStopwords(extra?: readonly string[]): ReadonlySet<string> {
  if (extra === undefined || extra.length === 0) return BASE_STOPWORDS;
  const merged = new Set(BASE_STOPWORDS);
  for (const word of extra) {
    for (const token of foldAndSplit(word)) merged.add(token);
  }
  return merged;
}

/**
 * Tokeniza un texto para retrieval léxico: minúsculas + plegado de acentos,
 * colapso de frases de norma, descarte de stopwords, abreviaturas y sufijos.
 */
export function tokenizeLegal(text: string): string[] {
  return tokenizeWith(text, BASE_STOPWORDS);
}

/** Igual que `tokenizeLegal` pero con un set de stopwords ampliado. */
function tokenizeWith(text: string, stopwords: ReadonlySet<string>): string[] {
  const tokens = canonicalizePhrases(foldAndSplit(text));
  const output: string[] = [];
  for (const token of tokens) {
    if (token.length === 0 || stopwords.has(token)) continue;
    const normalized = normalizeToken(token);
    if (normalized.length === 0) continue;
    output.push(normalized);
  }
  return output;
}

// ---------------------------------------------------------------------------
// Índice en memoria.
// ---------------------------------------------------------------------------

/** Documento indexado: provisión + bolsa de términos y sets de boost. */
interface IndexedDoc {
  readonly provision: LegalProvision;
  readonly packId: string;
  readonly packVersion: string;
  readonly terms: Map<string, number>;
  readonly length: number;
  readonly normTokens: Set<string>;
  readonly boostTokens: Set<string>;
  readonly articleNumber: string;
}

/** Opciones de construcción del índice. */
export interface BuildLegalIndexOptions {
  /** Stopwords adicionales para este índice (se pliegan antes de comparar). */
  extraStopwords?: readonly string[];
}

/** Canonicaliza un `normId` a la clave interna (plegado + alias de norma). */
function canonicalNormId(normId: string): string {
  const clean = cleanToken(normId);
  return NORM_ALIASES.get(clean) ?? clean;
}

/** Canonicaliza un artículo a la clave interna (tokens normalizados). */
function canonicalArticle(article: string): string {
  return tokenizeLegal(article).join(' ');
}

/** Clave única de provisión en el índice. */
function provisionKey(normId: string, article: string): string {
  return `${canonicalNormId(normId)}::${canonicalArticle(article)}`;
}

/** Primer bloque numérico de un artículo (`52 bis` → `52`; `2560` → `2560`). */
function extractArticleNumber(article: string): string {
  const match = /\d+/.exec(article);
  return match === null ? '' : match[0];
}

/** Agrega a `target` los tokens normalizados de cada parte indicada. */
function collectTokens(
  target: Set<string>,
  parts: readonly string[],
  stopwords: ReadonlySet<string>,
): void {
  for (const part of parts) {
    for (const token of tokenizeWith(part, stopwords)) target.add(token);
  }
}

/** Construye el documento indexado de una provisión y su norma. */
function indexProvision(
  provision: LegalProvision,
  norm: LegalNorm | undefined,
  pack: LegalPack,
  stopwords: ReadonlySet<string>,
): IndexedDoc {
  const normTokens = new Set<string>();
  const normParts: string[] = [provision.normId];
  if (norm !== undefined) {
    normParts.push(norm.id, norm.short, norm.long);
    if (norm.aliases !== undefined) normParts.push(...norm.aliases);
  }
  collectTokens(normTokens, normParts, stopwords);

  const tagTokens = new Set<string>();
  collectTokens(tagTokens, provision.tags, stopwords);
  collectTokens(tagTokens, provision.synonyms ?? [], stopwords);

  const bagParts: string[] = [provision.article];
  if (provision.title !== undefined) bagParts.push(provision.title);
  bagParts.push(provision.text);
  if (norm !== undefined) {
    bagParts.push(norm.short, norm.long);
    if (norm.aliases !== undefined) bagParts.push(...norm.aliases);
  }
  if (provision.synonyms !== undefined) bagParts.push(...provision.synonyms);
  bagParts.push(...provision.tags);

  const tokens = tokenizeWith(bagParts.join(' '), stopwords);
  const terms = new Map<string, number>();
  for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);

  const boostTokens = new Set<string>([...normTokens, ...tagTokens]);
  return {
    provision,
    packId: pack.id,
    packVersion: pack.version,
    terms,
    length: tokens.length,
    normTokens,
    boostTokens,
    articleNumber: extractArticleNumber(provision.article),
  };
}

/** Comparación estable de strings (sin `localeCompare`, independiente del entorno). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Extrae el conjunto de números de artículo mencionados en la consulta. */
function queryArticleNumbers(queryTokens: readonly string[]): Set<string> {
  const numbers = new Set<string>();
  for (const token of queryTokens) {
    const match = /\d+/.exec(token);
    if (match !== null) numbers.add(match[0]);
  }
  return numbers;
}

/**
 * Rankea las provisiones con BM25 (k1=1.2, b=0.75) y boosts por match
 * estructural norma+artículo y por tags/aliases/sinónimos. Ordena por score
 * descendente y, ante empate, por `id` de provisión (determinista).
 */
function rank(
  docs: readonly IndexedDoc[],
  documentFreq: ReadonlyMap<string, number>,
  documentCount: number,
  averageLength: number,
  query: string,
  limit: number,
  stopwords: ReadonlySet<string>,
): LegalPassage[] {
  if (documentCount === 0 || averageLength <= 0 || !Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const queryTokens = tokenizeWith(query, stopwords);
  if (queryTokens.length === 0) return [];

  const queryFreq = new Map<string, number>();
  for (const token of queryTokens) queryFreq.set(token, (queryFreq.get(token) ?? 0) + 1);
  const queryTerms = [...queryFreq.keys()];
  const articleNumbers = queryArticleNumbers(queryTokens);

  const ranked: LegalPassage[] = [];
  for (const doc of docs) {
    let bm25 = 0;
    for (const term of queryTerms) {
      const frequency = doc.terms.get(term);
      if (frequency === undefined || frequency === 0) continue;
      const df = documentFreq.get(term) ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / averageLength));
      bm25 += (idf * (frequency * (BM25_K1 + 1))) / denominator;
    }

    let boost = 0;
    if (doc.articleNumber.length > 0 && articleNumbers.has(doc.articleNumber)) {
      for (const normToken of doc.normTokens) {
        if (queryFreq.has(normToken)) {
          boost += NORM_ARTICLE_BOOST;
          break;
        }
      }
    }
    for (const term of queryTerms) {
      if (doc.boostTokens.has(term)) boost += TAG_ALIAS_BOOST;
    }

    const score = bm25 + boost;
    if (score <= 0) continue;
    ranked.push({
      provision: doc.provision,
      score,
      packId: doc.packId,
      packVersion: doc.packVersion,
    });
  }

  ranked.sort((a, b) => b.score - a.score || compareStrings(a.provision.id, b.provision.id));
  return ranked.slice(0, Math.floor(limit));
}

/**
 * Construye un índice léxico en memoria e idempotente. Acepta 0 packs y packs
 * duplicados: la primera aparición de cada `pack.id` y de cada
 * `(normId, article)` gana; los duplicados no generan resultados repetidos.
 */
export function buildLegalIndex(
  packs: readonly LegalPack[],
  options: BuildLegalIndexOptions = {},
): LegalIndex {
  const stopwords = buildStopwords(options.extraStopwords);
  const versionByPack = new Map<string, string>();
  const docByKey = new Map<string, IndexedDoc>();
  const docs: IndexedDoc[] = [];

  for (const pack of packs) {
    if (versionByPack.has(pack.id)) continue;
    versionByPack.set(pack.id, pack.version);

    const normById = new Map<string, LegalNorm>();
    for (const norm of pack.norms) normById.set(norm.id, norm);

    for (const provision of pack.provisions) {
      const key = provisionKey(provision.normId, provision.article);
      if (docByKey.has(key)) continue;
      const doc = indexProvision(provision, normById.get(provision.normId), pack, stopwords);
      docByKey.set(key, doc);
      docs.push(doc);
    }
  }

  const documentFreq = new Map<string, number>();
  let totalLength = 0;
  for (const doc of docs) {
    totalLength += doc.length;
    for (const term of doc.terms.keys()) {
      documentFreq.set(term, (documentFreq.get(term) ?? 0) + 1);
    }
  }
  const documentCount = docs.length;
  const averageLength = documentCount > 0 ? totalLength / documentCount : 0;
  const versions = Object.freeze(Object.fromEntries(versionByPack));

  return {
    versions,
    size: docs.length,
    has(normId: string, article: string): boolean {
      return docByKey.has(provisionKey(normId, article));
    },
    get(normId: string, article: string): LegalProvision | null {
      return docByKey.get(provisionKey(normId, article))?.provision ?? null;
    },
    search(query: string, limit: number): LegalPassage[] {
      return rank(docs, documentFreq, documentCount, averageLength, query, limit, stopwords);
    },
  };
}

/** Busca pasajes sobre un índice ya construido (delega en `index.search`). */
export function searchLegalPassages(
  index: LegalIndex,
  query: string,
  limit: number,
): LegalPassage[] {
  return index.search(query, limit);
}

/**
 * Estima tokens a partir de los bytes UTF-8 reales: `ceil(bytes / 3)`.
 * Se usa `/3` y no `/4` porque subestima el español y el texto jurídico.
 * Los acentos y la `ñ` cuentan 2 bytes.
 */
export function estimateLegalTokens(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return Math.ceil(bytes / 3);
}
