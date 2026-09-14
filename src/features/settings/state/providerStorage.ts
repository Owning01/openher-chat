import type { ModelApi, ModelInfo, ProviderConfig, ProviderKind, ProviderQuirks } from '@/domain/types/provider';

import { isHttpUrl, isProviderKind } from './validation';

export const PROVIDERS_STORAGE_KEY = 'openher.providers.v1';

/** Persistencia local de `ProviderConfig[]`; nunca guarda secretos (la key vive en el KeyVault). */
export interface ProviderConfigRepository {
  load(): Promise<ProviderConfig[]>;
  save(providers: readonly ProviderConfig[]): Promise<void>;
}

export class LocalProviderConfigRepository implements ProviderConfigRepository {
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async load(): Promise<ProviderConfig[]> {
    const raw = readRaw();
    if (raw === null) return [];
    try {
      return sanitizeProviderConfigs(JSON.parse(raw), this.now());
    } catch {
      return [];
    }
  }

  async save(providers: readonly ProviderConfig[]): Promise<void> {
    const storage = getLocalStorage();
    if (storage === null) return;
    storage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(providers.map(toStoredProvider)));
  }
}

/** Normaliza una lista desconocida a `ProviderConfig[]` válidos, sin duplicar ids. */
export function sanitizeProviderConfigs(raw: unknown, now: number): ProviderConfig[] {
  if (!Array.isArray(raw)) return [];
  const configs: ProviderConfig[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const config = sanitizeProviderConfig(entry, now);
    if (config === null || seen.has(config.id)) continue;
    seen.add(config.id);
    configs.push(config);
  }
  return configs;
}

export function sanitizeProviderConfig(raw: unknown, now: number): ProviderConfig | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const id = readNonEmptyString(record.id);
  if (id === null) return null;
  const label = readNonEmptyString(record.label) ?? id;

  const rawKind = record.kind;
  const kind: ProviderKind = typeof rawKind === 'string' && isProviderKind(rawKind) ? rawKind : 'openai-compatible';

  const rawBaseUrl = readNonEmptyString(record.baseUrl);
  if (rawBaseUrl === null || !isHttpUrl(rawBaseUrl)) return null;
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  const requiresKey = record.requiresKey === true;
  const keyRef = requiresKey ? (readNonEmptyString(record.keyRef) ?? `provider:${id}`) : null;

  const models = sanitizeModelInfos(record.models);
  const rawDefaultModelId = readNonEmptyString(record.defaultModelId);
  const defaultModelId =
    rawDefaultModelId !== null && models.some((model) => model.id === rawDefaultModelId) ? rawDefaultModelId : null;

  const config: ProviderConfig = {
    id,
    label,
    kind,
    baseUrl,
    requiresKey,
    keyRef,
    models,
    defaultModelId,
    createdAt: readTimestamp(record.createdAt, now),
    updatedAt: readTimestamp(record.updatedAt, now),
  };

  const extraHeaders = sanitizeHeaders(record.extraHeaders);
  if (extraHeaders !== undefined) config.extraHeaders = extraHeaders;
  const quirks = sanitizeQuirks(record.quirks);
  if (quirks !== undefined) config.quirks = quirks;

  return config;
}

export function sanitizeModelInfos(raw: unknown): ModelInfo[] {
  if (!Array.isArray(raw)) return [];
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = readNonEmptyString(record.id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);

    const model: ModelInfo = {
      id,
      label: readNonEmptyString(record.label) ?? id,
      source: record.source === 'api' ? 'api' : 'manual',
    };
    const contextWindow = readPositiveInt(record.contextWindow);
    if (contextWindow !== null) model.contextWindow = contextWindow;
    if (typeof record.supportsTools === 'boolean') model.supportsTools = record.supportsTools;
    if (typeof record.supportsStreaming === 'boolean') model.supportsStreaming = record.supportsStreaming;
    const api = readModelApi(record.api);
    if (api !== null) model.api = api;
    models.push(model);
  }
  return models;
}

/** Proyección explícita: solo las claves públicas de `ProviderConfig` llegan al JSON. */
function toStoredProvider(config: ProviderConfig): ProviderConfig {
  const stored: ProviderConfig = {
    id: config.id,
    label: config.label,
    kind: config.kind,
    baseUrl: config.baseUrl,
    requiresKey: config.requiresKey,
    keyRef: config.keyRef,
    models: config.models.map((model) => ({ ...model })),
    defaultModelId: config.defaultModelId,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
  if (config.extraHeaders !== undefined && Object.keys(config.extraHeaders).length > 0) {
    stored.extraHeaders = { ...config.extraHeaders };
  }
  if (config.quirks !== undefined) {
    stored.quirks = { ...config.quirks };
  }
  return stored;
}

function sanitizeHeaders(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string' && entry !== '') headers[key] = entry;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function sanitizeQuirks(value: unknown): ProviderQuirks | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;
  const quirks: ProviderQuirks = {};
  if (typeof record.includeUsage === 'boolean') quirks.includeUsage = record.includeUsage;
  if (typeof record.sendToolChoice === 'boolean') quirks.sendToolChoice = record.sendToolChoice;
  if (typeof record.promptCache === 'boolean') quirks.promptCache = record.promptCache;
  if (typeof record.cacheControl === 'boolean') quirks.cacheControl = record.cacheControl;
  return Object.keys(quirks).length > 0 ? quirks : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

const MODEL_APIS: readonly ModelApi[] = ['chat-completions', 'messages', 'responses'];

function readModelApi(value: unknown): ModelApi | null {
  return typeof value === 'string' && (MODEL_APIS as readonly string[]).includes(value) ? (value as ModelApi) : null;
}

function readRaw(): string | null {
  const storage = getLocalStorage();
  if (storage === null) return null;
  try {
    return storage.getItem(PROVIDERS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
