import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_BUDGET,
  DEFAULT_CHAT_DEFAULTS,
  DEFAULT_HISTORY_BUDGET,
  DEFAULT_SEARCH_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TOOL_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  createDefaultSettings,
} from './defaults';

describe('defaults de settings', () => {
  it('DEFAULT_AGENT_BUDGET coincide con el contrato', () => {
    expect(DEFAULT_AGENT_BUDGET).toEqual({
      maxSteps: 6,
      maxToolCalls: 8,
      maxToolResultChars: 6000,
      maxTotalTokens: 60000,
      maxWallClockMs: 120000,
      maxRetriesPerStep: 2,
      toolTimeoutMs: 15000,
    });
  });

  it('DEFAULT_HISTORY_BUDGET coincide con el contrato', () => {
    expect(DEFAULT_HISTORY_BUDGET).toEqual({
      mode: 'auto',
      maxPromptTokens: null,
      reservedOutputTokens: 2048,
      keepLastTurns: 6,
      truncateMessageAtPercent: 0.4,
    });
  });

  it('DEFAULT_CHAT_DEFAULTS usa system prompt breve en inglés', () => {
    expect(DEFAULT_CHAT_DEFAULTS.temperature).toBe(0.7);
    expect(DEFAULT_CHAT_DEFAULTS.maxOutputTokens).toBeNull();
    expect(DEFAULT_CHAT_DEFAULTS.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(DEFAULT_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it('DEFAULT_SETTINGS no fija updatedAt: se inyecta', () => {
    expect('updatedAt' in DEFAULT_SETTINGS).toBe(false);
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(1);
    expect(DEFAULT_SETTINGS.locale).toBe('es');
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(DEFAULT_SETTINGS.search).toEqual(DEFAULT_SEARCH_SETTINGS);
    expect(DEFAULT_SETTINGS.tools).toEqual(DEFAULT_TOOL_SETTINGS);
  });

  it('createDefaultSettings inyecta now y no comparte objetos anidados', () => {
    const first = createDefaultSettings(1234);
    const second = createDefaultSettings(5678);
    expect(first.updatedAt).toBe(1234);
    expect(second.updatedAt).toBe(5678);
    expect(first).toMatchObject({
      schemaVersion: 1,
      locale: 'es',
      theme: 'system',
      activeProviderId: null,
      onboardingCompleted: false,
      proxy: { mode: 'direct', baseUrl: null },
    });
    expect(first.chat).not.toBe(second.chat);
    expect(first.history).not.toBe(second.history);
    expect(first.agent).not.toBe(second.agent);
    expect(first.search).not.toBe(second.search);
    expect(first.lastModelByProvider).not.toBe(second.lastModelByProvider);
  });
});
