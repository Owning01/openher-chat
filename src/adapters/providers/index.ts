/**
 * Registro de adapters de proveedor. Dispatch por `ProviderConfig.kind`.
 */

import type { AdapterDeps, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ProviderConfig } from '@/domain/types/provider';
import { createAnthropicAdapter } from './anthropic';
import { createOpenAICompatibleAdapter } from './openaiCompatible';

export type { ProviderAdapterDeps } from './openaiCompatible';
export { createAnthropicAdapter } from './anthropic';
export { createOpenAICompatibleAdapter } from './openaiCompatible';

export function createProviderAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAICompatibleAdapter(config, deps);
    case 'anthropic':
      return createAnthropicAdapter(config, deps);
    default: {
      const kind: never = config.kind;
      throw new Error(`unsupported provider kind: ${String(kind)}`);
    }
  }
}
