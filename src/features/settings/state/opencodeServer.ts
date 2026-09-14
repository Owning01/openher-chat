/**
 * Conector de solo lectura al servidor local de OpenCode (`opencode serve`).
 *
 * OpenCode expone `GET /global/health` y `GET /config/providers` (ver
 * docs/server). Este módulo importa el catálogo de proveedores/modelos ya
 * configurados en el harness local para que el usuario no los tipee.
 *
 * Alcance: es una fuente de catálogo, NO un transporte de chat. El servidor
 * expone un agente con sesiones, no completions planas, y las API keys no se
 * transfieren (viven en el harness). El parser es tolerante a variantes de
 * esquema porque el contrato exacto depende de la versión del servidor.
 */

import { classifyOpenCodeModelApi, openCodeVariantFromBaseUrl } from '@/adapters/providers/opencode';
import { getProviderTemplate } from '@/domain/providers/catalog';
import type { HttpClient } from '@/domain/ports/HttpClient';
import type { ModelApi, ModelInfo, ProviderKind, ProviderQuirks } from '@/domain/types/provider';

export const DEFAULT_OPENCODE_SERVER_URL = 'http://127.0.0.1:4096';
export const OPENCODE_HEALTH_PATH = '/global/health';
export const OPENCODE_PROVIDERS_PATH = '/config/providers';

export interface OpenCodeServerHealth {
  healthy: boolean;
  version: string | null;
}

/** Proveedor importable, ya normalizado al contrato de la app. */
export interface OpenCodeServerProvider {
  id: string;
  label: string;
  baseUrl: string;
  kind: ProviderKind;
  requiresKey: boolean;
  models: ModelInfo[];
  quirks?: ProviderQuirks;
}

export interface OpenCodeServerCatalog {
  baseUrl: string;
  health: OpenCodeServerHealth;
  providers: OpenCodeServerProvider[];
}

/** Ids del servidor que no coinciden con el id de plantilla de la app. */
const TEMPLATE_ALIASES: Record<string, string> = { opencode: 'opencode-zen' };

/** Normaliza una base http(s) sin slashes finales; `null` si es inválida. */
export function normalizeServerBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

/** `GET /global/health`; valida el transporte y devuelve healthy/version tolerante. */
export async function probeOpenCodeServer(baseUrl: string, http: HttpClient): Promise<OpenCodeServerHealth> {
  const base = normalizeServerBaseUrl(baseUrl);
  if (base === null) throw new Error('The OpenCode server URL is not a valid http(s) URL.');
  const response = await http.request({
    url: `${base}${OPENCODE_HEALTH_PATH}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: 5_000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The OpenCode server responded with HTTP ${response.status} on ${OPENCODE_HEALTH_PATH}.`);
  }
  const payload = asRecord(parseJson(response.text));
  return {
    healthy: payload?.healthy === true,
    version: asString(payload?.version),
  };
}

/** Explora salud + catálogo de proveedores/modelos del servidor local. */
export async function fetchOpenCodeServerCatalog(
  baseUrl: string,
  http: HttpClient,
): Promise<OpenCodeServerCatalog> {
  const base = normalizeServerBaseUrl(baseUrl);
  if (base === null) throw new Error('The OpenCode server URL is not a valid http(s) URL.');

  const health = await probeOpenCodeServer(base, http);
  if (!health.healthy) throw new Error('The OpenCode server is reachable but reports an unhealthy state.');

  const response = await http.request({
    url: `${base}${OPENCODE_PROVIDERS_PATH}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: 10_000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The OpenCode server responded with HTTP ${response.status} on ${OPENCODE_PROVIDERS_PATH}.`);
  }

  return { baseUrl: base, health, providers: mapProviders(parseJson(response.text)) };
}

/** Acepta `{ providers: [...] }`, `{ all: [...] }` o un array directo. */
export function mapProviders(payload: unknown): OpenCodeServerProvider[] {
  const root = asRecord(payload);
  const list = asArray(payload) ?? asArray(root?.providers) ?? asArray(root?.all) ?? [];
  const providers: OpenCodeServerProvider[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = asString(record.id);
    if (id === null || id === '' || seen.has(id)) continue;

    const template = getProviderTemplate(TEMPLATE_ALIASES[id] ?? id);
    const kind: ProviderKind = template?.kind ?? 'openai-compatible';
    const baseUrl = readProviderBaseUrl(record) ?? template?.baseUrl ?? null;
    if (baseUrl === null) continue;

    seen.add(id);
    const provider: OpenCodeServerProvider = {
      id,
      label: asString(record.name) ?? template?.label ?? id,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      kind,
      requiresKey: template?.requiresKey ?? hasNonEmptyArray(record.env),
      models: mapModels(record, kind, baseUrl),
    };
    if (template?.quirks !== undefined) provider.quirks = { ...template.quirks };
    providers.push(provider);
  }

  return providers;
}

function mapModels(record: Record<string, unknown>, kind: ProviderKind, baseUrl: string): ModelInfo[] {
  const raw = record.models;
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map((entry) => {
        const value = asRecord(entry);
        return [asString(value?.id) ?? '', entry] as [string, unknown];
      })
    : Object.entries(asRecord(raw) ?? {});

  const variant = openCodeVariantFromBaseUrl(baseUrl);
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const [rawId, info] of entries) {
    const detail = asRecord(info);
    const id = rawId.trim() !== '' ? rawId.trim() : (asString(detail?.id) ?? '');
    if (id === '' || seen.has(id)) continue;
    seen.add(id);

    const model: ModelInfo = {
      id,
      label: asString(detail?.name) ?? id,
      source: 'api',
    };
    const contextWindow = readContextWindow(detail);
    if (contextWindow !== null) model.contextWindow = contextWindow;
    const supportsTools = readSupportsTools(detail);
    if (supportsTools !== null) model.supportsTools = supportsTools;
    if (kind === 'opencode') {
      const api: ModelApi = classifyOpenCodeModelApi(id, variant);
      model.api = api;
    }
    models.push(model);
  }
  return models;
}

function readProviderBaseUrl(record: Record<string, unknown>): string | null {
  const options = asRecord(record.options);
  const raw = asString(options?.baseURL) ?? asString(options?.baseUrl);
  if (raw === null) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

function readContextWindow(detail: Record<string, unknown> | null): number | null {
  if (detail === null) return null;
  const limit = asRecord(detail.limit);
  const candidates = [limit?.context, detail.contextWindow, detail.context_length, detail.contextLength];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return Math.round(candidate);
  }
  return null;
}

function readSupportsTools(detail: Record<string, unknown> | null): boolean | null {
  if (detail === null) return null;
  if (typeof detail.tool_call === 'boolean') return detail.tool_call;
  if (typeof detail.toolCall === 'boolean') return detail.toolCall;
  if (typeof detail.supportsTools === 'boolean') return detail.supportsTools;
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}
