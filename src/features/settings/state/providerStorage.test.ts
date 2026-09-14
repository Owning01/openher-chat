import { beforeEach, describe, expect, it } from 'vitest';

import type { ProviderConfig } from '@/domain/types/provider';

import {
  LocalProviderConfigRepository,
  PROVIDERS_STORAGE_KEY,
  sanitizeModelInfos,
  sanitizeProviderConfig,
} from './providerStorage';

const NOW = 1_700_000_000_000;

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    label: 'Proveedor',
    kind: 'openai-compatible',
    baseUrl: 'https://api.test/v1',
    requiresKey: true,
    keyRef: 'provider:p1',
    models: [
      { id: 'm1', label: 'Modelo', contextWindow: 8000, supportsTools: true, source: 'api' },
      { id: 'm2', label: 'Manual', source: 'manual' },
    ],
    defaultModelId: 'm1',
    extraHeaders: { 'X-Test': '1' },
    quirks: { includeUsage: true },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('LocalProviderConfigRepository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trip de configs sin secretos', async () => {
    const repo = new LocalProviderConfigRepository(() => NOW);
    const provider = makeProvider();

    await repo.save([provider]);

    const stored = localStorage.getItem(PROVIDERS_STORAGE_KEY) ?? '';
    expect(stored).toContain('provider:p1');
    expect(stored).not.toContain('sk-');
    expect(await repo.load()).toEqual([provider]);
  });

  it('proyecta solo claves públicas: ignora secretos colados en la config', async () => {
    const repo = new LocalProviderConfigRepository(() => NOW);
    const rogue = { ...makeProvider(), apiKey: 'sk-rogue' } as ProviderConfig;

    await repo.save([rogue]);

    expect(localStorage.getItem(PROVIDERS_STORAGE_KEY) ?? '').not.toContain('sk-rogue');
  });

  it('JSON corrupto devuelve lista vacía', async () => {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, '{"id":');
    const repo = new LocalProviderConfigRepository(() => NOW);
    expect(await repo.load()).toEqual([]);
  });

  it('descarta entradas inválidas y normaliza defaults', async () => {
    localStorage.setItem(
      PROVIDERS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'ok',
          label: '',
          kind: 'desconocido',
          baseUrl: 'https://x.test/v1/',
          requiresKey: true,
          models: [
            { id: 'm1', source: 'api', contextWindow: -5, supportsTools: 'sí' },
            { id: 'm1', label: 'Duplicado' },
            { id: '' },
          ],
          defaultModelId: 'no-existe',
        },
        { id: 'bad', baseUrl: 'ftp://x.test' },
        'texto',
      ]),
    );

    const repo = new LocalProviderConfigRepository(() => NOW);
    const loaded = await repo.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('ok');
    expect(loaded[0]?.label).toBe('ok');
    expect(loaded[0]?.kind).toBe('openai-compatible');
    expect(loaded[0]?.baseUrl).toBe('https://x.test/v1');
    expect(loaded[0]?.keyRef).toBe('provider:ok');
    expect(loaded[0]?.defaultModelId).toBeNull();
    expect(loaded[0]?.models).toEqual([{ id: 'm1', label: 'm1', source: 'api' }]);
  });
});

describe('sanitizeProviderConfig', () => {
  it('exige id no vacío y URL http(s)', () => {
    expect(sanitizeProviderConfig(null, NOW)).toBeNull();
    expect(sanitizeProviderConfig({}, NOW)).toBeNull();
    expect(sanitizeProviderConfig({ id: 'x' }, NOW)).toBeNull();
    expect(sanitizeProviderConfig({ id: 'x', baseUrl: 'file:///etc/passwd' }, NOW)).toBeNull();
    expect(sanitizeProviderConfig({ id: 'x', baseUrl: 'https://x.test' }, NOW)).not.toBeNull();
  });

  it('sin requiresKey no conserva keyRef', () => {
    const config = sanitizeProviderConfig(
      { id: 'x', baseUrl: 'https://x.test', requiresKey: false, keyRef: 'provider:x' },
      NOW,
    );
    expect(config?.keyRef).toBeNull();
  });
});

describe('sanitizeModelInfos', () => {
  it('normaliza ids, labels y overrides', () => {
    expect(
      sanitizeModelInfos([
        { id: 'm', contextWindow: 4096.6, supportsStreaming: true },
        { id: 'm', label: 'duplicado' },
        null,
        42,
      ]),
    ).toEqual([{ id: 'm', label: 'm', source: 'manual', contextWindow: 4097, supportsStreaming: true }]);
    expect(sanitizeModelInfos('nope')).toEqual([]);
  });
});

describe('sanitizeModelInfos adversarial', () => {
  it('preserva una api válida', () => {
    expect(sanitizeModelInfos([{ id: 'm', api: 'responses' }])).toEqual([
      { id: 'm', label: 'm', source: 'manual', api: 'responses' },
    ]);
  });

  it('descarta una api desconocida', () => {
    expect(sanitizeModelInfos([{ id: 'm', api: 'bogus' }])).toEqual([{ id: 'm', label: 'm', source: 'manual' }]);
  });

  it('acepta un id __proto__ como dato sin romper', () => {
    const models = sanitizeModelInfos([{ id: '__proto__' }]);
    expect(models[0]?.id).toBe('__proto__');
  });
});
