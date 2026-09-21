/**
 * `open_url`: descarga una página (directo o vía proxy), valida la política de
 * URLs, descarta respuestas > 2 MB antes de parsear y extrae el artículo con
 * `extractArticle`. Devuelve `ToolResult` con `sources` para la UI.
 *
 * El modo directo **nunca** sigue redirects: pide `redirect:'manual'` y convierte
 * cualquier 3xx (u opaca, status 0) en `blocked_url` accionable. En plataformas
 * que no controlan redirects (Capacitor nativo) exige un proxy de lectura. El
 * proxy `/v1/fetch` es quien sigue redirects, revalidando cada salto server-side.
 *
 * En navegador, la mayoría de sitios no emiten CORS y el fetch directo es
 * imposible. Si `readerFallback` está activo (navegador sin proxy), un fallo del
 * fetch directo reintenta contra un lector público con CORS (`r.jina.ai`), que
 * descarga la página server-side y devuelve markdown. La URL inicial ya pasó
 * `isUrlAllowed`, así que el redirect lo resuelve el lector, no la red del usuario.
 */

import type { HttpClient, HttpResponse } from '@/domain/ports/HttpClient';
import type { SourceRef, ToolErrorCode, ToolResult } from '@/domain/types/chat';
import type { ToolExecutionContext } from '@/domain/types/tools';
import { ToolExecutionError, mapTransportError } from '../errors';
import { isBrowserEnvironment } from '../platform';
import { fetchViaProxy } from '../proxy';
import { isUrlAllowed } from '../urlPolicy';
import { ARTICLE_TEXT_LIMIT, capArticleText, extractArticle } from './extractArticle';
import type { ExtractedArticle } from './extractArticle';

export const OPEN_URL_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Lector público con CORS: `GET {endpoint}{url}` → markdown en texto plano. */
export const JINA_READER_ENDPOINT = 'https://r.jina.ai/';

const REDIRECT_BLOCKED_MESSAGE =
  'The URL redirects to another address, and direct reads never follow redirects (they could reach private networks). Configure a reading proxy in Settings to open redirected pages safely.';
const REDIRECT_UNSUPPORTED_MESSAGE =
  'Direct page reads cannot verify redirect destinations on this platform. Configure a reading proxy in Settings to read web pages safely.';

export interface OpenUrlDeps {
  http: HttpClient;
  now: () => number;
  /** Base ya normalizada del proxy (`null`/`undefined` = fetch directo). */
  proxyBaseUrl?: string | null;
  /** Solo navegador sin proxy: reintenta con un lector público con CORS si el fetch directo falla. */
  readerFallback?: boolean;
}

export async function openUrl(
  input: { url: string },
  context: ToolExecutionContext,
  deps: OpenUrlDeps,
): Promise<ToolResult> {
  const startedAt = deps.now();
  const rawUrl = input.url;
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return failure('invalid_args', 'The "url" argument must be a non-empty string.', startedAt, deps.now());
  }
  const url = rawUrl.trim();
  const verdict = isUrlAllowed(url);
  if (!verdict.ok) {
    return failure('blocked_url', `The URL was blocked by the safety policy: ${verdict.reason}.`, startedAt, deps.now());
  }
  const proxyBaseUrl = deps.proxyBaseUrl ?? null;
  try {
    const article = proxyBaseUrl === null
      ? await fetchDirect(url, context, deps)
      : await fetchThroughProxy(url, context, deps, proxyBaseUrl);
    return buildSuccess(url, article, startedAt, deps.now());
  } catch (error) {
    if (deps.readerFallback === true && proxyBaseUrl === null) {
      try {
        const article = await fetchViaReader(url, context, deps);
        return buildSuccess(url, article, startedAt, deps.now());
      } catch {
        // El error original (CORS) es más accionable que el del lector: se propaga.
      }
    }
    const mapped = mapTransportError(error, { browser: isBrowserEnvironment(), proxied: proxyBaseUrl !== null });
    return failure(mapped.code, mapped.message, startedAt, deps.now());
  }
}

async function fetchDirect(url: string, context: ToolExecutionContext, deps: OpenUrlDeps): Promise<ExtractedArticle> {
  // `false` explícito = el transporte sigue redirects sin control (Capacitor nativo).
  // `undefined` = transporte genérico al que igual se le pide `redirect:'manual'`.
  if (deps.http.supportsRedirectControl === false) {
    throw new ToolExecutionError('blocked_url', REDIRECT_UNSUPPORTED_MESSAGE);
  }
  const response = await deps.http.request({
    url,
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    timeoutMs: OPEN_URL_TIMEOUT_MS,
    signal: context.signal,
    redirect: 'manual',
  });
  if (isRedirectResponse(response.status)) {
    throw new ToolExecutionError('blocked_url', REDIRECT_BLOCKED_MESSAGE);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ToolExecutionError('http_error', `The page responded with HTTP ${response.status}.`);
  }
  assertWithinSizeLimit(response);
  const contentType = readHeader(response.headers, 'content-type');
  if (!isSupportedContentType(contentType)) {
    throw new ToolExecutionError('parse_error', `Unsupported content type "${contentType}".`);
  }
  return extractArticle(response.text, { maxChars: ARTICLE_TEXT_LIMIT });
}

