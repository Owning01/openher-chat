import { describe, expect, it } from 'vitest';

import type { ModelInfo } from '@/domain/types/provider';

import { mergeApiModels, normalizeDefaultModelId } from './providerModels';

describe('mergeApiModels', () => {
  it('conserva overrides manuales y modelos manuales ausentes en la API', () => {
    const existing: ModelInfo[] = [
      { id: 'a', label: 'A', source: 'api', contextWindow: 8000, supportsTools: true },
      { id: 'm', label: 'Manual', source: 'manual', contextWindow: 2048 },
    ];
    const api: ModelInfo[] = [
      { id: 'a', label: 'A renombrado', source: 'api' },
      { id: 'b', label: 'B', source: 'api' },
      { id: 'a', label: 'Duplicado', source: 'api' },
    ];

    expect(mergeApiModels(existing, api)).toEqual([
      { id: 'a', label: 'A renombrado', source: 'api', contextWindow: 8000, supportsTools: true },
      { id: 'b', label: 'B', source: 'api' },
      { id: 'm', label: 'Manual', source: 'manual', contextWindow: 2048 },
    ]);
  });

  it('ignora ids vacíos y usa el id como label', () => {
    expect(mergeApiModels([], [{ id: ' ', label: '', source: 'api' }, { id: 'ok', label: '', source: 'api' }])).toEqual([
      { id: 'ok', label: 'ok', source: 'api' },
    ]);
  });

  it('sin modelos previos devuelve solo los de la API', () => {
    expect(mergeApiModels([], [{ id: 'x', label: 'X', source: 'api' }])).toEqual([
      { id: 'x', label: 'X', source: 'api' },
    ]);
  });
});

describe('normalizeDefaultModelId', () => {
  const models: ModelInfo[] = [
    { id: 'a', label: 'A', source: 'api' },
    { id: 'b', label: 'B', source: 'manual' },
  ];

  it('mantiene el default si existe', () => {
    expect(normalizeDefaultModelId('b', models)).toBe('b');
  });

  it('cae al primer modelo o a null', () => {
    expect(normalizeDefaultModelId('z', models)).toBe('a');
    expect(normalizeDefaultModelId(null, models)).toBe('a');
    expect(normalizeDefaultModelId('a', [])).toBeNull();
  });
});
