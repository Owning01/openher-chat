/**
 * Registro de adapters de proveedor. Dispatch por `ProviderConfig.kind`.
 */

import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ProviderConfig } from '@/domain/types/provider';
import { createOpenAICompatibleAdapter } from './openaiCompatible';
import type { ProviderAdapterDeps } from './openaiCompatible';

export type { ProviderAdapterDeps } from './openaiCompatible';
export { createOpenAICompatibleAdapter } from './openaiCompatible';

export function createProviderAdapter(config: ProviderConfig, deps: ProviderAdapterDeps): ProviderAdapter {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAICompatibleAdapter(config, deps);
    case 'anthropic':
      throw new Error('anthropic adapter not available yet (T07)');
    default: {
      const kind: never = config.kind;
      throw new Error(`unsupported provider kind: ${String(kind)}`);
    }
  }
}
