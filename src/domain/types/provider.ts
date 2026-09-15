/** Familia de transporte de un proveedor. */
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'openai-responses' | 'opencode';

/** Transporte concreto de un modelo dentro de un proveedor que enruta por endpoint (OpenCode Zen). */
export type ModelApi = 'chat-completions' | 'messages' | 'responses';

/** Modelo expuesto por un proveedor (descubierto por API o agregado a mano). */
export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  /**
   * El modelo acepta controles de razonamiento en `/chat/completions`
   * (`reasoning_effort`). Los transportes nativos (Anthropic, Responses) no lo
   * necesitan; si falta se infiere del id (`inferThinkingSupport`).
   */
  supportsThinking?: boolean;
  /** Override de transporte para proveedores heterogéneos; si falta se infiere del id/kind. */
  api?: ModelApi;
  source: 'api' | 'manual';
}

/** Nivel de pensamiento pedido al modelo. `off` = comportamiento actual. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];

/** Ajustes específicos del proveedor al construir payloads. */
export interface ProviderQuirks {
  includeUsage?: boolean;
  sendToolChoice?: boolean;
  /** Añade `prompt_cache_key` (+ retención) al payload de `/chat/completions`. */
  promptCache?: boolean;
  /** Añade marcadores `cache_control` a los mensajes (gateways Anthropic-shaped). */
  cacheControl?: boolean;
  /**
   * Añade `enable_thinking: true` en `/chat/completions` (DashScope, Mistral y
   * gateways que lo exigen además de `reasoning_effort`).
   */
  enableThinking?: boolean;
}

/** Configuración persistida de un proveedor. La API key nunca vive aquí (ver KeyVault). */
export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  requiresKey: boolean;
  keyRef: string | null;
  extraHeaders?: Record<string, string>;
  models: ModelInfo[];
  defaultModelId: string | null;
  quirks?: ProviderQuirks;
  createdAt: number;
  updatedAt: number;
}

/** Capacidades resueltas de la pareja proveedor/modelo. */
export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  systemPrompt: boolean;
  listModels: boolean;
  images: boolean;
}
