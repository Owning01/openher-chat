/**
 * Cadena de búsqueda web: Brave → Tavily → DuckDuckGo HTML (modo auto) con
 * fallback por errores, dedupe por URL y `provider` informado. Si hay proxy
 * configurado, los mismos proveedores se consultan a través del proxy.
 */

import type { HttpClient } from '@/domain/ports/HttpClient';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { SearchProvider } from '@/domain/ports/SearchProvider';
import type { SourceRef } from '@/domain/types/chat';
import type { Freshness, ProxySettings, SearchSettings } from '@/domain/types/settings';
import { ToolExecutionError, mapTransportError } from '../errors';
import { isBrowserEnvironment } from '../platform';
import { createProxySearchProvider, resolveProxyBaseUrl } from '../proxy';
import { BRAVE_KEY_REF, createBraveProvider } from './brave';
import { createDuckDuckGoProvider } from './duckduckgo';
import { TAVILY_KEY_REF, createTavilyProvider } from './tavily';

export interface SearchInput {
  query: string;
  maxResults: number;
  freshness: Freshness;
  signal: AbortSignal;
}

export interface SearchOutcome {
  results: SourceRef[];
  provider: string;
}

export interface SearchService {
  search(input: SearchInput): Promise<SearchOutcome>;
}

export interface SearchServiceOptions {
  now?: () => number;
  proxy?: ProxySettings;
  isBrowser?: boolean;
}

export function createSearchService(
  settings: SearchSettings,
  keys: KeyVault,
  http: HttpClient,
  options: SearchServiceOptions = {},
): SearchService {
  const now = options.now ?? Date.now;
  const proxy = resolveProxyBaseUrl(options.proxy);
  return {
    async search(input) {
      if (proxy.error !== null) throw new ToolExecutionError(proxy.error.code, proxy.error.message);
      const proxyBaseUrl = proxy.baseUrl;
      const chain = await buildProviderChain(settings, keys, http, proxyBaseUrl, now);
      if (chain.providers.length === 0) {
        throw new ToolExecutionError('no_provider', noProviderMessage(chain.missingProvider));
      }
      let lastError: unknown = null;
      for (const provider of chain.providers) {
        try {
          const results = dedupeSourceRefs(await provider.search(input));
          return { results, provider: provider.id };
        } catch (error) {
          lastError = error;
        }
      }
      const mapped = mapTransportError(lastError, {
        browser: options.isBrowser ?? isBrowserEnvironment(),
        proxied: proxyBaseUrl !== null,
      });
      throw new ToolExecutionError(mapped.code, mapped.message);
    },
  };
}

export function dedupeSourceRefs(results: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const unique: SourceRef[] = [];
  for (const result of results) {
    const key = canonicalUrlKey(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return unique;
}

interface ProviderChain {
  providers: SearchProvider[];
  missingProvider: string | null;
}

async function buildProviderChain(
  settings: SearchSettings,
  keys: KeyVault,
  http: HttpClient,
  proxyBaseUrl: string | null,
  now: () => number,
): Promise<ProviderChain> {
  const mode = settings.mode;
  const braveKey = mode === 'auto' || mode === 'brave' ? await keys.get(BRAVE_KEY_REF) : null;
  const tavilyKey = mode === 'auto' || mode === 'tavily' ? await keys.get(TAVILY_KEY_REF) : null;
  const includeDuckDuckGo = mode === 'auto' || mode === 'duckduckgo';
  const providers: SearchProvider[] = [];

  if (proxyBaseUrl !== null) {
    if (braveKey !== null) {
      providers.push(createProxySearchProvider({ http, baseUrl: proxyBaseUrl, provider: 'brave', apiKey: braveKey, now }));
    }
    if (tavilyKey !== null) {
      providers.push(createProxySearchProvider({ http, baseUrl: proxyBaseUrl, provider: 'tavily', apiKey: tavilyKey, now }));
    }
    if (includeDuckDuckGo) {
      providers.push(createProxySearchProvider({ http, baseUrl: proxyBaseUrl, provider: 'duckduckgo', apiKey: null, now }));
    }
  } else {
    if (braveKey !== null) providers.push(createBraveProvider({ http, apiKey: braveKey, now }));
    if (tavilyKey !== null) providers.push(createTavilyProvider({ http, apiKey: tavilyKey, now }));
    if (includeDuckDuckGo) providers.push(createDuckDuckGoProvider({ http, now }));
  }

  if (providers.length > 0) return { providers, missingProvider: null };
  const missingProvider = mode === 'brave' ? 'Brave Search' : mode === 'tavily' ? 'Tavily' : null;
  return { providers, missingProvider };
}

function noProviderMessage(missingProvider: string | null): string {
  if (missingProvider !== null) {
    return `${missingProvider} is selected but has no API key. Add the key in Settings, or switch to DuckDuckGo.`;
  }
  return 'No search provider is configured. Add a Brave or Tavily API key in Settings, or select DuckDuckGo.';
}

function canonicalUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}
