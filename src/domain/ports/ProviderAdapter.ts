import type { ModelInfo, ProviderCapabilities, ProviderKind, ThinkingLevel } from '../types/provider';
import type { StreamEvent, WireMessage } from '../types/stream';
import type { ToolDefinition } from '../types/tools';
import type { HttpClient, StreamTransport } from './HttpClient';

export interface ChatCompletionRequest {
  modelId: string;
  system?: string;
  messages: WireMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none';
  temperature?: number;
  maxOutputTokens?: number | null;
  /**
   * Nivel de pensamiento pedido. `off`/ausente = no se envía ningún parámetro
   * de razonamiento (comportamiento actual). Cada adapter lo traduce a su
   * transporte; ver `thinkingSupported`.
   */
  thinking?: ThinkingLevel;
  /**
   * El modelo acepta controles de razonamiento en `chat-completions`.
   * Los transportes nativos (Anthropic, Responses) lo ignoran: siempre saben.
   * Si falta se trata como `false` (no enviar nada: ante la duda, no romper).
   */
  thinkingSupported?: boolean;
  signal: AbortSignal;
  /**
   * Id opaco y estable de la conversación. Los adapters pueden mapearlo a sus
   * propias cabeceras (p. ej. OpenCode Go exige `x-opencode-session`) y usarlo
   * como clave de caché de prompt.
   */
  sessionId?: string;
  /** Cabeceras adicionales de esta request, aplicadas por encima de las del provider. */
  extraHeaders?: Record<string, string>;
  /**
   * Directivas de caché de prompt. `runAgent` pide caché (`cacheControl: true`)
   * y cada adapter decide cómo materializarla (marcadores `cache_control`, clave
   * de routing, retención) según su transporte.
   */
  cache?: PromptCacheDirectives;
}

/**
 * Directivas de caché de prompt pedidas por el runner y especializadas por cada
 * adapter. Asume que el prefijo cacheable (system + tools + historial) es
 * byte-estable entre turnos.
 */
export interface PromptCacheDirectives {
  /** Coloca marcadores `cache_control` efímeros en el prefijo estable. */
  cacheControl?: boolean;
  /** Retención extendida cuando el proveedor la soporta (OpenCode Go: `24h`). */
  retention?: '24h';
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly kind: ProviderKind;
  capabilities(): ProviderCapabilities;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  streamChat(request: ChatCompletionRequest): AsyncIterable<StreamEvent>;
}

export interface AdapterDeps {
  transport: StreamTransport;
  http: HttpClient;
  now: () => number;
  /** API key ya resuelta por el llamador (KeyVault); nunca se persiste en `ProviderConfig`. */
  apiKey?: string;
}
