import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRAVE_DUPLICATE_PAYLOAD,
  BRAVE_PAYLOAD,
  DDG_HTML,
  EXA_RESULT_TEXT,
  EXA_SSE,
  TAVILY_PAYLOAD,
} from '../__fixtures__/searchData';
import { FIXED_NOW, fakeHttp, jsonResponse, textResponse } from '../__fixtures__/fakes';
import { ToolExecutionError } from '../errors';
import { createBraveProvider, parseBraveResults } from './brave';
import { createDuckDuckGoProvider, parseDuckDuckGoResults, resolveDuckDuckGoUrl } from './duckduckgo';
import { createExaProvider, extractMcpText, parseExaResults } from './exa';
import { createTavilyProvider, parseTavilyResults } from './tavily';

const signal = (): AbortSignal => new AbortController().signal;

describe('Brave', () => {
  it('arma query params, header y normaliza resultados', async () => {
    const http = fakeHttp(() => jsonResponse(BRAVE_PAYLOAD));
    const provider = createBraveProvider({ http, apiKey: 'brave-key', now: () => FIXED_NOW });
    const results = await provider.search({ query: 'rust 2026', maxResults: 3, freshness: 'week', signal: signal() });

    expect(results).toEqual([
      { url: 'https://example.com/alpha', title: 'Alpha Result', snippet: 'Alpha snippet', accessedAt: FIXED_NOW },
      { url: 'https://example.org/beta?x=1', title: 'Beta Result', snippet: 'Beta snippet', accessedAt: FIXED_NOW },
    ]);
    const request = http.requests[0];
    expect(request?.method).toBe('GET');
    expect(request?.headers?.['X-Subscription-Token']).toBe('brave-key');
    const url = new URL(request?.url ?? '');
    expect(url.searchParams.get('q')).toBe('rust 2026');
    expect(url.searchParams.get('count')).toBe('3');
    expect(url.searchParams.get('freshness')).toBe('pw');
  });

  it('omite freshness cuando es "any"', async () => {
    const http = fakeHttp(() => jsonResponse(BRAVE_PAYLOAD));
    const provider = createBraveProvider({ http, apiKey: 'brave-key', now: () => FIXED_NOW });
    await provider.search({ query: 'x', maxResults: 5, freshness: 'any', signal: signal() });
    const url = new URL(http.requests[0]?.url ?? '');
    expect(url.searchParams.has('freshness')).toBe(false);
  });

  it('normaliza 401 a no_provider', async () => {
    const http = fakeHttp(() => jsonResponse({ error: 'unauthorized' }, 401));
    const provider = createBraveProvider({ http, apiKey: 'bad', now: () => FIXED_NOW });
    const error = await provider.search({ query: 'x', maxResults: 5, freshness: 'any', signal: signal() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('no_provider');
  });

  it('devuelve [] ante payloads malformados', () => {
    expect(parseBraveResults(null, FIXED_NOW)).toEqual([]);
    expect(parseBraveResults({ web: { results: 'nope' } }, FIXED_NOW)).toEqual([]);
    expect(parseBraveResults({ web: { results: [null, { title: 'sin url' }] } }, FIXED_NOW)).toEqual([]);
  });
});

describe('Tavily', () => {
  it('hace POST con topic/days y bearer', async () => {
    const http = fakeHttp(() => jsonResponse(TAVILY_PAYLOAD));
    const provider = createTavilyProvider({ http, apiKey: 'tavily-key', now: () => FIXED_NOW });
    const results = await provider.search({ query: 'deep research', maxResults: 4, freshness: 'month', signal: signal() });

    expect(results).toEqual([
      { url: 'https://tavily.example/page', title: 'Tavily Hit', snippet: 'Tavily content', accessedAt: FIXED_NOW },
    ]);
    const request = http.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://api.tavily.com/search');
    expect(request?.headers?.Authorization).toBe('Bearer tavily-key');
    expect(request?.body).toEqual({ query: 'deep research', max_results: 4, topic: 'news', days: 30 });
  });

  it('usa topic general sin days para freshness any', async () => {
    const http = fakeHttp(() => jsonResponse(TAVILY_PAYLOAD));
    const provider = createTavilyProvider({ http, apiKey: 'tavily-key', now: () => FIXED_NOW });
    await provider.search({ query: 'x', maxResults: 2, freshness: 'any', signal: signal() });
    expect(http.requests[0]?.body).toEqual({ query: 'x', max_results: 2, topic: 'general' });
  });

  it('devuelve [] ante payloads malformados', () => {
    expect(parseTavilyResults({}, FIXED_NOW)).toEqual([]);
    expect(parseTavilyResults({ results: [{ content: 'sin url' }] }, FIXED_NOW)).toEqual([]);
  });
});

describe('DuckDuckGo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parsea con DOMParser y resuelve links uddg', () => {
    const results = parseDuckDuckGoResults(DDG_HTML, FIXED_NOW);
    expect(results).toEqual([
      { url: 'https://example.com/alpha?x=1', title: 'Alpha & Beta', snippet: 'First snippet text & more', accessedAt: FIXED_NOW },
      { url: 'https://example.org/beta', title: 'Second Result', snippet: 'Second snippet', accessedAt: FIXED_NOW },
    ]);
  });

  it('cae al parser regex cuando no hay DOMParser', () => {
    vi.stubGlobal('DOMParser', undefined);
    const results = parseDuckDuckGoResults(DDG_HTML, FIXED_NOW);
    expect(results).toEqual([
      { url: 'https://example.com/alpha?x=1', title: 'Alpha & Beta', snippet: 'First snippet text & more', accessedAt: FIXED_NOW },
      { url: 'https://example.org/beta', title: 'Second Result', snippet: 'Second snippet', accessedAt: FIXED_NOW },
    ]);
  });

  it('limita a maxResults', async () => {
    const http = fakeHttp(() => textResponse(DDG_HTML));
    const provider = createDuckDuckGoProvider({ http, now: () => FIXED_NOW });
    const results = await provider.search({ query: 'x', maxResults: 1, freshness: 'any', signal: signal() });
    expect(results).toHaveLength(1);
    expect(http.requests[0]?.url.startsWith('https://html.duckduckgo.com/html/?q=x')).toBe(true);
  });

  it('propaga status HTTP como http_error', async () => {
    const http = fakeHttp(() => textResponse('blocked', 503));
    const provider = createDuckDuckGoProvider({ http, now: () => FIXED_NOW });
    const error = await provider.search({ query: 'x', maxResults: 5, freshness: 'any', signal: signal() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('http_error');
  });

  it('resuelve hrefs directos, relativos y uddg', () => {
    expect(resolveDuckDuckGoUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(resolveDuckDuckGoUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb&rut=1')).toBe('https://example.com/b');
    expect(resolveDuckDuckGoUrl('/l/?uddg=https%3A%2F%2Fexample.com%2Fc')).toBe('https://example.com/c');
    expect(resolveDuckDuckGoUrl('javascript:alert(1)')).toBeNull();
    expect(resolveDuckDuckGoUrl(null)).toBeNull();
  });
});

describe('Exa (MCP, keyless)', () => {
  it('hace JSON-RPC tools/call y parsea los bloques del texto', async () => {
    const http = fakeHttp(() => textResponse(EXA_SSE));
    const provider = createExaProvider({ http, now: () => FIXED_NOW });
    const results = await provider.search({ query: 'mcp', maxResults: 5, freshness: 'any', signal: signal() });

    expect(results).toEqual([
      {
        url: 'https://exa.example/one',
        title: 'First Exa Hit',
        snippet: 'First highlight line with more detail',
        accessedAt: FIXED_NOW,
      },
      { url: 'https://exa.example/two', title: 'Second Exa Hit', snippet: 'Second highlight line', accessedAt: FIXED_NOW },
    ]);
    const request = http.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://mcp.exa.ai/mcp');
    expect(request?.headers?.['Content-Type']).toBe('application/json');
    expect(request?.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'web_search_exa', arguments: { query: 'mcp', numResults: 5 } },
    });
  });

  it('acepta JSON directo (sin SSE) y limita a maxResults', async () => {
    const http = fakeHttp(() => jsonResponse({ result: { content: [{ type: 'text', text: EXA_RESULT_TEXT }] } }));
    const provider = createExaProvider({ http, now: () => FIXED_NOW });
    const results = await provider.search({ query: 'x', maxResults: 1, freshness: 'any', signal: signal() });
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://exa.example/one');
  });

  it('extrae el texto del frame SSE y descarta cuerpos ajenos', () => {
    expect(extractMcpText(EXA_SSE)).toContain('First Exa Hit');
    expect(extractMcpText('nope')).toBeNull();
    expect(extractMcpText('{"result":{"content":[]}}')).toBeNull();
  });

  it('ignora bloques sin URL http(s)', () => {
    expect(parseExaResults('Title: No URL\nHighlights:\nfoo', FIXED_NOW)).toEqual([]);
  });

  it('propaga status HTTP como http_error', async () => {
    const http = fakeHttp(() => textResponse('boom', 500));
    const provider = createExaProvider({ http, now: () => FIXED_NOW });
    const error = await provider
      .search({ query: 'x', maxResults: 5, freshness: 'any', signal: signal() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect((error as ToolExecutionError).code).toBe('http_error');
  });
});

describe('dedupe de payloads crudos', () => {
  it('mantiene duplicados en el parser (el servicio deduplica)', () => {
    expect(parseBraveResults(BRAVE_DUPLICATE_PAYLOAD, FIXED_NOW)).toHaveLength(3);
  });
});
