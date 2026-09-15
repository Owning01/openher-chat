/**
 * Configuración compartible: un paquete con proveedores + secretos + ajustes
 * mínimos para que otro dispositivo quede andando sin configurar nada
 * (modelo activo, nivel de pensamiento, API keys).
 *
 * Alcance deliberado: SOLO configuración. Nunca incluye conversaciones,
 * expedientes, ni historial. Los secretos viajan en texto plano dentro del
 * archivo: quien lo tenga usa la cuenta del exportador (ver aviso en la UI).
 */
import type { ChatDefaults, Locale } from '../types/settings';
import type { ModelInfo, ProviderConfig, ProviderKind } from '../types/provider';

/** Versión del formato; `parse` rechaza cualquier otra. */
export const SHARE_CONFIG_VERSION = 1;

/** Proveedor + su secreto (`null` = sin key en el exportador; se pide a mano). */
export interface SharedProvider {
  config: ProviderConfig;
  secret: string | null;
}

/** Ajustes que viajan: lo necesario para chatear igual, nada más. */
export interface SharedSettings {
  activeProviderId: string | null;
  lastModelByProvider: Record<string, string>;
  chat: ChatDefaults;
  locale: Locale;
}

export interface SharePayload {
  app: 'openher-chat';
  version: 1;
  exportedAt: number;
  providers: SharedProvider[];
  settings: SharedSettings;
}

const PROVIDER_KINDS: readonly ProviderKind[] = [
  'openai-compatible',
  'anthropic',
  'openai-responses',
  'opencode',
];

export interface BuildShareInput {
  providers: readonly ProviderConfig[];
  /** Secretos por keyRef (`provider:<id>`); ausente = `secret: null`. */
  secrets: Readonly<Record<string, string>>;
  settings: {
    activeProviderId: string | null;
    lastModelByProvider: Record<string, string>;
    chat: ChatDefaults;
    locale: Locale;
  };
  now: number;
}

/** Arma el payload desde estado ya resuelto (puro, nunca lanza). */
export function buildSharePayload(input: BuildShareInput): SharePayload {
  return {
    app: 'openher-chat',
    version: SHARE_CONFIG_VERSION,
    exportedAt: input.now,
    providers: input.providers.map((config) => ({
      config,
      secret:
        config.keyRef === null ? null : (input.secrets[config.keyRef] ?? null),
    })),
    settings: {
      activeProviderId: input.settings.activeProviderId,
      lastModelByProvider: { ...input.settings.lastModelByProvider },
      chat: { ...input.settings.chat },
      locale: input.settings.locale,
    },
  };
}

/**
 * Parser tolerante de un archivo importado: devuelve `null` si no es un
 * paquete válido (versión, tipos, URL http(s), kind/thinking/locale
 * conocidos). Nunca lanza.
 */
export function parseSharePayload(raw: unknown): SharePayload | null {
  const root = asRecord(raw);
  if (root === null) return null;
  if (root.app !== 'openher-chat') return null;
  if (root.version !== SHARE_CONFIG_VERSION) return null;
  if (typeof root.exportedAt !== 'number' || !Number.isFinite(root.exportedAt)) return null;
  if (!Array.isArray(root.providers) || root.providers.length === 0) return null;

  const providers: SharedProvider[] = [];
  for (const entry of root.providers) {
    const parsed = parseSharedProvider(entry);
    if (parsed === null) return null;
    providers.push(parsed);
  }

  const settings = parseSharedSettings(root.settings);
  if (settings === null) return null;

  return { app: 'openher-chat', version: 1, exportedAt: root.exportedAt, providers, settings };
}

function parseSharedProvider(value: unknown): SharedProvider | null {
  const record = asRecord(value);
  if (record === null) return null;
  const config = parseProviderConfig(record.config);
  if (config === null) return null;
  const secret = record.secret;
  if (secret !== null && (typeof secret !== 'string' || secret === '')) return null;
  return { config, secret };
}

function parseProviderConfig(value: unknown): ProviderConfig | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (typeof record.id !== 'string' || record.id.trim() === '') return null;
  if (typeof record.label !== 'string' || record.label.trim() === '') return null;
  if (!isProviderKind(record.kind)) return null;
  if (typeof record.baseUrl !== 'string' || !isHttpUrl(record.baseUrl)) return null;
  if (typeof record.requiresKey !== 'boolean') return null;
  if (record.keyRef !== null && (typeof record.keyRef !== 'string' || record.keyRef.trim() === '')) return null;
  if (!Array.isArray(record.models)) return null;
  const models: ModelInfo[] = [];
  for (const entry of record.models) {
    const model = parseModelInfo(entry);
    if (model === null) return null;
    models.push(model);
  }
  const defaultModelId = record.defaultModelId;
  if (defaultModelId !== null && typeof defaultModelId !== 'string') return null;
  const createdAt = record.createdAt;
  const updatedAt = record.updatedAt;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  return {
    id: record.id,
    label: record.label,
    kind: record.kind,
    baseUrl: record.baseUrl,
    requiresKey: record.requiresKey,
    keyRef: record.keyRef,
    models,
    defaultModelId,
    ...(asRecord(record.quirks) === null ? {} : { quirks: record.quirks }),
    ...(asRecord(record.extraHeaders) === null ? {} : { extraHeaders: record.extraHeaders }),
    createdAt,
    updatedAt,
  } as ProviderConfig;
}

function parseModelInfo(value: unknown): ModelInfo | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (typeof record.id !== 'string' || record.id.trim() === '') return null;
  if (typeof record.label !== 'string') return null;
  if (record.source !== 'api' && record.source !== 'manual') return null;
  return { id: record.id, label: record.label, source: record.source } as ModelInfo;
}

function parseSharedSettings(value: unknown): SharedSettings | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (record.activeProviderId !== null && typeof record.activeProviderId !== 'string') return null;
  if (asRecord(record.lastModelByProvider) === null) return null;
  const lastModelByProvider: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record.lastModelByProvider as Record<string, unknown>)) {
    if (typeof entry !== 'string') return null;
    lastModelByProvider[key] = entry;
  }
  const chat = parseChatDefaults(record.chat);
  if (chat === null) return null;
  const locale = record.locale;
  if (locale !== 'es' && locale !== 'en') return null;
  return { activeProviderId: record.activeProviderId, lastModelByProvider, chat, locale };
}

function parseChatDefaults(value: unknown): ChatDefaults | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (typeof record.systemPrompt !== 'string') return null;
  if (typeof record.temperature !== 'number' || !Number.isFinite(record.temperature)) return null;
  if (record.maxOutputTokens !== null && (typeof record.maxOutputTokens !== 'number' || !Number.isFinite(record.maxOutputTokens))) {
    return null;
  }
  const thinking = record.thinking;
  if (thinking !== 'off' && thinking !== 'low' && thinking !== 'medium' && thinking !== 'high' && thinking !== 'max') {
    return null;
  }
  return {
    systemPrompt: record.systemPrompt,
    temperature: record.temperature,
    maxOutputTokens: record.maxOutputTokens,
    thinking,
  };
}

function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && (PROVIDER_KINDS as readonly string[]).includes(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
