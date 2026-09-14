import type { AgentBudget } from '../types/agent';
import type {
  LegalAnalysisBudget,
  LegalRetrievalBudget,
  LegalSettings,
} from '../types/legal';
import type {
  AppSettings,
  ChatDefaults,
  HistoryBudget,
  ProxySettings,
  SearchSettings,
  ToolSettings,
  UiSettings,
} from '../types/settings';

export const SETTINGS_SCHEMA_VERSION = 1;

/** System prompt por defecto: breve, en inglés (texto para el modelo). */
export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer in the user language, be concise, and use Markdown when it improves clarity.';

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxSteps: 6,
  maxToolCalls: 8,
  maxToolResultChars: 6000,
  maxTotalTokens: 60000,
  maxWallClockMs: 120000,
  maxRetriesPerStep: 2,
  toolTimeoutMs: 15000,
};

export const DEFAULT_HISTORY_BUDGET: HistoryBudget = {
  mode: 'auto',
  maxPromptTokens: null,
  reservedOutputTokens: 2048,
  keepLastTurns: 6,
  truncateMessageAtPercent: 0.4,
};

export const DEFAULT_CHAT_DEFAULTS: ChatDefaults = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.7,
  maxOutputTokens: null,
};

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  webSearchEnabled: true,
  openUrlEnabled: true,
  requireApproval: false,
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  mode: 'auto',
  maxResults: 5,
  defaultFreshness: 'week',
  safeSearch: false,
};

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  mode: 'direct',
  baseUrl: null,
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
  researchPanelVisible: true,
  autoCheckUpdates: true,
};

/**
 * Presupuesto de recuperación léxica del brief: pocos pasajes y cortos para
 * mantener el sufijo efímero acotado; 8 pasajes de 1200 caracteres cubren un
 * escrito típico sin saturar el wire.
 */
export const DEFAULT_LEGAL_RETRIEVAL_BUDGET: LegalRetrievalBudget = {
  maxPassages: 8,
  maxPassageChars: 1200,
  maxBriefTokens: 6000,
};

/**
 * Presupuesto del análisis adversarial: 4 personas en paralelo + 1 síntesis.
 * El tope total (60000) y el reloj (120 s) siguen el orden del presupuesto del
 * agente; la salida por persona se acota para que la síntesis no desborde.
 */
export const DEFAULT_LEGAL_ANALYSIS_BUDGET: LegalAnalysisBudget = {
  maxCalls: 5,
  maxTotalTokens: 60000,
  maxWallClockMs: 120000,
  maxParallel: 4,
  maxOutputTokensPerPersona: 1500,
};

/** Defaults del modo legal: apagado y sin expediente preconfigurado; anonimización obligatoria. */
export const DEFAULT_LEGAL_SETTINGS: LegalSettings = {
  enabled: false,
  defaultJurisdiction: 'national',
  defaultCourt: '',
  defaultMatter: 'civil-commercial',
  retrieval: DEFAULT_LEGAL_RETRIEVAL_BUDGET,
  analysis: DEFAULT_LEGAL_ANALYSIS_BUDGET,
  anonymization: 'required',
  perspectives: ['defense', 'attack', 'judge', 'risk'],
  defaultTemplates: {},
  setupCompleted: false,
};

/** Base de settings sin `updatedAt`: usar `createDefaultSettings(now)` para obtener un AppSettings completo. */
export const DEFAULT_SETTINGS: Omit<AppSettings, 'updatedAt'> = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  locale: 'es',
  theme: 'system',
  activeProviderId: null,
  lastModelByProvider: {},
  chat: DEFAULT_CHAT_DEFAULTS,
  history: DEFAULT_HISTORY_BUDGET,
  agent: DEFAULT_AGENT_BUDGET,
  tools: DEFAULT_TOOL_SETTINGS,
  search: DEFAULT_SEARCH_SETTINGS,
  proxy: DEFAULT_PROXY_SETTINGS,
  ui: DEFAULT_UI_SETTINGS,
  legal: DEFAULT_LEGAL_SETTINGS,
  onboardingCompleted: false,
};

/** Crea settings frescos con timestamp inyectado y sin compartir objetos anidados entre instancias. */
export function createDefaultSettings(now: number): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    lastModelByProvider: {},
    chat: { ...DEFAULT_CHAT_DEFAULTS },
    history: { ...DEFAULT_HISTORY_BUDGET },
    agent: { ...DEFAULT_AGENT_BUDGET },
    tools: { ...DEFAULT_TOOL_SETTINGS },
    search: { ...DEFAULT_SEARCH_SETTINGS },
    proxy: { ...DEFAULT_PROXY_SETTINGS },
    ui: { ...DEFAULT_UI_SETTINGS },
    legal: {
      ...DEFAULT_LEGAL_SETTINGS,
      retrieval: { ...DEFAULT_LEGAL_SETTINGS.retrieval },
      analysis: { ...DEFAULT_LEGAL_SETTINGS.analysis },
      perspectives: [...DEFAULT_LEGAL_SETTINGS.perspectives],
      defaultTemplates: { ...DEFAULT_LEGAL_SETTINGS.defaultTemplates },
    },
    updatedAt: now,
  };
}
