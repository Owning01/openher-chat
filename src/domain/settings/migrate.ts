import type { AgentBudget } from '../types/agent';
import type {
  AdversarialPerspective,
  DocumentKind,
  LegalAnalysisBudget,
  LegalJurisdiction,
  LegalMatter,
  LegalRetrievalBudget,
  LegalSettings,
} from '../types/legal';
import { THINKING_LEVELS } from '../types/provider';
import type {
  AppSettings,
  ChatDefaults,
  Freshness,
  HistoryBudget,
  Locale,
  ProxySettings,
  SearchMode,
  SearchSettings,
  ThemeMode,
  ToolSettings,
  UiSettings,
} from '../types/settings';
import { createDefaultSettings, SETTINGS_SCHEMA_VERSION } from './defaults';

type UnknownRecord = Record<string, unknown>;

const LOCALES: readonly Locale[] = ['es', 'en'];
const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const SEARCH_MODES: readonly SearchMode[] = ['auto', 'brave', 'tavily', 'duckduckgo', 'exa'];
const FRESHNESS: readonly Freshness[] = ['any', 'day', 'week', 'month', 'year'];

const LEGAL_JURISDICTIONS: readonly LegalJurisdiction[] = ['national', 'caba', 'pba', 'cordoba'];
const LEGAL_MATTERS: readonly LegalMatter[] = ['civil', 'commercial', 'civil-commercial'];
const LEGAL_ANONYMIZATION: readonly LegalSettings['anonymization'][] = ['required', 'optional'];
const ADVERSARIAL_PERSPECTIVES: readonly AdversarialPerspective[] = ['defense', 'attack', 'judge', 'risk'];
const DOCUMENT_KINDS: readonly DocumentKind[] = [
  'claim',
  'answer',
  'prior-exceptions',
  'counterclaim',
  'cautelar',
  'evidence',
  'closing',
  'appeal',
  'demand-letter',
  'contract',
  'bylaws',
];

/**
 * Migra settings desconocidos a un `AppSettings` válido. Nunca lanza: cualquier
 * campo faltante o inválido se completa con defaults y los numéricos se
 * acotan a rangos seguros. Idempotente y sin dependencias de entorno.
 */
export function migrateSettings(raw: unknown, now: number): AppSettings {
  try {
    return buildSettings(raw, now);
  } catch {
    return createDefaultSettings(now);
  }
}

function buildSettings(raw: unknown, now: number): AppSettings {
  const source = asRecord(raw);
  const base = createDefaultSettings(now);
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    locale: readEnum(source, 'locale', LOCALES, base.locale),
    theme: readEnum(source, 'theme', THEMES, base.theme),
    activeProviderId: readNullableId(source['activeProviderId']),
    lastModelByProvider: readStringMap(source['lastModelByProvider']),
    chat: migrateChat(source['chat'], base.chat),
    history: migrateHistory(source['history'], base.history),
    agent: migrateAgent(source['agent'], base.agent),
    tools: migrateTools(source['tools'], base.tools),
    search: migrateSearch(source['search'], base.search),
    proxy: migrateProxy(source['proxy'], base.proxy),
    ui: migrateUi(source['ui'], base.ui),
    legal: migrateLegal(source['legal'], base.legal),
    onboardingCompleted: readBoolean(source, 'onboardingCompleted', base.onboardingCompleted),
    updatedAt: readTimestamp(source['updatedAt'], now),
  };
}

function migrateChat(value: unknown, fallback: ChatDefaults): ChatDefaults {
  const source = asRecord(value);
  return {
    systemPrompt: readNonEmptyString(source['systemPrompt'], fallback.systemPrompt),
    temperature: readNumber(source, 'temperature', fallback.temperature, 0, 2),
    maxOutputTokens: readOptionalInt(source['maxOutputTokens'], 1, 200_000),
    thinking: readEnum(source, 'thinking', THINKING_LEVELS, fallback.thinking),
  };
}

