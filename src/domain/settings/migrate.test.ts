import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_BUDGET,
  DEFAULT_CHAT_DEFAULTS,
  DEFAULT_HISTORY_BUDGET,
  DEFAULT_LEGAL_ANALYSIS_BUDGET,
  DEFAULT_LEGAL_RETRIEVAL_BUDGET,
  DEFAULT_LEGAL_SETTINGS,
  DEFAULT_SEARCH_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_UI_SETTINGS,
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
      { chat: 'nope', history: [], agent: 5, tools: null, search: 'x', proxy: 3, ui: 7, lastModelByProvider: 'nope' },
      NOW,
    );
    expect(migrated.chat).toEqual(DEFAULT_CHAT_DEFAULTS);
    expect(migrated.history).toEqual(DEFAULT_HISTORY_BUDGET);
    expect(migrated.agent).toEqual(DEFAULT_AGENT_BUDGET);
    expect(migrated.search).toEqual(DEFAULT_SEARCH_SETTINGS);
    expect(migrated.proxy).toEqual({ mode: 'direct', baseUrl: null });
    expect(migrated.ui).toEqual(DEFAULT_UI_SETTINGS);
    expect(migrated.lastModelByProvider).toEqual({});
  });

  it('conserva la visibilidad del panel de investigación y sanea valores inválidos', () => {
    expect(migrateSettings({ ui: { researchPanelVisible: false } }, NOW).ui.researchPanelVisible).toBe(false);
    expect(migrateSettings({ ui: { researchPanelVisible: 'nope' } }, NOW).ui.researchPanelVisible).toBe(true);
    expect(migrateSettings({ ui: null }, NOW).ui).toEqual(DEFAULT_UI_SETTINGS);
  });

  it('conserva el auto-chequeo de actualizaciones', () => {
    expect(migrateSettings({ ui: { autoCheckUpdates: false } }, NOW).ui.autoCheckUpdates).toBe(false);
    expect(migrateSettings({ ui: { autoCheckUpdates: 0 } }, NOW).ui.autoCheckUpdates).toBe(true);
  });

  it('acota temperature al rango 0-2', () => {
    expect(migrateSettings({ chat: { temperature: 5 } }, NOW).chat.temperature).toBe(2);
    expect(migrateSettings({ chat: { temperature: -3 } }, NOW).chat.temperature).toBe(0);
    expect(migrateSettings({ chat: { temperature: Number.NaN } }, NOW).chat.temperature).toBe(0.7);
    expect(migrateSettings({ chat: { temperature: 'hot' } }, NOW).chat.temperature).toBe(0.7);
  });

  it('sanea thinking contra el enum y cae a off', () => {
    expect(migrateSettings({ chat: { thinking: 'high' } }, NOW).chat.thinking).toBe('high');
    expect(migrateSettings({ chat: { thinking: 'ultra' } }, NOW).chat.thinking).toBe('off');
    expect(migrateSettings({ chat: { thinking: 3 } }, NOW).chat.thinking).toBe('off');
    expect(migrateSettings({}, NOW).chat.thinking).toBe('off');
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

  it('con raw vacío completa la sección legal con defaults', () => {
    expect(migrateSettings({}, NOW).legal).toEqual(DEFAULT_LEGAL_SETTINGS);
    expect(migrateSettings({ legal: 'nope' }, NOW).legal).toEqual(DEFAULT_LEGAL_SETTINGS);
    expect(migrateSettings({ legal: [] }, NOW).legal).toEqual(DEFAULT_LEGAL_SETTINGS);
    expect(migrateSettings({ legal: null }, NOW).legal).toEqual(DEFAULT_LEGAL_SETTINGS);
  });

  it('conserva la sección legal válida y completa lo faltante', () => {
    const legal = migrateSettings(
      {
        legal: {
          enabled: true,
          defaultJurisdiction: 'caba',
          defaultCourt: 'Juzgado Civil N° 5',
          defaultMatter: 'commercial',
          anonymization: 'optional',
          setupCompleted: true,
          retrieval: { maxPassages: 12, maxPassageChars: 2000, maxBriefTokens: 9000 },
          analysis: {
            maxCalls: 6,
            maxTotalTokens: 90000,
            maxWallClockMs: 180000,
            maxParallel: 3,
            maxOutputTokensPerPersona: 2000,
          },
          perspectives: ['judge', 'defense'],
          defaultTemplates: { claim: 'tpl-claim', answer: 'tpl-answer' },
        },
      },
      NOW,
    ).legal;
    expect(legal).toEqual({
      enabled: true,
      defaultJurisdiction: 'caba',
      defaultCourt: 'Juzgado Civil N° 5',
      defaultMatter: 'commercial',
      retrieval: { maxPassages: 12, maxPassageChars: 2000, maxBriefTokens: 9000 },
      analysis: {
        maxCalls: 6,
        maxTotalTokens: 90000,
        maxWallClockMs: 180000,
        maxParallel: 3,
        maxOutputTokensPerPersona: 2000,
      },
      anonymization: 'optional',
      perspectives: ['judge', 'defense'],
      defaultTemplates: { claim: 'tpl-claim', answer: 'tpl-answer' },
      setupCompleted: true,
    });
  });

  it('sanea enums legales inválidos al default', () => {
    const legal = migrateSettings(
      { legal: { defaultJurisdiction: 'marte', defaultMatter: 'penal', anonymization: 'maybe' } },
      NOW,
    ).legal;
    expect(legal.defaultJurisdiction).toBe('national');
    expect(legal.defaultMatter).toBe('civil-commercial');
    expect(legal.anonymization).toBe('required');
    expect(migrateSettings({ legal: { defaultCourt: 42 } }, NOW).legal.defaultCourt).toBe('');
  });

  it('filtra y deduplica las perspectivas adversariales', () => {
    const perspectives = migrateSettings(
      { legal: { perspectives: ['defense', 'nope', 'defense', 42, 'judge', null] } },
      NOW,
    ).legal.perspectives;
    expect(perspectives).toEqual(['defense', 'judge']);
    expect(migrateSettings({ legal: { perspectives: 'defense' } }, NOW).legal.perspectives).toEqual(
      DEFAULT_LEGAL_SETTINGS.perspectives,
    );
  });

  it('sanea defaultTemplates: sólo claves DocumentKind con valor string no vacío', () => {
    const templates = migrateSettings(
      { legal: { defaultTemplates: { claim: 'tpl', bogus: 'x', answer: '   ', contract: 5, bylaws: 'tpl-bylaws' } } },
      NOW,
    ).legal.defaultTemplates;
    expect(templates).toEqual({ claim: 'tpl', bylaws: 'tpl-bylaws' });
    expect(migrateSettings({ legal: { defaultTemplates: 'nope' } }, NOW).legal.defaultTemplates).toEqual({});
  });

  it('cae al default con NaN/Infinity/negativos en los topes y acota los excesos', () => {
    const legal = migrateSettings(
      {
        legal: {
          retrieval: { maxPassages: Number.NaN, maxPassageChars: Number.POSITIVE_INFINITY, maxBriefTokens: -100 },
          analysis: {
            maxCalls: -1,
            maxTotalTokens: Number.NaN,
            maxWallClockMs: Number.NEGATIVE_INFINITY,
            maxParallel: 0,
            maxOutputTokensPerPersona: -5,
          },
        },
      },
      NOW,
    ).legal;
    expect(legal.retrieval).toEqual(DEFAULT_LEGAL_RETRIEVAL_BUDGET);
    expect(legal.analysis).toEqual(DEFAULT_LEGAL_ANALYSIS_BUDGET);
    expect(migrateSettings({ legal: { retrieval: { maxPassages: 999 } } }, NOW).legal.retrieval.maxPassages).toBe(50);
    expect(migrateSettings({ legal: { analysis: { maxParallel: 99 } } }, NOW).legal.analysis.maxParallel).toBe(8);
  });

  it('migrateLegal es idempotente con la sección legal corrupta', () => {
    const raw = {
      legal: {
        enabled: true,
        defaultJurisdiction: 'marte',
        perspectives: ['risk', 'risk', 'x'],
        retrieval: { maxPassages: -1 },
        defaultTemplates: { claim: 't', nope: 'y' },
      },
    };
    const once = migrateSettings(raw, NOW);
    const twice = migrateSettings(once, NOW + 5000);
    expect(twice).toEqual(once);
  });

  it('es idempotente y preserva updatedAt entre corridas', () => {
    const raw = { locale: 'en', chat: { temperature: 1.5 }, search: { maxResults: 8 }, updatedAt: 500 };
    const once = migrateSettings(raw, NOW);
    const twice = migrateSettings(once, NOW + 5000);
    expect(twice).toEqual(once);
    expect(twice.updatedAt).toBe(500);
  });
});
