import { describe, expect, it } from 'vitest';
import { PROVIDER_TEMPLATES, getProviderTemplate } from './catalog';

describe('PROVIDER_TEMPLATES', () => {
  it('incluye los ocho proveedores aprobados', () => {
    expect(PROVIDER_TEMPLATES.map((template) => template.id)).toEqual([
      'groq',
      'cerebras',
      'openai',
      'deepseek',
      'ollama',
      'lmstudio',
      'vllm',
      'anthropic',
    ]);
  });

  it('no hardcodea modelos ni defaultModelId', () => {
    for (const template of PROVIDER_TEMPLATES) {
      expect(template.models).toEqual([]);
      expect(template.defaultModelId).toBeNull();
      expect(template.label.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  it('define kind, baseUrl y requiresKey por proveedor', () => {
    expect(getProviderTemplate('groq')).toMatchObject({
      kind: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      requiresKey: true,
      quirks: { includeUsage: true, sendToolChoice: true },
    });
    expect(getProviderTemplate('cerebras')).toMatchObject({ baseUrl: 'https://api.cerebras.ai/v1', requiresKey: true });
    expect(getProviderTemplate('openai')).toMatchObject({ baseUrl: 'https://api.openai.com/v1', requiresKey: true });
    expect(getProviderTemplate('deepseek')).toMatchObject({ baseUrl: 'https://api.deepseek.com/v1', requiresKey: true });
    expect(getProviderTemplate('anthropic')).toMatchObject({
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      requiresKey: true,
    });
  });

  it('marca los servidores locales sin API key', () => {
    expect(getProviderTemplate('ollama')).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434/v1',
      requiresKey: false,
      kind: 'openai-compatible',
    });
    expect(getProviderTemplate('lmstudio')).toMatchObject({ baseUrl: 'http://127.0.0.1:1234/v1', requiresKey: false });
    expect(getProviderTemplate('vllm')).toMatchObject({ baseUrl: 'http://127.0.0.1:8000/v1', requiresKey: false });
  });

  it('getProviderTemplate devuelve undefined para ids desconocidos', () => {
    expect(getProviderTemplate('nope')).toBeUndefined();
  });
});
