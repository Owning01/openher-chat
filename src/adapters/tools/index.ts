/**
 * Registry de tools web (`web_search`, `open_url`) con JSON Schema formal,
 * descripciones en inglés, timeout y cap de resultado para el modelo.
 * Los errores se devuelven como `ToolResult` (nunca lanzan hacia el agent loop).
 */

import { truncateText } from '@/domain/chat/truncateText';
import type { HttpClient } from '@/domain/ports/HttpClient';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { SourceRef, ToolResult } from '@/domain/types/chat';
import type { AppSettings, Freshness } from '@/domain/types/settings';
import type { Skill } from '@/domain/types/skill';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { ToolExecutionError, mapTransportError } from './errors';
import { OPEN_URL_TIMEOUT_MS, openUrl } from './openUrl';
import { isBrowserEnvironment } from './platform';
import { resolveProxyBaseUrl } from './proxy';
import type { ProxyResolution } from './proxy';
import { createSearchService } from './webSearch';
import type { SearchService } from './webSearch';
import { createLoadSkillTool } from './loadSkill';
import { createXSearchTool } from './xSearch';

export const WEB_SEARCH_TOOL_NAME = 'web_search';
export const OPEN_URL_TOOL_NAME = 'open_url';
export const WEB_SEARCH_TIMEOUT_MS = 15_000;
export const WEB_SEARCH_MAX_RESULT_CHARS = 4_000;
export const OPEN_URL_MAX_RESULT_CHARS = 6_000;

const WEB_SEARCH_DISABLED_MESSAGE = 'Web search is disabled in Settings. Enable it to search again.';
const OPEN_URL_DISABLED_MESSAGE = 'Page reading (open_url) is disabled in Settings. Enable it to read web pages.';
const FRESHNESS_VALUES: readonly Freshness[] = ['any', 'day', 'week', 'month', 'year'];

export interface ToolRegistryDeps {
  http: HttpClient;
  keys: KeyVault;
  now?: () => number;
  /**
   * Skills guardadas que este turno puede cargar con `load_skill`. Sin skills
   * (o lista vacía) la tool no se expone y el registry queda como siempre.
   */
  skills?: readonly Skill[];
}

export function createToolRegistry(settings: AppSettings, deps: ToolRegistryDeps): ToolRegistry {
  const now = deps.now ?? Date.now;
  const browser = isBrowserEnvironment();
  const proxy = resolveProxyBaseUrl(settings.proxy);
  const searchService = createSearchService(settings.search, deps.keys, deps.http, {
    now,
    proxy: settings.proxy,
    isBrowser: browser,
  });
  const webSearch = createWebSearchTool(settings, searchService, now, browser, proxy.baseUrl !== null);
  const readUrl = createOpenUrlTool(settings, deps, now, browser, proxy);
  // Tool X opcional: solo con el proxy propio configurado en Ajustes.
  const tools: ToolDefinition[] = [webSearch, readUrl];
  if (settings.proxy.xServiceUrl !== null && settings.proxy.xServiceUrl.trim() !== '') {
    try {
      tools.push(createXSearchTool({ http: deps.http, baseUrl: settings.proxy.xServiceUrl, now }));
    } catch {
      // URL inválida: se ignora la tool, el resto del turno sigue igual.
    }
  }
  // Skills: sólo si el turno tiene alguna guardada (el prompt las lista).
  if (deps.skills !== undefined && deps.skills.length > 0) {
    tools.push(createLoadSkillTool({ skills: deps.skills, now }));
  }
  return {
    list: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
  };
}

