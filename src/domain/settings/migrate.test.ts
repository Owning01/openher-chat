import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_BUDGET,
  DEFAULT_CHAT_DEFAULTS,
  DEFAULT_HISTORY_BUDGET,
  DEFAULT_SEARCH_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  createDefaultSettings,
} from './defaults';
import { migrateSettings } from './migrate';

const NOW = 1_700_000_000_000;

describe('migrateSettings', () => {
  it('con raw vacío devuelve defaults completos', () => {
    expect(migrateSettings({}, NOW)).toEqual(createDefaultSettings(NOW));
    expect(migrateSettings(undefined, NOW)).toEqual(createDefaultSettings(NOW));
    expect(migrateSettings(null, NOW)).toEqual(createDefaultSettings(NOW));
  });

  it('nunca lanza con basura ni con getters hostiles', () => {
    expect(migrateSettings('garbage', NOW)).toEqual(createDefaultSettings(NOW));
    expect(migrateSettings(42, NOW)).toEqual(createDefaultSettings(NOW));
    expect(migrateSettings([1, 2, 3], NOW)).toEqual(createDefaultSettings(NOW));
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'chat', {
      get() {
        throw new Error('boom');
      },
    });
    expect(() => migrateSettings(hostile, NOW)).not.toThrow();
    expect(migrateSettings(hostile, NOW)).toEqual(createDefaultSettings(NOW));
  });

  it('conserva y completa valores parciales', () => {
    const migrated = migrateSettings(
      {
        locale: 'en',
        theme: 'dark',
        activeProviderId: 'groq',
        onboardingCompleted: true,
        updatedAt: 999,
        lastModelByProvider: { groq: 'llama-3.3-70b' },
        chat: { temperature: 1.2 },
      },
      NOW,
    );
    expect(migrated.locale).toBe('en');
    expect(migrated.theme).toBe('dark');
    expect(migrated.activeProviderId).toBe('groq');
    expect(migrated.onboardingCompleted).toBe(true);
    expect(migrated.updatedAt).toBe(999);
    expect(migrated.lastModelByProvider).toEqual({ groq: 'llama-3.3-70b' });
    expect(migrated.chat.temperature).toBe(1.2);
    expect(migrated.chat.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(migrated.chat.maxOutputTokens).toBeNull();
    expect(migrated.history).toEqual(DEFAULT_HISTORY_BUDGET);
    expect(migrated.agent).toEqual(DEFAULT_AGENT_BUDGET);
  });

  it('ignora campos anidados con tipo inválido', () => {
    const migrated = migrateSettings(
      { chat: 'nope', history: [], agent: 5, tools: null, search: 'x', proxy: 3, lastModelByProvider: 'nope' },
      NOW,
    );
    expect(migrated.chat).toEqual(DEFAULT_CHAT_DEFAULTS);
    expect(migrated.history).toEqual(DEFAULT_HISTORY_BUDGET);
    expect(migrated.agent).toEqual(DEFAULT_AGENT_BUDGET);
    expect(migrated.search).toEqual(DEFAULT_SEARCH_SETTINGS);
    expect(migrated.proxy).toEqual({ mode: 'direct', baseUrl: null });
    expect(migrated.lastModelByProvider).toEqual({});
  });

  it('acota temperature al rango 0-2', () => {
    expect(migrateSettings({ chat: { temperature: 5 } }, NOW).chat.temperature).toBe(2);
    expect(migrateSettings({ chat: { temperature: -3 } }, NOW).chat.temperature).toBe(0);
    expect(migrateSettings({ chat: { temperature: Number.NaN } }, NOW).chat.temperature).toBe(0.7);
    expect(migrateSettings({ chat: { temperature: 'hot' } }, NOW).chat.temperature).toBe(0.7);
  });

  it('acota maxResults entre 3 y 10 y redondea', () => {
    expect(migrateSettings({ search: { maxResults: 1 } }, NOW).search.maxResults).toBe(3);
    expect(migrateSettings({ search: { maxResults: 99 } }, NOW).search.maxResults).toBe(10);
    expect(migrateSettings({ search: { maxResults: 4.6 } }, NOW).search.maxResults).toBe(5);
    expect(migrateSettings({ search: { maxResults: 'many' } }, NOW).search.maxResults).toBe(5);
  });

  it('acota los presupuestos de agente e historial', () => {
    const agent = migrateSettings(
      { agent: { maxSteps: 100, maxToolCalls: -1, maxRetriesPerStep: 99, toolTimeoutMs: 10 } },
      NOW,
    ).agent;
    expect(agent.maxSteps).toBe(20);
    expect(agent.maxToolCalls).toBe(0);
    expect(agent.maxRetriesPerStep).toBe(10);
    expect(agent.toolTimeoutMs).toBe(1000);
    expect(agent.maxToolResultChars).toBe(6000);

    const history = migrateSettings(
      { history: { keepLastTurns: -5, truncateMessageAtPercent: 3, reservedOutputTokens: -7, maxPromptTokens: 10 } },
      NOW,
    ).history;
    expect(history.keepLastTurns).toBe(0);
    expect(history.truncateMessageAtPercent).toBe(1);
    expect(history.reservedOutputTokens).toBe(0);
    expect(history.maxPromptTokens).toBe(512);
  });

  it('valida maxOutputTokens (positivo o null)', () => {
    expect(migrateSettings({ chat: { maxOutputTokens: 500.4 } }, NOW).chat.maxOutputTokens).toBe(500);
    expect(migrateSettings({ chat: { maxOutputTokens: 0 } }, NOW).chat.maxOutputTokens).toBeNull();
    expect(migrateSettings({ chat: { maxOutputTokens: -3 } }, NOW).chat.maxOutputTokens).toBeNull();
    expect(migrateSettings({ chat: { maxOutputTokens: 'lots' } }, NOW).chat.maxOutputTokens).toBeNull();
  });

  it('valida enums y strings vacíos', () => {
    expect(migrateSettings({ locale: 'fr', theme: 'neon' }, NOW).locale).toBe('es');
    expect(migrateSettings({ locale: 'fr', theme: 'neon' }, NOW).theme).toBe('system');
    expect(migrateSettings({ search: { mode: 'google', defaultFreshness: 'decade' } }, NOW).search.mode).toBe('auto');
    expect(migrateSettings({ search: { mode: 'google', defaultFreshness: 'decade' } }, NOW).search.defaultFreshness).toBe('week');
    expect(migrateSettings({ activeProviderId: '   ' }, NOW).activeProviderId).toBeNull();
    expect(migrateSettings({ activeProviderId: 7 }, NOW).activeProviderId).toBeNull();
    expect(migrateSettings({ chat: { systemPrompt: '   ' } }, NOW).chat.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(migrateSettings({ chat: { systemPrompt: 'Custom prompt' } }, NOW).chat.systemPrompt).toBe('Custom prompt');
  });

  it('sanea lastModelByProvider y proxy', () => {
    const migrated = migrateSettings(
      { lastModelByProvider: { a: 'm1', b: 4, c: '', d: null }, proxy: { mode: 'custom', baseUrl: '  https://proxy.example  ' } },
      NOW,
    );
    expect(migrated.lastModelByProvider).toEqual({ a: 'm1' });
    expect(migrated.proxy.mode).toBe('custom');
    expect(migrated.proxy.baseUrl).toBe('https://proxy.example');
    expect(migrateSettings({ proxy: { mode: 'custom', baseUrl: '' } }, NOW).proxy.baseUrl).toBeNull();
  });

  it('siempre sube schemaVersion a la versión actual', () => {
    expect(migrateSettings({ schemaVersion: 0 }, NOW).schemaVersion).toBe(1);
    expect(migrateSettings({ schemaVersion: 99 }, NOW).schemaVersion).toBe(1);
  });

  it('updatedAt inválido cae al now inyectado', () => {
    expect(migrateSettings({ updatedAt: 0 }, NOW).updatedAt).toBe(NOW);
    expect(migrateSettings({ updatedAt: -1 }, NOW).updatedAt).toBe(NOW);
    expect(migrateSettings({ updatedAt: 'x' }, NOW).updatedAt).toBe(NOW);
    expect(migrateSettings({ updatedAt: 1234.9 }, NOW).updatedAt).toBe(1234);
  });

  it('es idempotente y preserva updatedAt entre corridas', () => {
    const raw = { locale: 'en', chat: { temperature: 1.5 }, search: { maxResults: 8 }, updatedAt: 500 };
    const once = migrateSettings(raw, NOW);
    const twice = migrateSettings(once, NOW + 5000);
    expect(twice).toEqual(once);
    expect(twice.updatedAt).toBe(500);
  });
});
