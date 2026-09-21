import type { AgentBudget } from './agent';
import type { LegalSettings } from './legal';
import type { ThinkingLevel } from './provider';

export type Locale = 'es' | 'en';
export type ThemeMode = 'light' | 'dark' | 'system';
export type SearchMode = 'auto' | 'brave' | 'tavily' | 'duckduckgo' | 'exa';
export type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface ChatDefaults {
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number | null;
  /** Nivel de pensamiento pedido al modelo; `off` = comportamiento actual. */
  thinking: ThinkingLevel;
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
  /**
   * Proxy propio para el gateway de OpenCode en web (p. ej. un VPS con
   * `proxy/main.go`): `null` = directo o `/zen` same-origin según plataforma.
   * No viaja en los paquetes compartidos (es infraestructura de cada uno).
   */
  openCodeProxyUrl: string | null;
  /**
   * Proxy X propio (VPS con `xproxy/`): habilita la tool `x_search` en el agente.
   * `null` = sin acceso a X. No viaja en paquetes compartidos.
   */
  xServiceUrl: string | null;
}

export interface UiSettings {
  /** Muestra el panel de investigación junto al chat; el modo sigue activo al ocultarlo. */
  researchPanelVisible: boolean;
  /** Comprueba si hay una versión nueva al abrir la app (única llamada de red de fondo). */
  autoCheckUpdates: boolean;
  /**
   * Espeja proveedores + secretos + ajustes mínimos en Firestore al iniciar
   * sesión (los baja si la nube tiene). Solo con login; apagable.
   */
  cloudSync: boolean;
  /** Variante de tema visual (34 temas disponibles, defecto: 'monochrome'). */
  themeVariant: string;
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