function createWebSearchTool(
  settings: AppSettings,
  searchService: SearchService,
  now: () => number,
  browser: boolean,
  proxied: boolean,
): ToolDefinition {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the web for current information. Returns ranked results with title, URL and snippet; cite them as [n] in the answer.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query. Use specific keywords and include the topic or date when relevant.' },
        count: { type: 'integer', description: 'Maximum number of results to return (1-10). Defaults to the configured value.' },
        freshness: {
          type: 'string',
          enum: ['any', 'day', 'week', 'month', 'year'],
          description: 'Restrict results by recency: any, day, week, month or year. Defaults to the configured value.',
        },
      },
      required: ['query'],
    },
    timeoutMs: WEB_SEARCH_TIMEOUT_MS,
    maxResultChars: WEB_SEARCH_MAX_RESULT_CHARS,
    async execute(args, context) {
      const startedAt = now();
      try {
        if (!settings.tools.webSearchEnabled) throw new ToolExecutionError('no_provider', WEB_SEARCH_DISABLED_MESSAGE);
        const query = readStringArg(args, 'query');
        if (query === null) {
          throw new ToolExecutionError('invalid_args', 'The "query" argument is required and must be a non-empty string.');
        }
        const count = readCountArg(args, settings.search.maxResults);
        const freshness = readFreshnessArg(args, settings.search.defaultFreshness);
        const outcome = await searchService.search({ query, maxResults: count, freshness, signal: context.signal });
        const result: ToolResult = {
          ok: true,
          content: formatSearchResults(outcome.results),
          sources: outcome.results,
          provider: outcome.provider,
          durationMs: Math.max(0, now() - startedAt),
        };
        return withLimit(result, WEB_SEARCH_MAX_RESULT_CHARS);
      } catch (error) {
        const mapped = mapTransportError(error, { browser, proxied });
        return { ok: false, content: mapped.message, error: mapped, durationMs: Math.max(0, now() - startedAt) };
      }
    },
  };
}

function createOpenUrlTool(
  settings: AppSettings,
  deps: ToolRegistryDeps,
  now: () => number,
  browser: boolean,
  proxy: ProxyResolution,
): ToolDefinition {
  return {
    name: OPEN_URL_TOOL_NAME,
    description:
      'Open a web page and extract its main readable text. Use it on a URL from web_search when you need details or quotes.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL of the page to open.' },
      },
      required: ['url'],
    },
    timeoutMs: OPEN_URL_TIMEOUT_MS,
    maxResultChars: OPEN_URL_MAX_RESULT_CHARS,
    async execute(args, context) {
      const startedAt = now();
      try {
        if (!settings.tools.openUrlEnabled) throw new ToolExecutionError('no_provider', OPEN_URL_DISABLED_MESSAGE);
        if (proxy.error !== null) throw new ToolExecutionError(proxy.error.code, proxy.error.message);
        const url = readStringArg(args, 'url');
        if (url === null) {
          throw new ToolExecutionError('invalid_args', 'The "url" argument is required and must be a non-empty string.');
        }
        const result = await openUrl(
          { url },
          context,
          { http: deps.http, now, proxyBaseUrl: proxy.baseUrl, readerFallback: browser && proxy.baseUrl === null },
        );
        return withLimit(result, OPEN_URL_MAX_RESULT_CHARS);
      } catch (error) {
        const mapped = mapTransportError(error, { browser, proxied: proxy.baseUrl !== null });
        return { ok: false, content: mapped.message, error: mapped, durationMs: Math.max(0, now() - startedAt) };
      }
    },
  };
}

function readStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readCountArg(args: Record<string, unknown>, fallback: number): number {
  const raw = args.count;
  if (raw === undefined || raw === null) return clampCount(fallback);
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new ToolExecutionError('invalid_args', 'The "count" argument must be an integer between 1 and 10.');
  }
  return clampCount(raw);
}

function clampCount(value: number): number {
  return Math.min(10, Math.max(1, value));
}

function readFreshnessArg(args: Record<string, unknown>, fallback: Freshness): Freshness {
  const raw = args.freshness;
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string') {
    for (const candidate of FRESHNESS_VALUES) {
      if (candidate === raw) return candidate;
    }
  }
  throw new ToolExecutionError('invalid_args', 'The "freshness" argument must be one of: any, day, week, month, year.');
}

function formatSearchResults(results: SourceRef[]): string {
  if (results.length === 0) return 'No results found.';
  return results
    .map((result, index) => {
      const lines = [`[${index + 1}] ${result.title}`, `URL: ${result.url}`];
      if (result.snippet !== undefined && result.snippet.trim() !== '') lines.push(`Snippet: ${result.snippet.trim()}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

function withLimit(result: ToolResult, maxResultChars: number): ToolResult {
  return { ...result, content: truncateText(result.content, maxResultChars) };
}
