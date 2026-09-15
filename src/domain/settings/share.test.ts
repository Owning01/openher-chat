import { describe, expect, it } from 'vitest';

import type { ProviderConfig } from '../types/provider';
import { buildSharePayload, parseSharePayload, SHARE_CONFIG_VERSION } from './share';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'opencode-go',
    label: 'OpenCode Go',
    kind: 'opencode',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requiresKey: true,
    keyRef: 'provider:opencode-go',
    models: [{ id: 'muse-spark-1.3-contributor', label: 'Muse Spark', source: 'api' }],
    defaultModelId: 'muse-spark-1.3-contributor',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function settingsSlice() {
  return {
    activeProviderId: 'opencode-go',
    lastModelByProvider: { 'opencode-go': 'muse-spark-1.3-contributor' },
    chat: { systemPrompt: '', temperature: 0.7, maxOutputTokens: null, thinking: 'medium' as const },
    locale: 'es' as const,
  };
}

describe('buildSharePayload', () => {
  it('arma el paquete con secretos resueltos y versión', () => {
    const payload = buildSharePayload({
      providers: [provider()],
      secrets: { 'provider:opencode-go': 'sk-secreto' },
      settings: settingsSlice(),
      now: 99,
    });

    expect(payload.app).toBe('openher-chat');
    expect(payload.version).toBe(SHARE_CONFIG_VERSION);
    expect(payload.exportedAt).toBe(99);
    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0]?.secret).toBe('sk-secreto');
    expect(payload.settings.chat.thinking).toBe('medium');
    expect(payload.settings.lastModelByProvider).toEqual({ 'opencode-go': 'muse-spark-1.3-contributor' });
  });

  it('secret null cuando el exportador no tiene la key', () => {
    const payload = buildSharePayload({ providers: [provider()], secrets: {}, settings: settingsSlice(), now: 1 });
    expect(payload.providers[0]?.secret).toBeNull();
  });

  it('no incluye conversaciones ni expedientes (solo config)', () => {
    const payload = buildSharePayload({ providers: [provider()], secrets: {}, settings: settingsSlice(), now: 1 });
    expect(JSON.stringify(payload)).not.toMatch(/conversation|legalCase|messages/);
    expect(Object.keys(payload)).toEqual(['app', 'version', 'exportedAt', 'providers', 'settings']);
  });
});

describe('parseSharePayload', () => {
  it('hace round-trip de un paquete válido', () => {
    const payload = buildSharePayload({
      providers: [provider()],
      secrets: { 'provider:opencode-go': 'sk-secreto' },
      settings: settingsSlice(),
      now: 7,
    });
    const parsed = parseSharePayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed).toEqual(payload);
  });

  it('rechaza versión, app, baseUrl, kind, thinking y secretos inválidos', () => {
    const base = buildSharePayload({ providers: [provider()], secrets: {}, settings: settingsSlice(), now: 1 });
    const json = () => JSON.parse(JSON.stringify(base)) as Record<string, unknown>;

    expect(parseSharePayload(null)).toBeNull();
    expect(parseSharePayload('no-json')).toBeNull();

    const wrongVersion = json();
    wrongVersion.version = 999;
    expect(parseSharePayload(wrongVersion)).toBeNull();

    const wrongApp = json();
    wrongApp.app = 'otra-app';
    expect(parseSharePayload(wrongApp)).toBeNull();

    const emptyProviders = json();
    emptyProviders.providers = [];
    expect(parseSharePayload(emptyProviders)).toBeNull();

    const badUrl = json();
    (badUrl.providers as { config: { baseUrl: string } }[])[0]!.config.baseUrl = 'ftp://x';
    expect(parseSharePayload(badUrl)).toBeNull();

    const badKind = json();
    ((badKind.providers as { config: Record<string, unknown> }[])[0]!.config.kind as unknown) = 'gemini';
    expect(parseSharePayload(badKind)).toBeNull();

    const badThinking = json();
    ((badThinking.settings as { chat: Record<string, unknown> }).chat.thinking as unknown) = 'ultra';
    expect(parseSharePayload(badThinking)).toBeNull();

    const emptySecret = json();
    ((emptySecret.providers as { secret: unknown }[])[0]!.secret as unknown) = '';
    expect(parseSharePayload(emptySecret)).toBeNull();
  });
});


