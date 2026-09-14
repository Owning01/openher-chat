// ---------------------------------------------------------------------------
// Citation guard: detección, verificación de existencia y fidelidad verbatim.
//
// Módulo PURO: no importa adapters/features/app, no tiene IO y nunca lanza.
// La función recibe el `LegalIndex` ya construido; no lo crea ni lo muta.
//
// Garantía central (invariante T04): una cita normativa sólo puede quedar
// `verified` si la provisión existe realmente en el índice entregado. Fallos,
// doctrina y expedientes son SIEMPRE `unverified` (la herramienta no
// redistribuye ni valida jurisprudencia ni doctrina).
//
// Decisiones documentadas:
// - `CitationRef.article` se normaliza a SÓLO DÍGITOS: se descartan puntos,
//   espacios e `inc./párr./apart.` del campo; los ordinales (`bis`/`ter`/...
//   ) no se pierden: `verifyCitations` los recupera del `raw` y prueba
//   también la variante `"<n> <ordinal>"` contra el índice, de modo que un
//   pack que guarde `52 bis` resuelve aunque el campo quede limpio (`52`).
// - C-3 (calificadores de subdivisión): el extractor captura el calificador
//   (`inc./inciso`, `párr./párrafo`, `apart./apartado` + valor, p. ej.
//   `inc. b`) y lo preserva en el `raw` (se extiende el span cuando el
//   calificador viene tras la norma: `art. 52 bis LDC inc. b`). El calificador
//   NO forma parte de la clave del índice (el pack guarda `52 bis`); se valida
//   contra el TEXTO de la provisión: si la cita trae calificador y la
//   provisión no lo menciona con su rótulo, el veredicto es `unverified` con
//   `article-missing` (fail-closed). Límite: sólo se acepta mención con
//   rótulo (`inc./inciso b`, `párr./párrafo 2`, `apart./apartado a`); marcas
//   peladas como `(b)` o `b)` sin rótulo NO bastan y dan falso negativo
//   (conservador); el valor se trunca a 4 caracteres alfanuméricos.
// - C-1 (comillas simples): `findQuotedSpans` reconoce `'...'` además de
//   `"..."`, `"..."` y `«...»`. Heurística anti-apóstrofe: la comilla de
//   apertura debe seguir a inicio o a un carácter no alfanumérico y la de
//   cierre debe anteceder a fin o a un no alfanumérico (letras/números
//   unicode cuentan como palabra), con 2–400 caracteres sin salto ni otra
//   comilla simple y contenido no vacío tras trim. Así `don't`, `d'acord` o
//   `l'homme` (apóstrofe intra-palabra o comilla sin pareja) se ignoran.
//   Límites: citas de un solo carácter (`'b'`) se ignoran por ruido (residual
//   irrelevante: una letra suelta siempre sería substring); pares que cruzan
//   oraciones pueden emparejarse mal (igual que con dobles); énfasis markdown
//   (`*...*`) y blockquotes (`>`) NO se tratan como citas (límite honesto).
// - C-2 (ventana cita↔span): la asociación primaria usa `QUOTE_WINDOW` (200,
//   misma oración/párrafo). Respaldo determinista: los spans no asignados se
//   reintentan contra la cita elegible más cercana dentro de
//   `QUOTE_FALLBACK_WINDOW` (1000 ≈ 1–2 párrafos legales típicos de 500–800
//   caracteres más margen), exigiendo que el segmento entre span y candidata
//   no cruce otra cita elegible (no se le roba la comilla a una cita
//   intermedia; a igual distancia gana el índice menor). Límite residual: un
//   span inventado a más de 1000 caracteres de toda cita sigue quedando
//   `not-applicable` (fail-open documentado; mitigado porque el prompt exige
//   comillas sólo para verbatim y la fidelidad es estricta cuando asocia).
// - Las citas repetidas se DEDUPLICAN por identidad (norma+artículo+ordinal+
//   calificador, o kind+texto crudo para las externas) conservando el orden
//   de aparición. Así los contadores cuentan citas únicas y los marcadores no
//   se repiten. Nota: el marcado de presentación agrupa por (norma, artículo)
//   y puede marcar una ocurrencia verificada si otra con el mismo artículo
//   pero distinto calificador falló (fail-closed, conservador).
// - Los marcadores son de PRESENTACIÓN: la salida cruda del modelo no se
//   toca; `applyCitationMarkers` devuelve una copia marcada e es idempotente
//   (si el marcador ya sigue a la cita, no lo vuelve a insertar).
// - La fidelidad compara el span entrecomillado contra el texto de la
//   provisión normalizando SÓLO espacios/saltos (colapsados a un espacio);
//   cualquier otra diferencia (palabras, orden, puntuación, mayúsculas) es
//   paráfrasis => `[VERIFICAR: cita no textual]`.
// ---------------------------------------------------------------------------

