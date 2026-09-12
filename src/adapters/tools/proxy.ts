/**
 * Cliente del proxy opcional de búsqueda/fetch (docs/search-proxy.md).
 * Contrato: POST {baseUrl}/v1/search y POST {baseUrl}/v1/fetch.
 */

import type { HttpClient } from '@/domain/ports/HttpClient';
import type { SearchProvider } from '@/domain/ports/SearchProvider';
import type { SourceRef } from '@/domain/types/chat';
import type { ProxySettings } from '@/domain/types/settings';
import { ToolExecutionError } from './errors';
import { asArray, asRecord, asString } from './values';

export const PROXY_SEARCH_PATH = '/v1/search';
export const PROXY_FETCH_PATH = '/v1/fetch';
export const PROXY_TIMEOUT_MS = 15_000;

export const MISSING_PROXY_MESSAGE =
  'Custom proxy mode is selected but no proxy URL is set. Add the proxy URL in Settings, or switch to direct mode.';
export const INVALID_PROXY_MESSAGE =
  'Custom proxy mode is selected but the proxy URL is invalid. Use an absolute http(s) URL in Settings, or switch to direct mode.';

export interface ProxyResolution {
  baseUrl: string | null;
  error: { code: 'missing_proxy' | 'invalid_proxy'; message: string } | null;
}

/** Normaliza la base del proxy (http/https, sin slashes finales); `null` si es inválida. */
export function normalizeProxyBaseUrl(baseUrl: string | null | undefined): string | null {
  if (typeof baseUrl !== 'string') return null;
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Resuelve el proxy configurado sin bypass silencioso: en modo `custom` una URL
 * vacía o inválida produce un error accionable para las tools web.
 */
export function resolveProxyBaseUrl(proxy: ProxySettings | undefined): ProxyResolution {
  if (proxy === undefined || proxy.mode !== 'custom') return { baseUrl: null, error: null };
  const raw = typeof proxy.baseUrl === 'string' ? proxy.baseUrl.trim() : '';
  if (raw === '') return { baseUrl: null, error: { code: 'missing_proxy', message: MISSING_PROXY_MESSAGE } };
  const baseUrl = normalizeProxyBaseUrl(raw);
  if (baseUrl === null) return { baseUrl: null, error: { code: 'invalid_proxy', message: INVALID_PROXY_MESSAGE } };
  return { baseUrl, error: null };
}

export interface ProxySearchDeps {
  http: HttpClient;
  baseUrl: string;
  provider: SearchProvider['id'];
  apiKey: string | null;
  now: () => number;
}

/** `SearchProvider` que delega en el proxy; el proxy normaliza la respuesta del proveedor. */
export function createProxySearchProvider(deps: ProxySearchDeps): SearchProvider {
  return {
    id: deps.provider,
    async search(input) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (deps.apiKey !== null) headers['X-Api-Key'] = deps.apiKey;
      const response = await deps.http.request({
        url: `${deps.baseUrl}${PROXY_SEARCH_PATH}`,
        method: 'POST',
        headers,
        body: {
          provider: deps.provider,
          query: input.query,
          count: input.maxResults,
          freshness: input.freshness,
        },
        timeoutMs: PROXY_TIMEOUT_MS,
        signal: input.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new ToolExecutionError('no_provider', `The search proxy rejected the API key (HTTP ${response.status}). Check the key in Settings.`);
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ToolExecutionError('http_error', `The search proxy responded with HTTP ${response.status}.`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(response.text) as unknown;
      } catch {
        throw new ToolExecutionError('parse_error', 'The search proxy returned an invalid JSON response.');
      }
      return parseProxyResults(payload, deps.now());
    },
  };
}

/** Acepta `{ results: [...] }` (contrato) o un array directo; dedupe queda en el servicio. */
export function parseProxyResults(payload: unknown, accessedAt: number): SourceRef[] {
  const root = asRecord(payload);
  const items = asArray(payload) ?? (root === null ? null : asArray(root.results));
  if (items === null) return [];
  const sources: SourceRef[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) continue;
    const url = asString(record.url);
    if (url === null || url.trim() === '') continue;
    const title = asString(record.title) ?? url;
    const snippet = asString(record.snippet);
    const source: SourceRef = { url, title, accessedAt };
    if (snippet !== null && snippet.trim() !== '') source.snippet = snippet;
    sources.push(source);
  }
  return sources;
}

export interface ProxyFetchPayload {
  title: string;
  text: string;
  contentType: string | null;
  truncated: boolean;
}

export interface ProxyFetchDeps {
  http: HttpClient;
  baseUrl: string;
}

/** POST {baseUrl}/v1/fetch `{ url }` → `{ title, text, contentType, truncated }`. */
export async function fetchViaProxy(deps: ProxyFetchDeps, url: string, signal: AbortSignal): Promise<ProxyFetchPayload> {
  const response = await deps.http.request({
    url: `${deps.baseUrl}${PROXY_FETCH_PATH}`,
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: { url },
    timeoutMs: PROXY_TIMEOUT_MS,
    signal,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new ToolExecutionError('http_error', `The search proxy responded with HTTP ${response.status} while fetching the page.`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.text) as unknown;
  } catch {
    throw new ToolExecutionError('parse_error', 'The search proxy returned an invalid JSON response.');
  }
  const root = asRecord(payload);
  const text = root === null ? null : asString(root.text);
  if (text === null) {
    throw new ToolExecutionError('parse_error', 'The search proxy response is missing the page text.');
  }
  return {
    title: asString(root?.title) ?? '',
    text,
    contentType: asString(root?.contentType),
    truncated: root?.truncated === true,
  };
}
