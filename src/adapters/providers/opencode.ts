/**
 * Router de OpenCode Zen: un único proveedor heterogéneo que expone todos los
 * modelos del gateway `https://opencode.ai/zen/v1` y despacha cada uno al
 * endpoint correcto (`/chat/completions`, `/messages` o `/responses`).
 *
 * No implementa SSE propio: recibe las factorías de los adapters concretos
 * (`OpenCodeDelegates`) y les delega el stream, construyéndolas una sola vez
 * por adapter de forma perezosa.
 */

import type { AdapterDeps, ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ModelApi, ModelInfo, ProviderCapabilities, ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import { mapHttpStatus } from './errors';
import { parseOpenAIModelList } from './modelList';

/** Factoría de un adapter concreto (chat-completions, messages o responses). */
export type AdapterFactory = (config: ProviderConfig, deps: AdapterDeps) => ProviderAdapter;

/** Adapters concretos inyectados para cada transporte del gateway. */
export interface OpenCodeDelegates {
  'chat-completions': AdapterFactory;
  messages: AdapterFactory;
  responses: AdapterFactory;
}

const LIST_MODELS_TIMEOUT_MS = 10_000;

/** Go exige una sesión estable por conversación para enrutado y caché de prompt. */
export const OPENCODE_SESSION_HEADER = 'x-opencode-session';

/** Identifica al cliente ante el gateway (stats y control de abuso de OpenCode). */
export const OPENCODE_CLIENT_HEADER = 'x-opencode-client';
export const OPENCODE_CLIENT = 'openher-chat';

/** GLM/Zhipu rechaza los marcadores `cache_control` en el gateway: se omiten. */
export function isOpenCodeCacheUnsupported(modelId: string): boolean {
  return /glm|zhipu/i.test(modelId);
}

/**
 * Cabeceras de OpenCode. Siempre identifica al cliente; añade la sesión estable
 * cuando el runner la provee (la usa para routing y caché de prompt).
 */
export function buildOpenCodeHeaders(sessionId: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT };
  const id = sessionId?.trim();
  if (id !== undefined && id !== '') headers[OPENCODE_SESSION_HEADER] = id;
  return headers;
}

/**
 * Clasifica el transporte de un modelo de OpenCode por prefijo de id.
 * Tabla congelada; función pura y total (nunca lanza).
 *
 * La variante importa: en Go, MiniMax se sirve por `/messages`
 * (`@ai-sdk/anthropic`), mientras que en Zen va por `/chat/completions`.
 */
export function classifyOpenCodeModelApi(modelId: string, variant: OpenCodeVariant = 'zen'): ModelApi {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith('claude') || id.startsWith('qwen')) return 'messages';
  if (variant === 'go' && id.startsWith('minimax')) return 'messages';
  if (id.startsWith('gpt') || id.startsWith('grok') || id.startsWith('muse-spark')) return 'responses';
  return 'chat-completions';
}

/** Gateway de OpenCode: Zen (pago por uso) o Go (suscripción de modelos open). */
export type OpenCodeVariant = 'zen' | 'go';

/** Deriva la variante de la base URL (`/zen/go/` = Go; si no, Zen). */
export function openCodeVariantFromBaseUrl(baseUrl: string): OpenCodeVariant {
  return /\/zen\/go(\/|$)/.test(baseUrl) ? 'go' : 'zen';
}

/**
 * OpenCode no emite cabeceras CORS, así que en el dev server de Vite se
 * reescribe `https://opencode.ai` a la ruta relativa `/zen`, que Vite proxya al
 * gateway. Fuera de dev se deja la URL absoluta: Android nativo usa
 * `CapacitorHttp` (esquiva CORS) y el build web no tiene este proxy.
 */
export function resolveOpenCodeBaseUrl(baseUrl: string, useViteProxy: boolean): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (!useViteProxy) return normalized;
  return normalized.replace(/^https?:\/\/opencode\.ai(?=\/|$)/, '');
}

