import type { HttpClient } from '@/domain/ports/HttpClient';
import type { SearchProvider } from '@/domain/ports/SearchProvider';
import type { SourceRef } from '@/domain/types/chat';
import type { Freshness } from '@/domain/types/settings';
import { asArray, asRecord, asString } from '../values';
import { PROVIDER_TIMEOUT_MS, requestJson } from './shared';

export const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
export const BRAVE_KEY_REF = 'search:brave';

const BRAVE_FRESHNESS: Record<Freshness, string | null> = {
  any: null,
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

export interface BraveProviderDeps {
  http: HttpClient;
  apiKey: string;
  now: () => number;
}

export function createBraveProvider(deps: BraveProviderDeps): SearchProvider {
  return {
    id: 'brave',
    async search(input) {
      const params = new URLSearchParams();
      params.set('q', input.query);
      params.set('count', String(input.maxResults));
      const freshness = BRAVE_FRESHNESS[input.freshness];
      if (freshness !== null) params.set('freshness', freshness);
      const payload = await requestJson(
        deps.http,
        {
          url: `${BRAVE_SEARCH_ENDPOINT}?${params.toString()}`,
          method: 'GET',
          headers: { Accept: 'application/json', 'X-Subscription-Token': deps.apiKey },
          timeoutMs: PROVIDER_TIMEOUT_MS,
          signal: input.signal,
        },
        'Brave Search',
      );
      return parseBraveResults(payload, deps.now());
    },
  };
}

export function parseBraveResults(payload: unknown, accessedAt: number): SourceRef[] {
  const root = asRecord(payload);
  const web = root === null ? null : asRecord(root.web);
  const items = web === null ? null : asArray(web.results);
  if (items === null) return [];
  const sources: SourceRef[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) continue;
    const url = asString(record.url);
    if (url === null || url.trim() === '') continue;
    const title = asString(record.title) ?? url;
    const snippet = asString(record.description);
    const source: SourceRef = { url, title, accessedAt };
    if (snippet !== null && snippet.trim() !== '') source.snippet = snippet;
    sources.push(source);
  }
  return sources;
}
