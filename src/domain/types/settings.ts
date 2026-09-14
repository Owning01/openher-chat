import type { AgentBudget } from './agent';
import type { LegalSettings } from './legal';

export type Locale = 'es' | 'en';
export type ThemeMode = 'light' | 'dark' | 'system';
export type SearchMode = 'auto' | 'brave' | 'tavily' | 'duckduckgo' | 'exa';
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
  /** Pide confirmación al usuario antes de ejecutar cada tool (gate tipo permisos). */
  requireApproval: boolean;
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

export interface UiSettings {
  /** Muestra el panel de investigación junto al chat; el modo sigue activo al ocultarlo. */
  researchPanelVisible: boolean;
  /** Comprueba si hay una versión nueva al abrir la app (única llamada de red de fondo). */
  autoCheckUpdates: boolean;
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
  ui: UiSettings;
  legal: LegalSettings;
  onboardingCompleted: boolean;
  updatedAt: number;
}
