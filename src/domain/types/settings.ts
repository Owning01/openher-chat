import type { AgentBudget } from './agent';

export type Locale = 'es' | 'en';
export type ThemeMode = 'light' | 'dark' | 'system';
export type SearchMode = 'auto' | 'brave' | 'tavily' | 'duckduckgo';
export type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface ChatDefaults {
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number | null;
}

export interface HistoryBudget {
  mode: 'auto' | 'fixed';
  maxPromptTokens: number | null;
  reservedOutputTokens: number;
  keepLastTurns: number;
  truncateMessageAtPercent: number;
}

export interface ToolSettings {
  webSearchEnabled: boolean;
  openUrlEnabled: boolean;
}

export interface SearchSettings {
  mode: SearchMode;
  maxResults: number;
  defaultFreshness: Freshness;
  safeSearch: boolean;
}

export interface ProxySettings {
  mode: 'direct' | 'custom';
  baseUrl: string | null;
}

export interface AppSettings {
  schemaVersion: number;
  locale: Locale;
  theme: ThemeMode;
  activeProviderId: string | null;
  lastModelByProvider: Record<string, string>;
  chat: ChatDefaults;
  history: HistoryBudget;
  agent: AgentBudget;
  tools: ToolSettings;
  search: SearchSettings;
  proxy: ProxySettings;
  onboardingCompleted: boolean;
  updatedAt: number;
}
