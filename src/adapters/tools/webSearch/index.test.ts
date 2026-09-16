import { describe, expect, it } from 'vitest';
import type { SearchSettings } from '@/domain/types/settings';
import {
  BRAVE_DUPLICATE_PAYLOAD,
  BRAVE_PAYLOAD,
  DDG_HTML,
  EXA_SSE,
  PROXY_SEARCH_PAYLOAD,
  TAVILY_PAYLOAD,
} from '../__fixtures__/searchData';
import { FIXED_NOW, fakeHttp, httpError, jsonResponse, keyVaultWith, textResponse } from '../__fixtures__/fakes';
import { ToolExecutionError } from '../errors';
import { BRAVE_KEY_REF } from './brave';
import { createSearchService, dedupeSourceRefs } from './index';
import type { SearchInput } from './index';
import { TAVILY_KEY_REF } from './tavily';

function searchSettings(overrides: Partial<SearchSettings> = {}): SearchSettings {
  return { mode: 'auto', maxResults: 5, defaultFreshness: 'week', safeSearch: false, ...overrides };
}

function input(overrides: Partial<SearchInput> = {}): SearchInput {
  return { query: 'test query', maxResults: 5, freshness: 'week', signal: new AbortController().signal, ...overrides };
}

const KEYS = keyVaultWith({ [BRAVE_KEY_REF]: 'brave-key', [TAVILY_KEY_REF]: 'tavily-key' });

describe('createSearchService — cadena de fallback', () => {
  it('auto: Brave 401 → Tavily responde', async () => {
    const http = fakeHttp((request) => {
      if (request.url.startsWith('https://api.search.brave.com')) return jsonResponse({}, 401);
      if (request.url.startsWith('https://api.tavily.com')) return jsonResponse(TAVILY_PAYLOAD);
      return jsonResponse({}, 500);
    });
    const service = createSearchService(searchSettings(), KEYS, http, { now: () => FIXED_NOW, isBrowser: true });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('tavily');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.url).toBe('https://tavily.example/page');
    expect(http.requests).toHaveLength(2);
  });

  it('auto: error de red en Brave → Tavily responde', async () => {
    const http = fakeHttp((request) => {
      if (request.url.startsWith('https://api.search.brave.com')) throw httpError('network', 'failed to fetch');
      return jsonResponse(TAVILY_PAYLOAD);
    });
    const service = createSearchService(searchSettings(), KEYS, http, { now: () => FIXED_NOW, isBrowser: true });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('tavily');
  });

  it('auto: Brave, Tavily y Exa fallan → DuckDuckGo HTML', async () => {
    const http = fakeHttp((request) => {
      if (request.url.startsWith('https://api.search.brave.com')) return jsonResponse({}, 500);
      if (request.url.startsWith('https://api.tavily.com')) return jsonResponse({}, 500);
      if (request.url.startsWith('https://mcp.exa.ai')) return jsonResponse({}, 500);
      return textResponse(DDG_HTML);
    });
    const service = createSearchService(searchSettings(), KEYS, http, { now: () => FIXED_NOW, isBrowser: true });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('duckduckgo');
    expect(outcome.results).toHaveLength(2);
  });

  it('auto sin keys usa Exa (MCP keyless) directo', async () => {
    const http = fakeHttp((request) => {
      if (request.url.startsWith('https://mcp.exa.ai')) return textResponse(EXA_SSE);
      return textResponse(DDG_HTML);
    });
    const service = createSearchService(searchSettings(), keyVaultWith({}), http, { now: () => FIXED_NOW, isBrowser: true });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('exa');
    expect(outcome.results.map((result) => result.url)).toEqual(['https://exa.example/one', 'https://exa.example/two']);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.url.startsWith('https://mcp.exa.ai')).toBe(true);
  });

  it('explícito Exa sin key no consulta Brave ni Tavily', async () => {
    const http = fakeHttp(() => textResponse(EXA_SSE));
    const service = createSearchService(searchSettings({ mode: 'exa' }), keyVaultWith({}), http, {
      now: () => FIXED_NOW,
      isBrowser: true,
    });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('exa');
    expect(http.requests).toHaveLength(1);
  });

  it('auto: todo falla con red en navegador → cors_blocked accionable', async () => {
    const http = fakeHttp(() => {
      throw httpError('network', 'failed to fetch');
    });
    const service = createSearchService(searchSettings(), keyVaultWith({}), http, { now: () => FIXED_NOW, isBrowser: true });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('cors_blocked');
    expect((error as ToolExecutionError).message).toMatch(/proxy/i);
  });

  it('auto: todo falla con red en nativo → network (sin cors_blocked)', async () => {
    const http = fakeHttp(() => {
      throw httpError('network', 'offline');
    });
    const service = createSearchService(searchSettings(), keyVaultWith({}), http, { now: () => FIXED_NOW, isBrowser: false });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect((error as ToolExecutionError).code).toBe('network');
  });

  it('explícito Brave sin key → no_provider con mensaje claro', async () => {
    const service = createSearchService(searchSettings({ mode: 'brave' }), keyVaultWith({}), fakeHttp(() => jsonResponse({})), {
      now: () => FIXED_NOW,
    });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('no_provider');
    expect((error as ToolExecutionError).message).toContain('Brave Search');
  });

  it('explícito Tavily no consulta Brave', async () => {
    const http = fakeHttp(() => jsonResponse(TAVILY_PAYLOAD));
    const service = createSearchService(searchSettings({ mode: 'tavily' }), KEYS, http, { now: () => FIXED_NOW });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('tavily');
    expect(http.requests.every((request) => request.url.startsWith('https://api.tavily.com'))).toBe(true);
  });

  it('timeout se mapea a timeout', async () => {
    const http = fakeHttp(() => {
      throw httpError('timeout');
    });
    const service = createSearchService(searchSettings({ mode: 'tavily' }), KEYS, http, { now: () => FIXED_NOW, isBrowser: true });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect((error as ToolExecutionError).code).toBe('timeout');
  });

  it('deduplica resultados por URL (ignorando fragmento)', async () => {
    const http = fakeHttp(() => jsonResponse(BRAVE_DUPLICATE_PAYLOAD));
    const service = createSearchService(searchSettings({ mode: 'brave' }), KEYS, http, { now: () => FIXED_NOW });
    const outcome = await service.search(input());
    expect(outcome.results.map((result) => result.url)).toEqual(['https://example.com/one', 'https://example.com/two']);
  });

  it('dedupeSourceRefs conserva el primero y respeta el orden', () => {
    const deduped = dedupeSourceRefs([
      { url: 'https://a.example/x', title: 'A', accessedAt: FIXED_NOW },
      { url: 'https://a.example/x#frag', title: 'A2', accessedAt: FIXED_NOW },
      { url: 'https://b.example/', title: 'B', accessedAt: FIXED_NOW },
    ]);
    expect(deduped.map((result) => result.title)).toEqual(['A', 'B']);
  });
});

