/**
 * Registro de adapters de proveedor. Dispatch por `ProviderConfig.kind`.
 */

import type { AdapterDeps, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ProviderConfig } from '@/domain/types/provider';
import { createAnthropicAdapter } from './anthropic';
import { createOpenAICompatibleAdapter } from './openaiCompatible';
import { createOpenAIResponsesAdapter } from './openaiResponses';
import { createOpenCodeAdapter } from './opencode';
import type { OpenCodeDelegates } from './opencode';

export type { ProviderAdapterDeps } from './openaiCompatible';
export { createAnthropicAdapter } from './anthropic';
export { createOpenAICompatibleAdapter } from './openaiCompatible';
export { createOpenAIResponsesAdapter } from './openaiResponses';
export { createOpenCodeAdapter, classifyOpenCodeModelApi, openCodeVariantFromBaseUrl } from './opencode';
export type { OpenCodeDelegates, AdapterFactory, OpenCodeVariant } from './opencode';
export { parseOpenAIModelList } from './modelList';

/** Adapters hoja que el router de OpenCode Zen usa para cada familia de endpoint. */
const OPENCODE_DELEGATES: OpenCodeDelegates = {
  'chat-completions': createOpenAICompatibleAdapter,
  messages: createAnthropicAdapter,
  responses: createOpenAIResponsesAdapter,
};

export function createProviderAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAICompatibleAdapter(config, deps);
    case 'anthropic':
      return createAnthropicAdapter(config, deps);
    case 'openai-responses':
      return createOpenAIResponsesAdapter(config, deps);
    case 'opencode':
      return createOpenCodeAdapter(config, deps, OPENCODE_DELEGATES);
    default: {
      const kind: never = config.kind;
      throw new Error(`unsupported provider kind: ${String(kind)}`);
    }
  }
}
