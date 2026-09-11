import type { ModelInfo, ProviderCapabilities, ProviderConfig, ProviderKind } from '../types/provider';

/**
 * Capacidades por defecto del transporte. Anthropic soporta imágenes y no se
 * asume lo mismo de servidores OpenAI-compatible genéricos.
 */
export function defaultCapabilities(kind: ProviderKind): ProviderCapabilities {
  if (kind === 'anthropic') {
    return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: true };
  }
  return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: false };
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
    images: capabilities.images,
  };
}