import type {
  CitationFidelity,
  CitationGuardResult,
  CitationKind,
  CitationRef,
  CitationVerdict,
  LegalIndex,
  LegalPassage,
  LegalProvision,
} from '../types/legal';

// ---------------------------------------------------------------------------
// Constantes de normalización y vecindad.
// ---------------------------------------------------------------------------

/** Siglas reconocidas -> id canónico propio. `CPCC` es variante de `CPCCN`. */
const SIGLA_CANONICAL: Readonly<Record<string, string>> = {
  CCYC: 'CCyC',
  CCCN: 'CCyC',
  CPCCN: 'CPCCN',
  CPCC: 'CPCCN',
  LGS: 'LGS',
  LCQ: 'LCQ',
  LDC: 'LDC',
  CP: 'CP',
};

/** Número de ley (sólo dígitos) -> id canónico propio. */
const LAW_CANONICAL: Readonly<Record<string, string>> = {
  '26994': 'CCyC',
  '17454': 'CPCCN',
  '19550': 'LGS',
  '24522': 'LCQ',
  '24240': 'LDC',
  '11179': 'CP',
};

/** Máximo de caracteres entre un artículo y su norma para asociarlos. */
const NORM_WINDOW = 40;

/** Máximo de caracteres entre una cita normativa y un span entrecomillado. */
const QUOTE_WINDOW = 200;

/**
 * Ventana de respaldo (C-2): los spans que no asocian en `QUOTE_WINDOW` se
 * reintentan hasta esta distancia (~1–2 párrafos legales típicos). Más allá
 * queda el límite residual documentado en el encabezado.
 */
const QUOTE_FALLBACK_WINDOW = 1000;

const UNVERIFIED_MARKER = '[VERIFICAR]';
const PARAPHRASE_MARKER = '[VERIFICAR: cita no textual]';

// ---------------------------------------------------------------------------
// Tipos internos (posición incluida; no se exportan).
// ---------------------------------------------------------------------------

interface NormHit {
  canonical: string;
  start: number;
  end: number;
}

interface ArticleHit {
  article: string;
  ordinal: string | null;
  /** Calificador de subdivisión normalizado (`inc b`, `parr 2`), o `null`. */
  qualifier: string | null;
  start: number;
  end: number;
}

/** Cita detectada con posición, para verificar y para insertar marcadores. */
interface Detection {
  raw: string;
  kind: CitationKind;
  normId: string | null;
  article: string | null;
  ordinal: string | null;
  /** Calificador de subdivisión normalizado (`inc b`), o `null` si no hay. */
  qualifier: string | null;
  start: number;
  end: number;
}