function migrateHistory(value: unknown, fallback: HistoryBudget): HistoryBudget {
  const source = asRecord(value);
  return {
    mode: readEnum(source, 'mode', ['auto', 'fixed'] as const, fallback.mode),
    maxPromptTokens: readOptionalInt(source['maxPromptTokens'], 512, 2_000_000),
    reservedOutputTokens: readInt(source, 'reservedOutputTokens', fallback.reservedOutputTokens, 0, 32_768),
    keepLastTurns: readInt(source, 'keepLastTurns', fallback.keepLastTurns, 0, 50),
    truncateMessageAtPercent: readNumber(source, 'truncateMessageAtPercent', fallback.truncateMessageAtPercent, 0.05, 1),
  };
}

function migrateAgent(value: unknown, fallback: AgentBudget): AgentBudget {
  const source = asRecord(value);
  return {
    maxSteps: readInt(source, 'maxSteps', fallback.maxSteps, 1, 20),
    maxToolCalls: readInt(source, 'maxToolCalls', fallback.maxToolCalls, 0, 50),
    maxToolResultChars: readInt(source, 'maxToolResultChars', fallback.maxToolResultChars, 500, 200_000),
    maxTotalTokens: readInt(source, 'maxTotalTokens', fallback.maxTotalTokens, 1000, 2_000_000),
    maxWallClockMs: readInt(source, 'maxWallClockMs', fallback.maxWallClockMs, 5000, 1_800_000),
    maxRetriesPerStep: readInt(source, 'maxRetriesPerStep', fallback.maxRetriesPerStep, 0, 10),
    toolTimeoutMs: readInt(source, 'toolTimeoutMs', fallback.toolTimeoutMs, 1000, 120_000),
  };
}

function migrateTools(value: unknown, fallback: ToolSettings): ToolSettings {
  const source = asRecord(value);
  return {
    webSearchEnabled: readBoolean(source, 'webSearchEnabled', fallback.webSearchEnabled),
    openUrlEnabled: readBoolean(source, 'openUrlEnabled', fallback.openUrlEnabled),
    requireApproval: readBoolean(source, 'requireApproval', fallback.requireApproval),
  };
}

function migrateSearch(value: unknown, fallback: SearchSettings): SearchSettings {
  const source = asRecord(value);
  return {
    mode: readEnum(source, 'mode', SEARCH_MODES, fallback.mode),
    maxResults: readInt(source, 'maxResults', fallback.maxResults, 3, 10),
    defaultFreshness: readEnum(source, 'defaultFreshness', FRESHNESS, fallback.defaultFreshness),
    safeSearch: readBoolean(source, 'safeSearch', fallback.safeSearch),
  };
}

function migrateProxy(value: unknown, fallback: ProxySettings): ProxySettings {
  const source = asRecord(value);
  return {
    mode: readEnum(source, 'mode', ['direct', 'custom'] as const, fallback.mode),
    baseUrl: readNullableId(source['baseUrl']),
  };
}

function migrateUi(value: unknown, fallback: UiSettings): UiSettings {
  const source = asRecord(value);
  return {
    researchPanelVisible: readBoolean(source, 'researchPanelVisible', fallback.researchPanelVisible),
    autoCheckUpdates: readBoolean(source, 'autoCheckUpdates', fallback.autoCheckUpdates),
    cloudSync: readBoolean(source, 'cloudSync', fallback.cloudSync),
  };
}

/**
 * Sanea la sección legal sin lanzar: enums contra listas derivadas de los tipos,
 * claves de plantillas contra `DocumentKind`, personas filtradas y deduplicadas,
 * y topes numéricos acotados. Idempotente.
 */
