import { describe, expect, it } from 'vitest';

import { migrateSettings } from '@/domain/settings/migrate';
import type { AgentBudget } from '@/domain/types/agent';

import {
  AGENT_BUDGET_LIMITS,
  HISTORY_BUDGET_LIMITS,
  SEARCH_LIMITS,
  TEMPERATURE_LIMITS,
  clampToRange,
  hasProviderDraftErrors,
  isHttpUrl,
  isProviderKind,
  isWithinRange,
  validateMaxResults,
  validateProviderDraft,
  validateTemperature,
} from './validation';

describe('validación de proveedores', () => {
  it('isHttpUrl acepta solo http/https absolutas', () => {
    expect(isHttpUrl('https://api.test/v1')).toBe(true);
    expect(isHttpUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isHttpUrl('ftp://api.test')).toBe(false);
    expect(isHttpUrl('api.test')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('exige label y URL http(s) válida', () => {
    const errors = validateProviderDraft({
      label: '   ',
      kind: 'openai-compatible',
      baseUrl: 'no-es-url',
      requiresKey: true,
    });
    expect(errors).toEqual({ label: 'required', baseUrl: 'invalid_url' });
    expect(hasProviderDraftErrors(errors)).toBe(true);

    const valid = validateProviderDraft({
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:1234/v1',
      requiresKey: false,
    });
    expect(hasProviderDraftErrors(valid)).toBe(false);
  });

  it('reconoce solo los kinds del catálogo', () => {
    expect(isProviderKind('openai-compatible')).toBe(true);
    expect(isProviderKind('anthropic')).toBe(true);
    expect(isProviderKind('gemini')).toBe(false);
    expect(isProviderKind('')).toBe(false);
  });
});

describe('rangos numéricos', () => {
  it('temperature 0-2 y maxResults 3-10', () => {
    expect(validateTemperature(0)).toBe(true);
    expect(validateTemperature(2)).toBe(true);
    expect(validateTemperature(-0.1)).toBe(false);
    expect(validateTemperature(2.1)).toBe(false);
    expect(validateTemperature(Number.NaN)).toBe(false);

    expect(validateMaxResults(3)).toBe(true);
    expect(validateMaxResults(10)).toBe(true);
    expect(validateMaxResults(2)).toBe(false);
    expect(validateMaxResults(11)).toBe(false);
  });

  it('clampToRange acota y cae al mínimo con NaN', () => {
    expect(clampToRange(5, 0, 2)).toBe(2);
    expect(clampToRange(-5, 0, 2)).toBe(0);
    expect(clampToRange(1, 0, 2)).toBe(1);
    expect(clampToRange(Number.POSITIVE_INFINITY, 3, 10)).toBe(10);
    expect(clampToRange(Number.NaN, 3, 10)).toBe(3);
  });

  it('isWithinRange rechaza no finitos', () => {
    expect(isWithinRange(3, 3, 10)).toBe(true);
    expect(isWithinRange(Number.POSITIVE_INFINITY, 3, 10)).toBe(false);
    expect(isWithinRange(Number.NaN, 3, 10)).toBe(false);
  });

  it('los límites declarados coinciden con los clamps de migrateSettings', () => {
    for (const key of Object.keys(AGENT_BUDGET_LIMITS) as (keyof AgentBudget)[]) {
      const limits = AGENT_BUDGET_LIMITS[key];
      const below = migrateSettings({ agent: { [key]: limits.min - 1 } }, 0).agent[key];
      const above = migrateSettings({ agent: { [key]: limits.max + 1 } }, 0).agent[key];
      expect(below).toBe(limits.min);
      expect(above).toBe(limits.max);
    }

    const belowPrompt = migrateSettings(
      { history: { maxPromptTokens: HISTORY_BUDGET_LIMITS.maxPromptTokens.min - 1 } },
      0,
    ).history.maxPromptTokens;
    const abovePrompt = migrateSettings(
      { history: { maxPromptTokens: HISTORY_BUDGET_LIMITS.maxPromptTokens.max + 1 } },
      0,
    ).history.maxPromptTokens;
    expect(belowPrompt).toBe(HISTORY_BUDGET_LIMITS.maxPromptTokens.min);
    expect(abovePrompt).toBe(HISTORY_BUDGET_LIMITS.maxPromptTokens.max);

    const belowResults = migrateSettings(
      { search: { maxResults: SEARCH_LIMITS.maxResults.min - 1 } },
      0,
    ).search.maxResults;
    const aboveResults = migrateSettings(
      { search: { maxResults: SEARCH_LIMITS.maxResults.max + 1 } },
      0,
    ).search.maxResults;
    expect(belowResults).toBe(SEARCH_LIMITS.maxResults.min);
    expect(aboveResults).toBe(SEARCH_LIMITS.maxResults.max);
    expect(TEMPERATURE_LIMITS).toEqual({ min: 0, max: 2 });
  });
});
