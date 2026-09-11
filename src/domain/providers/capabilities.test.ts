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
  it('openai-compatible: todo menos imágenes por defecto', () => {
    expect(defaultCapabilities('openai-compatible')).toEqual({
      streaming: true,
      toolCalling: true,
      systemPrompt: true,
      listModels: true,
      images: false,
    });
  });

  it('anthropic: incluye imágenes', () => {
    expect(defaultCapabilities('anthropic')).toEqual({
      streaming: true,
      toolCalling: true,
      systemPrompt: true,
      listModels: true,
      images: true,
    });
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

  it('no muta la config ni el modelo', () => {
    const beforeConfig = JSON.stringify(config);
    const beforeModel = JSON.stringify(model({ supportsTools: false }));
    resolveCapabilities(config, model({ supportsTools: false }));
    expect(JSON.stringify(config)).toBe(beforeConfig);
    expect(JSON.stringify(model({ supportsTools: false }))).toBe(beforeModel);
  });
});
