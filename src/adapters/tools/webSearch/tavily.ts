import type { HttpClient } from '@/domain/ports/HttpClient';
import type { SearchProvider } from '@/domain/ports/SearchProvider';
import type { SourceRef } from '@/domain/types/chat';
import type { Freshness } from '@/domain/types/settings';
import { asArray, asRecord, asString } from '../values';
import { PROVIDER_TIMEOUT_MS, requestJson } from './shared';

export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';
export const TAVILY_KEY_REF = 'search:tavily';

const TAVILY_DAYS: Record<Freshness, number | null> = {
  any: null,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export interface TavilyProviderDeps {
  http: HttpClient;
  apiKey: string;
  now: () => number;
}

export function createTavilyProvider(deps: TavilyProviderDeps): SearchProvider {
  return {
    id: 'tavily',
    async search(input) {
      const days = TAVILY_DAYS[input.freshness];
      const body: Record<string, unknown> = {
        query: input.query,
        max_results: input.maxResults,
        topic: days === null ? 'general' : 'news',
      };
      if (days !== null) body.days = days;
      const payload = await requestJson(
        deps.http,
        {
          url: TAVILY_SEARCH_ENDPOINT,
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${deps.apiKey}` },
          body,
          timeoutMs: PROVIDER_TIMEOUT_MS,
          signal: input.signal,
        },
        'Tavily',
      );
      return parseTavilyResults(payload, deps.now());
    },
  };
}

export function parseTavilyResults(payload: unknown, accessedAt: number): SourceRef[] {
  const root = asRecord(payload);
  const items = root === null ? null : asArray(root.results);
  if (items === null) return [];
  const sources: SourceRef[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) continue;
    const url = asString(record.url);
    if (url === null || url.trim() === '') continue;
    const title = asString(record.title) ?? url;
    const snippet = asString(record.content);
    const source: SourceRef = { url, title, accessedAt };
    if (snippet !== null && snippet.trim() !== '') source.snippet = snippet;
    sources.push(source);
  }
  return sources;
}