/** 3xx o respuesta opaca (status 0): con `redirect:'manual'` jamás son contenido. */
function isRedirectResponse(status: number): boolean {
  return status === 0 || (status >= 300 && status < 400);
}

/** Rechaza por `content-length` declarado y si no mide bytes UTF-8 reales. */
function assertWithinSizeLimit(response: HttpResponse): void {
  const declared = parseContentLength(response.headers);
  if (declared !== null && declared > MAX_RESPONSE_BYTES) throw tooLargeError();
  if (utf8ByteLength(response.text) > MAX_RESPONSE_BYTES) throw tooLargeError();
}

function tooLargeError(): ToolExecutionError {
  return new ToolExecutionError('parse_error', 'The page is too large to read (limit 2 MB).');
}

function parseContentLength(headers: Record<string, string>): number | null {
  const raw = readHeader(headers, 'content-length');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Bytes UTF-8 reales (no code units), con guard para entornos sin `TextEncoder`. */
function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === 'undefined') return text.length;
  return new TextEncoder().encode(text).length;
}

async function fetchThroughProxy(
  url: string,
  context: ToolExecutionContext,
  deps: OpenUrlDeps,
  proxyBaseUrl: string,
): Promise<ExtractedArticle> {
  const payload = await fetchViaProxy({ http: deps.http, baseUrl: proxyBaseUrl }, url, context.signal);
  const capped = capArticleText(payload.text, ARTICLE_TEXT_LIMIT);
  return {
    title: payload.title,
    description: '',
    text: capped.text,
    truncated: payload.truncated || capped.truncated,
  };
}

/** Descarga vía lector público con CORS; la respuesta es texto plano con preámbulo + markdown. */
async function fetchViaReader(url: string, context: ToolExecutionContext, deps: OpenUrlDeps): Promise<ExtractedArticle> {
  const response = await deps.http.request({
    url: `${JINA_READER_ENDPOINT}${url}`,
    method: 'GET',
    headers: { Accept: 'text/plain' },
    timeoutMs: OPEN_URL_TIMEOUT_MS,
    signal: context.signal,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ToolExecutionError('http_error', `The reading service responded with HTTP ${response.status}.`);
  }
  assertWithinSizeLimit(response);
  return parseReaderText(response.text, url);
}

/**
 * El lector devuelve un preámbulo (`Title:`, `Published Time:`…) y el cuerpo tras
 * `Markdown Content:`. Si no hay marcador, se usa todo el texto.
 */
export function parseReaderText(text: string, fallbackTitle: string): ExtractedArticle {
  const lines = text.split('\n');
  let title = '';
  let bodyStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('Title:')) {
      title = line.slice('Title:'.length).trim();
      continue;
    }
    if (line.startsWith('Markdown Content:')) {
      bodyStart = index + 1;
      break;
    }
  }
  const body = bodyStart >= 0 ? lines.slice(bodyStart).join('\n') : text;
  const capped = capArticleText(body.trim(), ARTICLE_TEXT_LIMIT);
  return {
    title: title !== '' ? title : fallbackTitle,
    description: '',
    text: capped.text,
    truncated: capped.truncated,
  };
}

import { createObservationPack, formatObservationSummary } from '@/domain/agent/observationPack';

function buildSuccess(url: string, article: ExtractedArticle, startedAt: number, endedAt: number): ToolResult {
  const title = article.title.trim() === '' ? url : article.title.trim();
  const description = article.description.trim();
  const lines = [`Title: ${title}`, `URL: ${url}`];
  if (description !== '') lines.push(`Description: ${description}`);

  if (article.text.length > 2_500) {
    const pack = createObservationPack({
      title,
      sourceUrl: url,
      fullContent: article.text,
      now: () => endedAt,
    });
    lines.push('', formatObservationSummary(pack));
  } else {
    lines.push('', article.text.trim() === '' ? 'No readable text was found on this page.' : article.text);
  }
  if (article.truncated) lines.push('', '[Content truncated to the extraction limit.]');

  const source: SourceRef = { url, title, accessedAt: endedAt };
  if (description !== '') source.snippet = description;
  return { ok: true, content: lines.join('\n'), sources: [source], durationMs: Math.max(0, endedAt - startedAt) };
}

function failure(code: ToolErrorCode, message: string, startedAt: number, endedAt: number): ToolResult {
  return {
    ok: false,
    content: message,
    error: { code, message },
    durationMs: Math.max(0, endedAt - startedAt),
  };
}

function readHeader(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function isSupportedContentType(value: string | null): boolean {
  if (value === null) return true;
  const mime = (value.split(';')[0] ?? '').trim().toLowerCase();
  if (mime === '') return true;
  return (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'text/plain' ||
    mime === 'application/xml' ||
    mime === 'text/xml'
  );
}