export function migrateLegal(value: unknown, fallback: LegalSettings): LegalSettings {
  const source = asRecord(value);
  return {
    enabled: readBoolean(source, 'enabled', fallback.enabled),
    defaultJurisdiction: readEnum(source, 'defaultJurisdiction', LEGAL_JURISDICTIONS, fallback.defaultJurisdiction),
    defaultCourt: readText(source['defaultCourt'], fallback.defaultCourt),
    defaultMatter: readEnum(source, 'defaultMatter', LEGAL_MATTERS, fallback.defaultMatter),
    retrieval: migrateRetrieval(source['retrieval'], fallback.retrieval),
    analysis: migrateAnalysis(source['analysis'], fallback.analysis),
    anonymization: readEnum(source, 'anonymization', LEGAL_ANONYMIZATION, fallback.anonymization),
    perspectives: readPerspectives(source['perspectives'], fallback.perspectives),
    defaultTemplates: readDefaultTemplates(source['defaultTemplates'], fallback.defaultTemplates),
    setupCompleted: readBoolean(source, 'setupCompleted', fallback.setupCompleted),
  };
}

function migrateRetrieval(value: unknown, fallback: LegalRetrievalBudget): LegalRetrievalBudget {
  const source = asRecord(value);
  return {
    maxPassages: readBudgetInt(source['maxPassages'], fallback.maxPassages, 1, 50),
    maxPassageChars: readBudgetInt(source['maxPassageChars'], fallback.maxPassageChars, 200, 20_000),
    maxBriefTokens: readBudgetInt(source['maxBriefTokens'], fallback.maxBriefTokens, 500, 200_000),
  };
}

function migrateAnalysis(value: unknown, fallback: LegalAnalysisBudget): LegalAnalysisBudget {
  const source = asRecord(value);
  return {
    maxCalls: readBudgetInt(source['maxCalls'], fallback.maxCalls, 1, 20),
    maxTotalTokens: readBudgetInt(source['maxTotalTokens'], fallback.maxTotalTokens, 1000, 2_000_000),
    maxWallClockMs: readBudgetInt(source['maxWallClockMs'], fallback.maxWallClockMs, 1000, 1_800_000),
    maxParallel: readBudgetInt(source['maxParallel'], fallback.maxParallel, 1, 8),
    maxOutputTokensPerPersona: readBudgetInt(
      source['maxOutputTokensPerPersona'],
      fallback.maxOutputTokensPerPersona,
      100,
      32_000,
    ),
  };
}

function readPerspectives(value: unknown, fallback: readonly AdversarialPerspective[]): AdversarialPerspective[] {
  if (!Array.isArray(value)) return [...fallback];
  const result: AdversarialPerspective[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (!(ADVERSARIAL_PERSPECTIVES as readonly string[]).includes(entry)) continue;
    const perspective = entry as AdversarialPerspective;
    if (!result.includes(perspective)) result.push(perspective);
  }
  return result;
}

function readDefaultTemplates(
  value: unknown,
  fallback: LegalSettings['defaultTemplates'],
): LegalSettings['defaultTemplates'] {
  if (!isRecord(value)) return { ...fallback };
  const result: LegalSettings['defaultTemplates'] = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!(DOCUMENT_KINDS as readonly string[]).includes(key)) continue;
    if (typeof entry !== 'string' || entry.trim().length === 0) continue;
    result[key as DocumentKind] = entry;
  }
  return result;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function readNumber(source: UnknownRecord, key: string, fallback: number, min: number, max: number): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readInt(source: UnknownRecord, key: string, fallback: number, min: number, max: number): number {
  return Math.round(readNumber(source, key, fallback, min, max));
}

function readBoolean(source: UnknownRecord, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readEnum<T extends string>(source: UnknownRecord, key: string, allowed: readonly T[], fallback: T): T {
  const value = source[key];
  if (typeof value !== 'string') return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * Tope numérico entero: cualquier valor no finito o por debajo de `min` cae al
 * default (un presupuesto 0 o negativo no tiene sentido); los excesos se acotan
 * al máximo en vez de caer al default.
 */
function readBudgetInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return fallback;
  return Math.min(max, Math.round(value));
}

/** Texto libre saneado (recorta espacios); un valor no string cae al default. */
function readText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function readNullableId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readTimestamp(value: unknown, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return now;
  return Math.floor(value);
}

function readStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.length > 0) result[key] = entry;
  }
  return result;
}
