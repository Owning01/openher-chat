import type { SourceRef } from '../types/chat';
import type { Freshness } from '../types/settings';

export interface SearchProvider {
  readonly id: 'brave' | 'tavily' | 'duckduckgo' | 'exa';
  search(input: { query: string; maxResults: number; freshness: Freshness; signal: AbortSignal }): Promise<SourceRef[]>;
}