/** Solo `vite dev` (MODE=development); en Vitest es `test` y en build `production`. */
const USE_VITE_PROXY = import.meta.env.MODE === 'development';

export function createOpenCodeAdapter(
  config: ProviderConfig,
  deps: AdapterDeps,
  delegates: OpenCodeDelegates,
): ProviderAdapter {
  const baseUrl = resolveOpenCodeBaseUrl(config.baseUrl, USE_VITE_PROXY);
  const variant = openCodeVariantFromBaseUrl(config.baseUrl);
  // El adapter hoja arma las URLs desde `config.baseUrl`; si hubo rewrite (dev),
  // le pasamos una copia con la ruta proxada para que el chat también la use.
  // Habilita la instrumentación de caché en los adapters hoja (clave de sesión +
  // marcadores); el gateway de OpenCode acepta ambos y los traduce/ignora según
  // el upstream del modelo.
  const requestConfig: ProviderConfig = {
    ...config,
    baseUrl,
    quirks: { ...config.quirks, promptCache: true, cacheControl: true },
  };
  const delegateCache = new Map<ModelApi, ProviderAdapter>();

  /** Construye (una sola vez por api) el adapter concreto, con fallback seguro. */
  function resolveDelegate(api: ModelApi): ProviderAdapter {
    const cached = delegateCache.get(api);
    if (cached !== undefined) return cached;
    const factory = delegates[api] ?? delegates['chat-completions'];
    const adapter = factory(requestConfig, deps);
    delegateCache.set(api, adapter);
    return adapter;
  }

  /** Override explícito en `config.models`; si falta, se infiere del id. */
  function resolveModelApi(modelId: string): ModelApi {
    const model = config.models.find((entry) => entry.id === modelId);
    return model?.api ?? classifyOpenCodeModelApi(modelId, variant);
  }

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await deps.http.request({
      url: `${baseUrl}/models`,
      method: 'GET',
      headers: buildHeaders(config, deps.apiKey, 'application/json'),
      timeoutMs: LIST_MODELS_TIMEOUT_MS,
      signal,
    });
    if (response.status < 200 || response.status >= 300) {
      throw mapHttpStatus(response.status, response.text, findHeader(response.headers, 'retry-after'), deps.now());
    }
    return parseOpenAIModelList(response.text).map((model) => ({
      ...model,
      api: classifyOpenCodeModelApi(model.id, variant),
      supportsTools: true,
    }));
  }

  async function* streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    const api = resolveModelApi(request.modelId);
    const delegated: ChatCompletionRequest = {
      ...request,
      extraHeaders: { ...request.extraHeaders, ...buildOpenCodeHeaders(request.sessionId) },
      cache: {
        ...request.cache,
        cacheControl: request.cache?.cacheControl !== false && !isOpenCodeCacheUnsupported(request.modelId),
        retention: variant === 'go' ? '24h' : undefined,
      },
    };
    yield* resolveDelegate(api).streamChat(delegated);
  }

  const capabilities = (): ProviderCapabilities => ({
    streaming: true,
    toolCalling: true,
    systemPrompt: true,
    listModels: true,
    // Delega en chat-completions/messages/responses, todos con visión.
    images: true,
  });

  return {
    providerId: config.id,
    kind: 'opencode',
    capabilities,
    listModels,
    streamChat,
  };
}

// ---------------------------------------------------------------------------
// Headers (misma semántica que el adapter OpenAI-compatible)
// ---------------------------------------------------------------------------

function buildHeaders(config: ProviderConfig, apiKey: string | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = { ...config.extraHeaders };
  removeHeader(headers, 'accept');
  headers.Accept = accept;
  if (config.requiresKey && apiKey !== undefined && apiKey !== '') {
    removeHeader(headers, 'authorization');
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function removeHeader(headers: Record<string, string>, name: string): void {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) delete headers[key];
  }
}
