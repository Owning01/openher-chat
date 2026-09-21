import { describe, expect, it } from 'vitest';
import { ensureZenFreeModels, isZenFreeModel, ZEN_FREE_MODELS } from './zenFreeModels';

describe('zenFreeModels', () => {
  it('detecta correctamente modelos free por id', () => {
    expect(isZenFreeModel('deepseek-v4-flash-free')).toBe(true);
    expect(isZenFreeModel('big-pickle')).toBe(true);
    expect(isZenFreeModel('muse-spark-1.3-contributor')).toBe(true);
    expect(isZenFreeModel('claude-3-5-sonnet')).toBe(false);
  });

  it('ensureZenFreeModels agrega todos los modelos free a una lista vacía', () => {
    const result = ensureZenFreeModels([]);
    expect(result.length).toBe(ZEN_FREE_MODELS.length);
    expect(result.some((m) => m.id === 'deepseek-v4-flash-free')).toBe(true);
    expect(result.some((m) => m.id === 'big-pickle')).toBe(true);
  });

  it('ensureZenFreeModels preserva modelos existentes sin duplicar', () => {
    const existing = [
      { id: 'custom-model', label: 'Mi Modelo', source: 'manual' as const },
      { id: 'deepseek-v4-flash-free', label: 'DeepSeek Flash', source: 'api' as const },
    ];
    const result = ensureZenFreeModels(existing);
    expect(result.some((m) => m.id === 'custom-model')).toBe(true);
    const deepseeks = result.filter((m) => m.id === 'deepseek-v4-flash-free');
    expect(deepseeks.length).toBe(1);
    expect(deepseeks[0]?.label).toContain('(Free)');
  });
});
