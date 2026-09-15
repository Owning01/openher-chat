import type { ModelInfo, ProviderCapabilities, ProviderConfig, ProviderKind } from '../types/provider';

/**
 * Capacidades por defecto del transporte. Los cuatro adapters implementan
 * payload multimodal, así que todos declaran `images: true` (fuente única de
 * verdad: `adapter.capabilities()`); el opt-out por modelo vive en
 * `ModelInfo.supportsImages` y lo aplica `resolveCapabilities`/`runAgent`.
 */
export function defaultCapabilities(kind: ProviderKind): ProviderCapabilities {
  void kind;
  return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: true };
}

/** Ajusta las capacidades del proveedor con los flags del modelo (`supportsTools !== false`). */
export function resolveCapabilities(config: ProviderConfig, model?: ModelInfo): ProviderCapabilities {
  const capabilities = defaultCapabilities(config.kind);
  if (model === undefined) return capabilities;
  return {
    streaming: capabilities.streaming && model.supportsStreaming !== false,
    toolCalling: capabilities.toolCalling && model.supportsTools !== false,
    systemPrompt: capabilities.systemPrompt,
    listModels: capabilities.listModels,
    images: capabilities.images && model.supportsImages !== false,
  };
}
