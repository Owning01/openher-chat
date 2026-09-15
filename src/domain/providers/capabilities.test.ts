import { describe, expect, it } from 'vitest';
import type { ModelInfo, ProviderConfig } from '../types/provider';
import { defaultCapabilities, resolveCapabilities } from './capabilities';

const config: ProviderConfig = {
  id: 'groq',
  label: 'Groq',
  kind: 'openai-compatible',
  baseUrl: 'https://api.groq.com/openai/v1',
  requiresKey: true,
  keyRef: null,
  models: [],
  defaultModelId: null,
  createdAt: 0,
  updatedAt: 0,
};

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return { id: 'm1', label: 'Model 1', source: 'api', ...overrides };
}

describe('defaultCapabilities', () => {
  it('todos los transportes declaran imágenes (el opt-out es por modelo)', () => {
    for (const kind of ['openai-compatible', 'anthropic', 'openai-responses', 'opencode'] as const) {
      expect(defaultCapabilities(kind).images).toBe(true);
    }
  });
});

describe('resolveCapabilities', () => {
  it('sin modelo devuelve los defaults del kind', () => {
    expect(resolveCapabilities(config)).toEqual(defaultCapabilities('openai-compatible'));
  });

  it('respeta supportsTools !== false', () => {
    expect(resolveCapabilities(config, model({ supportsTools: false })).toolCalling).toBe(false);
    expect(resolveCapabilities(config, model({ supportsTools: true })).toolCalling).toBe(true);
    expect(resolveCapabilities(config, model()).toolCalling).toBe(true);
  });

  it('respeta supportsStreaming !== false', () => {
    expect(resolveCapabilities(config, model({ supportsStreaming: false })).streaming).toBe(false);
    expect(resolveCapabilities(config, model({ supportsStreaming: true })).streaming).toBe(true);
  });

  it('respeta supportsImages !== false (opt-out por modelo solo-texto)', () => {
    expect(resolveCapabilities(config, model({ supportsImages: false })).images).toBe(false);
    expect(resolveCapabilities(config, model({ supportsImages: true })).images).toBe(true);
    expect(resolveCapabilities(config, model()).images).toBe(true);
  });

  it('no muta la config ni el modelo', () => {
    const beforeConfig = JSON.stringify(config);
    const beforeModel = JSON.stringify(model({ supportsTools: false }));
    resolveCapabilities(config, model({ supportsTools: false }));
    expect(JSON.stringify(config)).toBe(beforeConfig);
    expect(JSON.stringify(model({ supportsTools: false }))).toBe(beforeModel);
  });
});