interface QuotedSpan {
  text: string;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Utilidades puras.
// ---------------------------------------------------------------------------

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isExternalKind(kind: CitationKind): boolean {
  return kind === 'case-law' || kind === 'doctrine' || kind === 'docket';
}

/** Normaliza el calificador a `inc|parr|apart` + valor en minúsculas. */
function normalizeQualifier(kindRaw: string, valueRaw: string): string | null {
  const flat = kindRaw.toLowerCase().replace(/\./g, '');
  const value = valueRaw.toLowerCase();
  if (value.length === 0) return null;
  let kind: string | null = null;
  if (flat.startsWith('inc')) kind = 'inc';
  else if (flat.startsWith('par') || flat.startsWith('pár')) kind = 'parr';
  else if (flat.startsWith('apa')) kind = 'apart';
  if (kind === null) return null;
  return `${kind} ${value}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * La provisión menciona el calificador con su rótulo (`inc./inciso b`,
 * `párr./párrafo 2`, `apart./apartado a`). Exigir el rótulo es fail-closed:
 * una marca pelada `(b)` no basta.
 */
function qualifierInProvision(qualifier: string, provision: LegalProvision): boolean {
  const space = qualifier.indexOf(' ');
  if (space <= 0) return false;
  const kind = qualifier.slice(0, space);
  const value = qualifier.slice(space + 1);
  if (kind.length === 0 || value.length === 0) return false;
  const hay = provision.text.toLowerCase();
  const needle = escapeRegExp(value.toLowerCase());
  if (kind === 'inc') {
    return new RegExp(`\\binc(?:iso)?\\.?\\s*${needle}\\b`).test(hay);
  }
  if (kind === 'parr') {
    return new RegExp(
      `\\bp(?:á|a)rr(?:afo)?\\.?\\s*${needle}\\b`,
    ).test(hay);
  }
  if (kind === 'apart') {
    return new RegExp(`\\bapart(?:ado)?\\.?\\s*${needle}\\b`).test(hay);
  }
  return false;
}

/** Clave estable de identidad de una cita (para deduplicar y mapear marcas). */
function refKey(
  kind: CitationKind,
  normId: string | null,
  article: string | null,
  raw: string,
): string {
  if (isExternalKind(kind)) {
    return `${kind}|${normalizeWhitespace(raw).toLowerCase()}`;
  }
  if (normId === null && article === null) {
    return `malformed|${normalizeWhitespace(raw).toLowerCase()}`;
  }
  return `norm|${normId ?? ''}|${article ?? ''}`;
}

/**
 * Identidad extendida para deduplicar y agrupar (C-3/C-4): distingue ordinal
 * (`52` vs `52 bis`) y calificador (`52` vs `52 inc b`). Las externas y las
 * malformadas usan la misma clave que `refKey`.
 */
function identityKey(detection: Detection): string {
  if (isExternalKind(detection.kind)) {
    return refKey(detection.kind, detection.normId, detection.article, detection.raw);
  }
  if (detection.normId === null && detection.article === null) {
    return refKey(detection.kind, detection.normId, detection.article, detection.raw);
  }
  const ordinal = (detection.ordinal ?? '').toLowerCase();
  const qualifier = (detection.qualifier ?? '').toLowerCase();
  return `norm|${detection.normId ?? ''}|${detection.article ?? ''}|${ordinal}|${qualifier}`;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function rangeDistance(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (bStart >= aEnd) return bStart - aEnd;
  if (aStart >= bEnd) return aStart - bEnd;
  return 0;
}

// ---------------------------------------------------------------------------
// Detección posicional (base de extract/verify/markers).
// ---------------------------------------------------------------------------

function collectNormHits(text: string): NormHit[] {
  const hits: NormHit[] = [];

  // Leyes numeradas: `ley 26.994`, `Ley 17.454`, `ley 99999`.
  for (const match of text.matchAll(/\bley\s+(?:n[°º]?\s*)?(\d{1,2}(?:\.?\d{3})+)\b/gi)) {
    const digits = (match[1] ?? '').replace(/\D/g, '');
    if (digits.length === 0) continue;
    const canonical = LAW_CANONICAL[digits] ?? `Ley ${digits}`;
    const start = match.index ?? 0;
    hits.push({ canonical, start, end: start + match[0].length });
  }

  // Siglas: `CCyC`, `CCCN`, `CPCCN`, `CPCC`, `LGS`, `LCQ`, `LDC`, `CP`.
  for (const match of text.matchAll(/\b(CCyC|CCCN|CPCCN|CPCC|LGS|LCQ|LDC|CP)\b/gi)) {
    const canonical = SIGLA_CANONICAL[(match[1] ?? '').toUpperCase()];
    if (canonical === undefined) continue;
    const start = match.index ?? 0;
    hits.push({ canonical, start, end: start + match[0].length });
  }

  // Nombres largos de las normas del mapa curado.
  const longNames: ReadonlyArray<{ regex: RegExp; canonical: string }> = [
    {
      regex: /\bc[óo]digo\s+civil\s+y\s+comercial(?:\s+de\s+la\s+naci[óo]n)?\b/gi,
      canonical: 'CCyC',
    },
    {
      regex: /\bc[óo]digo\s+procesal\s+civil\s+y\s+comercial(?:\s+de\s+la\s+naci[óo]n)?\b/gi,
      canonical: 'CPCCN',
    },
    { regex: /\bley\s+general\s+de\s+sociedades\b/gi, canonical: 'LGS' },
    { regex: /\bley\s+de\s+concursos\s+y\s+quiebras\b/gi, canonical: 'LCQ' },
    { regex: /\bley\s+de\s+defensa\s+del\s+consumidor\b/gi, canonical: 'LDC' },
    { regex: /\bc[óo]digo\s+penal\b/gi, canonical: 'CP' },
  ];
  for (const { regex, canonical } of longNames) {
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0;
      hits.push({ canonical, start, end: start + match[0].length });
    }
  }

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: NormHit[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start < lastEnd) continue;
    result.push(hit);
    lastEnd = hit.end;
  }
  return result;
}

function collectArticleHits(text: string): ArticleHit[] {
  const hits: ArticleHit[] = [];
  const regex =
    /\b(?:(?:arts?\.?)|(?:art[íi]culos?))\s*(?:n[°º]?\s*)?(\d{1,4})(?:\s*(bis|ter|quater|quinquies))?(?:\s*,?\s*(inc\.?|inciso|párr\.?|parr\.?|párrafo|parrafo|apart\.?|apartado)\s*\.?\s*([a-z0-9]{1,4}))?/gi;
  for (const match of text.matchAll(regex)) {
    const article = match[1] ?? '';
    if (article.length === 0) continue;
    const ordinal = (match[2] ?? '').toLowerCase();
    const qualifier = normalizeQualifier(match[3] ?? '', match[4] ?? '');
    const start = match.index ?? 0;
    hits.push({
      article,
      ordinal: ordinal.length > 0 ? ordinal : null,
      qualifier,
      start,
      end: start + match[0].length,
    });
  }
  return hits;
}

/** Norma libre de artículo (`CCyC`) o token `art.` sin número -> malformed. */
function collectMalformedHits(text: string): Detection[] {
  const hits: Detection[] = [];
  for (const match of text.matchAll(/\barts?\./gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (/^\s*\d/.test(text.slice(end, end + 6))) continue;
    hits.push({
      raw: match[0],
      kind: 'article',
      normId: null,
      article: null,
      ordinal: null,
      qualifier: null,
      start,
      end,
    });
  }
  return hits;
}

/** Fallos/jurisprudencia, doctrina y expedientes: externos, nunca verificables. */
function collectExternalHits(text: string): Detection[] {
  const detections: Detection[] = [];
  const patterns: ReadonlyArray<{ regex: RegExp; kind: CitationKind }> = [
    // Expedientes: `Expte. 12345/2024`, `expediente n° 45`.
    { regex: /\b(?:expte\.?|expediente)\s*(?:n[°º]?\s*)?[\d][\d\-/]{2,}/gi, kind: 'docket' },
    // Fallos por órgano o por palabra clave.
    {
      regex: /\b(?:CSJN|CSJ|CNCiv|CNCom|CNTrab|C[áa]mara(?:\s+Nacional)?|fallo|jurisprudencia)\b/gi,
      kind: 'case-law',
    },
    // Carátula entrecomillada con `c/` (dobles y simples; las simples usan la
    // misma heurística de bordes que `findQuotedSpans` vía el solape).
    { regex: /"[^"\n]{2,120}?\bc\/\s[^"\n]{1,80}"/g, kind: 'case-law' },
    { regex: /'[^'\n]{2,120}?\bc\/\s[^'\n]{1,80}'/g, kind: 'case-law' },
    // Doctrina por palabra clave.
    { regex: /\b(?:doctrina|doctrinari[oa]s?)\b/gi, kind: 'doctrine' },
    // Doctrina por autor (lista curada y acotada).
    {
      regex: /\b(?:Bidart\s+Campos|Llamb[íi]as|Borda|Alsina|Palacio|Morello|Lorenzetti|Pizarro|Mosset\s+Iturraspe|Stiglitz|Kemelmajer(?:\s+de\s+Carlucci)?|Cifuentes|Wayar|Trigo\s+Represas|Compagnucci\s+de\s+Caso|Zavala\s+Rodr[íi]guez|Ghersi)\b/gi,
      kind: 'doctrine',
    },
  ];
  for (const { regex, kind } of patterns) {
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0;
      detections.push({
        raw: match[0],
        kind,
        normId: null,
        article: null,
        ordinal: null,
        qualifier: null,
        start,
        end: start + match[0].length,
      });
    }
  }
  return detections;
}

function nearestNorm(norms: readonly NormHit[], used: ReadonlySet<number>, article: ArticleHit): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < norms.length; index += 1) {
    if (used.has(index)) continue;
    const norm = norms[index];
    if (norm === undefined) continue;
    const distance = rangeDistance(article.start, article.end, norm.start, norm.end);
    if (distance <= NORM_WINDOW && distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/** Calificador que sigue a la cita (`art. 52 bis LDC inc. b`, con coma opcional). */
const TRAILING_QUALIFIER_RE =
  /^\s*,?\s*(inc\.?|inciso|párr\.?|parr\.?|párrafo|parrafo|apart\.?|apartado)\s*\.?\s*([a-z0-9]{1,4})\b/i;

/** Lee un calificador justo después de `from` (hasta 28 caracteres). */
function parseTrailingQualifier(
  text: string,
  from: number,
): { qualifier: string; end: number } | null {
  const slice = text.slice(from, from + 28);
  const match = TRAILING_QUALIFIER_RE.exec(slice);
  if (match === null) return null;
  const qualifier = normalizeQualifier(match[1] ?? '', match[2] ?? '');
  if (qualifier === null) return null;
  return { qualifier, end: from + match[0].length };
}

function extractDetections(text: string): Detection[] {
  const normHits = collectNormHits(text);
  const usedNorm = new Set<number>();
  const combined: Detection[] = [];

  for (const article of collectArticleHits(text)) {
    const normIndex = nearestNorm(normHits, usedNorm, article);
    const norm = normIndex >= 0 ? normHits[normIndex] : undefined;
    if (norm !== undefined) {
      usedNorm.add(normIndex);
      const start = Math.min(article.start, norm.start);
      let end = Math.max(article.end, norm.end);
      // C-3: preserva el calificador en el `raw`; si viene tras la norma se
      // extiende el span para no descartarlo (`art. 52 bis LDC inc. b`).
      let qualifier = article.qualifier;
      if (qualifier === null) {
        const trailing = parseTrailingQualifier(text, end);
        if (trailing !== null) {
          qualifier = trailing.qualifier;
          end = trailing.end;
        }
      }
      combined.push({
        raw: text.slice(start, end),
        kind: 'norm',
        normId: norm.canonical,
        article: article.article,
        ordinal: article.ordinal,
        qualifier,
        start,
        end,
      });
      continue;
    }
    combined.push({
      raw: text.slice(article.start, article.end),
      kind: 'article',
      normId: null,
      article: article.article,
      ordinal: article.ordinal,
      qualifier: article.qualifier,
      start: article.start,
      end: article.end,
    });
  }

  normHits.forEach((norm, index) => {
    if (usedNorm.has(index)) return;
    combined.push({
      raw: text.slice(norm.start, norm.end),
      kind: 'norm',
      normId: norm.canonical,
      article: null,
      ordinal: null,
      qualifier: null,
      start: norm.start,
      end: norm.end,
    });
  });

  const all = [...combined, ...collectMalformedHits(text), ...collectExternalHits(text)];
  all.sort((a, b) => a.start - b.start || b.end - a.end);

  const result: Detection[] = [];
  let lastEnd = -1;
  for (const detection of all) {
    if (detection.start < lastEnd) continue;
    result.push(detection);
    lastEnd = detection.end;
  }
  return result;
}

/** Caracter de palabra (unicode) para la heurística anti-apóstrofe (C-1). */
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function isWordChar(char: string): boolean {
  if (char.length === 0) return false;
  return WORD_CHAR_RE.test(char);
}

function findQuotedSpans(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  const regex = /“([^”]{1,400})”|«([^»]{1,400})»|"([^"]{1,400})"/g;
  for (const match of text.matchAll(regex)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    const start = match.index ?? 0;
    spans.push({ text: value, start, end: start + match[0].length });
  }
  // C-1: comillas simples con heurística anti-apóstrofe (ver encabezado).
  // Se exigen bordes no alfanuméricos para no tragar `don't` ni `d'acord`.
  const singleRegex = /'([^'\n]{2,400})'/g;
  for (const match of text.matchAll(singleRegex)) {
    const value = match[1] ?? '';
    if (value.trim().length === 0) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = start > 0 ? (text[start - 1] ?? '') : '';
    const after = end < text.length ? (text[end] ?? '') : '';
    if (start > 0 && isWordChar(before)) continue;
    if (end < text.length && isWordChar(after)) continue;
    spans.push({ text: value, start, end });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return spans;
}

/**
 * Asocia cada span entrecomillado con la cita normativa más cercana (dentro
 * de `QUOTE_WINDOW`) que no lo contenga ni esté contenida en él. Un span que
 * solapa una cita (p. ej. una carátula `"Foo c/ Bar"`) no es un span de
 * provisión y se ignora. C-2: los spans sin asignar se reintentan con
 * `QUOTE_FALLBACK_WINDOW` contra la elegible más cercana cuyo segmento no
 * cruce otra cita elegible. Devuelve, por índice de detección, sus spans.
 */
function associateQuotes(text: string, detections: readonly Detection[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const eligible: number[] = [];
  detections.forEach((detection, index) => {
    if ((detection.kind === 'norm' || detection.kind === 'article') && detection.article !== null) {
      eligible.push(index);
    }
  });
  if (eligible.length === 0) return result;

  // El segmento cita↔span cruza otra elegible: la comilla pertenece a la
  // intermedia, no a la candidata lejana.
  function crossesOtherEligible(
    candidate: number,
    quoteStart: number,
    quoteEnd: number,
    candStart: number,
    candEnd: number,
  ): boolean {
    const low = quoteEnd <= candStart ? quoteEnd : candEnd;
    const high = quoteEnd <= candStart ? candStart : quoteStart;
    if (high <= low) return false;
    return eligible.some((other) => {
      if (other === candidate) return false;
      const det = detections[other];
      if (det === undefined) return false;
      return rangesOverlap(low, high, det.start, det.end);
    });
  }

  function nearestCandidate(
    quoteStart: number,
    quoteEnd: number,
    window: number,
  ): number {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of eligible) {
      const detection = detections[index];
      if (detection === undefined) continue;
      const distance = rangeDistance(detection.start, detection.end, quoteStart, quoteEnd);
      if (distance > window || distance >= bestDistance) continue;
      if (
        window > QUOTE_WINDOW &&
        crossesOtherEligible(index, quoteStart, quoteEnd, detection.start, detection.end)
      ) {
        continue;
      }
      bestDistance = distance;
      bestIndex = index;
    }
    return bestIndex;
  }

  function appendQuote(detectionIndex: number, quoteText: string): void {
    const list = result.get(detectionIndex);
    if (list === undefined) result.set(detectionIndex, [quoteText]);
    else list.push(quoteText);
  }

  const pending: QuotedSpan[] = [];
  for (const quote of findQuotedSpans(text)) {
    if (quote.text.trim().length === 0) continue;
    const overlaps = detections.some((detection) =>
      rangesOverlap(quote.start, quote.end, detection.start, detection.end),
    );
    if (overlaps) continue;

    const bestIndex = nearestCandidate(quote.start, quote.end, QUOTE_WINDOW);
    if (bestIndex < 0) {
      pending.push(quote);
      continue;
    }
    appendQuote(bestIndex, quote.text);
  }

  for (const quote of pending) {
    const bestIndex = nearestCandidate(quote.start, quote.end, QUOTE_FALLBACK_WINDOW);
    if (bestIndex < 0) continue;
    appendQuote(bestIndex, quote.text);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Verificación (existencia + fidelidad).
// ---------------------------------------------------------------------------

function safeHas(index: LegalIndex, normId: string, article: string): boolean {
  try {
    return index.has(normId, article);
  } catch {
    return false;
  }
}

function safeGet(index: LegalIndex, normId: string, article: string): LegalProvision | null {
  try {
    return index.get(normId, article);
  } catch {
    return null;
  }
}

function safeSearch(index: LegalIndex, query: string, limit: number): LegalPassage[] {
  try {
    const passages = index.search(query, limit);
    return Array.isArray(passages) ? passages : [];
  } catch {
    return [];
  }
}

/**
 * El contrato `LegalIndex` no expone `hasNorm`: se sondea con `search` (los
 * pasajes de una norma la referencian) y, como respaldo, con `versions`.
 * Si la sonda falla, degrada a "norma ausente" (nunca a `verified`).
 */
function normInIndex(normId: string, index: LegalIndex): boolean {
  const passages = safeSearch(index, normId, 5);
  if (passages.some((passage) => passage.provision.normId === normId)) return true;
  try {
    return Object.prototype.hasOwnProperty.call(index.versions, normId);
  } catch {
    return false;
  }
}

/** Variantes de artículo a probar: base y, si vino, `<n> <ordinal>`. */
function articleCandidates(detection: Detection): string[] {
  const base = detection.article;
  if (base === null) return [];
  const candidates = [base];
  if (detection.ordinal !== null) candidates.push(`${base} ${detection.ordinal}`);
  return candidates;
}

/** Procedencia del pack: vía `search`; respaldo `versions`; último recurso mínimo. */
function resolvePackId(
  provision: LegalProvision,
  index: LegalIndex,
): { packId: string; packVersion: string } {
  const passages = safeSearch(index, `${provision.normId} ${provision.article}`, 10);
  const exact = passages.find((passage) => passage.provision.id === provision.id);
  if (exact !== undefined) return { packId: exact.packId, packVersion: exact.packVersion };
  const sameArticle = passages.find(
    (passage) =>
      passage.provision.normId === provision.normId &&
      passage.provision.article === provision.article,
  );
  if (sameArticle !== undefined) {
    return { packId: sameArticle.packId, packVersion: sameArticle.packVersion };
  }
  const version = index.versions[provision.normId];
  if (typeof version === 'string' && version.length > 0) {
    return { packId: provision.normId, packVersion: version };
  }
  const entries = Object.entries(index.versions);
  const first = entries[0];
  if (entries.length === 1 && first !== undefined) {
    return { packId: first[0], packVersion: first[1] };
  }
  return { packId: provision.normId, packVersion: '' };
}

function checkFidelity(provision: LegalProvision, quotes: readonly string[]): CitationFidelity {
  if (quotes.length === 0) return 'not-applicable';
  const provisionText = normalizeWhitespace(provision.text);
  for (const quote of quotes) {
    const normalized = normalizeWhitespace(quote);
    if (normalized.length > 0 && !provisionText.includes(normalized)) {
      return 'paraphrase';
    }
  }
  return 'verbatim';
}

function verifyNormCitation(
  detection: Detection,
  quotes: readonly string[],
  index: LegalIndex,
): CitationVerdict {
  const citation: CitationRef = {
    raw: detection.raw,
    kind: detection.kind,
    normId: detection.normId,
    article: detection.article,
  };

  if (detection.kind === 'article' && detection.article === null) {
    return { status: 'malformed', raw: detection.raw };
  }
  if (detection.normId === null) {
    return { status: 'unverified', citation, reason: 'not-a-norm' };
  }
  if (detection.article === null) {
    const present = normInIndex(detection.normId, index);
    return {
      status: 'unverified',
      citation,
      reason: present ? 'article-missing' : 'no-index',
    };
  }

  let provision: LegalProvision | null = null;
  for (const candidate of articleCandidates(detection)) {
    if (!safeHas(index, detection.normId, candidate)) continue;
    provision = safeGet(index, detection.normId, candidate);
    if (provision !== null) break;
  }

  if (provision === null) {
    const present = normInIndex(detection.normId, index);
    return {
      status: 'unverified',
      citation,
      reason: present ? 'article-missing' : 'no-index',
    };
  }

  // C-3: la subdivisión citada debe existir en la provisión (fail-closed).
  if (detection.qualifier !== null && !qualifierInProvision(detection.qualifier, provision)) {
    return { status: 'unverified', citation, reason: 'article-missing' };
  }

  const fidelity = checkFidelity(provision, quotes);
  if (fidelity === 'paraphrase') {
    return { status: 'unverified', citation, reason: 'paraphrase' };
  }

  const pack = resolvePackId(provision, index);
  return {
    status: 'verified',
    citation,
    provision,
    fidelity,
    packId: pack.packId,
    packVersion: pack.packVersion,
  };
}

// ---------------------------------------------------------------------------
// API pública.
// ---------------------------------------------------------------------------

/**
 * Extrae y clasifica las citas de un texto. Determinista, nunca lanza y sin
 * duplicados: cada identidad (norma+artículo+ordinal+calificador, o
 * kind+texto crudo para fallos, doctrina y expedientes) aparece una sola
 * vez, en orden de primera aparición.
 */
export function extractCitations(text: string): CitationRef[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  try {
    const seen = new Set<string>();
    const refs: CitationRef[] = [];
    for (const detection of extractDetections(text)) {
      const key = identityKey(detection);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        raw: detection.raw,
        kind: detection.kind,
        normId: detection.normId,
        article: detection.article,
      });
    }
    return refs;
  } catch {
    return [];
  }
}

/**
 * Verifica cada cita contra el índice instalado.
 * - Normativa: `verified` sólo si `(normId, article)` existe, la subdivisión
 *   citada (`inc./párr./apart.`) consta en la provisión y, si hay span
 *   entrecomillado asociado, éste es substring verbatim (normalizando
 *   espacios/saltos). Norma presente sin el artículo o sin la subdivisión =>
 *   `article-missing`; norma ausente => `no-index`; sin norma inferible =>
 *   `not-a-norm`.
 * - Fallo/doctrina/expediente: SIEMPRE `unverified` con `external-kind`.
 * - Sin datos para interpretar => `malformed`.
 * Las citas repetidas se agrupan: un veredicto por identidad, en orden de
 * primera aparición; los spans de todas las repeticiones se evalúan juntos
 * (si una parafrasea, el veredicto es paráfrasis).
 */
export function verifyCitations(text: string, index: LegalIndex): CitationGuardResult {
  const empty: CitationGuardResult = { verdicts: [], verified: 0, unverified: 0, malformed: 0 };
  if (typeof text !== 'string' || text.length === 0) return empty;
  try {
    const detections = extractDetections(text);
    if (detections.length === 0) return empty;

    const quotesByDetection = associateQuotes(text, detections);

    interface Group {
      detection: Detection;
      quotes: string[];
    }
    const groups = new Map<string, Group>();
    detections.forEach((detection, index) => {
      const key = identityKey(detection);
      const quotes = quotesByDetection.get(index) ?? [];
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, { detection, quotes: [...quotes] });
      } else {
        existing.quotes.push(...quotes);
      }
    });

    const verdicts: CitationVerdict[] = [];
    for (const group of groups.values()) {
      const { detection } = group;
      if (isExternalKind(detection.kind)) {
        verdicts.push({
          status: 'unverified',
          citation: { raw: detection.raw, kind: detection.kind, normId: null, article: null },
          reason: 'external-kind',
        });
        continue;
      }
      verdicts.push(verifyNormCitation(detection, group.quotes, index));
    }

    let verified = 0;
    let unverified = 0;
    let malformed = 0;
    for (const verdict of verdicts) {
      if (verdict.status === 'verified') verified += 1;
      else if (verdict.status === 'unverified') unverified += 1;
      else malformed += 1;
    }
    return { verdicts, verified, unverified, malformed };
  } catch {
    return empty;
  }
}

/**
 * Devuelve el texto listo para RENDER con los marcadores insertados:
 * `[VERIFICAR]` para unverified/malformed y `[VERIFICAR: cita no textual]`
 * para paráfrasis. No altera la sustancia del texto (sólo inserta marcas) y
 * es idempotente: si el marcador ya sigue a la cita, no se duplica.
 */
export function applyCitationMarkers(text: string, result: CitationGuardResult): string {
  if (typeof text !== 'string' || text.length === 0) return text;

  const markers = new Map<string, string>();
  // Nota C-3: el marcado agrupa por (norma, artículo) a propósito (fail-closed:
  // una ocurrencia verificada puede marcarse si otra con el mismo artículo y
  // distinto calificador falló).
  for (const verdict of result.verdicts) {
    if (verdict.status === 'verified') continue;
    if (verdict.status === 'malformed') {
      markers.set(`malformed|${normalizeWhitespace(verdict.raw).toLowerCase()}`, UNVERIFIED_MARKER);
      continue;
    }
    const marker = verdict.reason === 'paraphrase' ? PARAPHRASE_MARKER : UNVERIFIED_MARKER;
    markers.set(
      refKey(
        verdict.citation.kind,
        verdict.citation.normId,
        verdict.citation.article,
        verdict.citation.raw,
      ),
      marker,
    );
  }
  if (markers.size === 0) return text;

  const insertions: { at: number; marker: string }[] = [];
  for (const detection of extractDetections(text)) {
    const key = refKey(detection.kind, detection.normId, detection.article, detection.raw);
    const marker = markers.get(key);
    if (marker === undefined) continue;
    // Idempotencia: si la cita ya está marcada, no se vuelve a marcar.
    if (/^\s*\[VERIFICAR/.test(text.slice(detection.end))) continue;
    insertions.push({ at: detection.end, marker });
  }
  if (insertions.length === 0) return text;

  insertions.sort((a, b) => b.at - a.at);
  let output = text;
  for (const insertion of insertions) {
    output = `${output.slice(0, insertion.at)} ${insertion.marker}${output.slice(insertion.at)}`;
  }
  return output;
}