describe('createSearchService — proxy', () => {
  it('consulta el proxy con provider, body y X-Api-Key', async () => {
    const http = fakeHttp((request) => {
      if (request.url === 'https://proxy.example.com/v1/search') return jsonResponse(PROXY_SEARCH_PAYLOAD);
      return jsonResponse({}, 500);
    });
    const service = createSearchService(searchSettings({ mode: 'brave' }), KEYS, http, {
      now: () => FIXED_NOW,
      proxy: { mode: 'custom', baseUrl: 'https://proxy.example.com/', openCodeProxyUrl: null },
    });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('brave');
    expect(outcome.results.map((result) => result.url)).toEqual(['https://proxy.example/a', 'https://proxy.example/b']);
    const request = http.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.headers?.['X-Api-Key']).toBe('brave-key');
    expect(request?.body).toEqual({ provider: 'brave', query: 'test query', count: 5, freshness: 'week' });
  });

  it('cae al siguiente proveedor si el proxy responde 500', async () => {
    const http = fakeHttp((request) => {
      const body = request.body as { provider?: string } | undefined;
      if (body?.provider === 'brave') return jsonResponse({ error: 'boom' }, 500);
      return jsonResponse(TAVILY_PAYLOAD);
    });
    const service = createSearchService(searchSettings(), KEYS, http, {
      now: () => FIXED_NOW,
      proxy: { mode: 'custom', baseUrl: 'https://proxy.example.com/', openCodeProxyUrl: null },
    });
    const outcome = await service.search(input());
    expect(outcome.provider).toBe('tavily');
    expect(http.requests).toHaveLength(2);
    expect((http.requests[1]?.body as { provider?: string } | undefined)?.provider).toBe('tavily');
  });

  it('proxy con base inválida falla con invalid_proxy sin bypass directo', async () => {
    const http = fakeHttp(() => jsonResponse(BRAVE_PAYLOAD));
    const service = createSearchService(searchSettings({ mode: 'brave' }), KEYS, http, {
      now: () => FIXED_NOW,
      proxy: { mode: 'custom', baseUrl: 'ftp://proxy.example.com', openCodeProxyUrl: null },
    });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('invalid_proxy');
    expect((error as ToolExecutionError).message).toMatch(/proxy URL is invalid/i);
    expect(http.requests).toHaveLength(0);
  });

  it('proxy en modo custom sin URL falla con missing_proxy sin bypass directo', async () => {
    const http = fakeHttp(() => jsonResponse(BRAVE_PAYLOAD));
    const service = createSearchService(searchSettings({ mode: 'brave' }), KEYS, http, {
      now: () => FIXED_NOW,
      proxy: { mode: 'custom', baseUrl: null, openCodeProxyUrl: null },
    });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('missing_proxy');
    expect((error as ToolExecutionError).message).toMatch(/no proxy URL is set/i);
    expect(http.requests).toHaveLength(0);
  });

  it('proxy 401 se mapea a no_provider', async () => {
    const http = fakeHttp(() => jsonResponse({ error: 'unauthorized' }, 401));
    const service = createSearchService(searchSettings({ mode: 'brave' }), KEYS, http, {
      now: () => FIXED_NOW,
      proxy: { mode: 'custom', baseUrl: 'https://proxy.example.com', openCodeProxyUrl: null },
    });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('no_provider');
  });

  it('proxy caído en navegador produce mensaje accionable', async () => {
    const http = fakeHttp((request) => {
      if (request.url === 'https://proxy.example.com/v1/search') throw httpError('network');
      return jsonResponse({}, 500);
    });
    const service = createSearchService(searchSettings(), keyVaultWith({}), http, {
      now: () => FIXED_NOW,
      proxy: { mode: 'custom', baseUrl: 'https://proxy.example.com', openCodeProxyUrl: null },
      isBrowser: true,
    });
    const error = await service.search(input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).message).toMatch(/proxy/i);
  });
});
