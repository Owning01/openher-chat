import { describe, expect, it } from 'vitest';

import { createDefaultSettings } from '../settings/defaults';
import { buildSharePayload } from '../settings/share';
import type { SharePayload } from '../settings/share';
import { fromSyncDocs, isShareRelevant, toSyncDocs } from './syncDocs';

function payload(): SharePayload {
  return buildSharePayload({
    providers: [
      {
        id: 'opencode-go',
        label: 'OpenCode Go',
        kind: 'opencode',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        requiresKey: true,
        keyRef: 'provider:opencode-go',
        models: [{ id: 'muse-spark-1.3-contributor', label: 'Muse Spark', source: 'api' }],
        defaultModelId: 'muse-spark-1.3-contributor',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    secrets: { 'provider:opencode-go': 'sk-test' },
    settings: {
      activeProviderId: 'opencode-go',
      lastModelByProvider: { 'opencode-go': 'muse-spark-1.3-contributor' },
      chat: { systemPrompt: '', temperature: 0.7, maxOutputTokens: null, thinking: 'low' },
      locale: 'es',
    },
    now: 50,
  });
}

describe('toSyncDocs/fromSyncDocs', () => {
  it('round-trip separa secretos de la config', () => {
    const docs = toSyncDocs(payload());

    expect(docs.config.version).toBe(1);
    expect(docs.config.providers).toHaveLength(1);
    expect(JSON.stringify(docs.config)).not.toContain('sk-test');
    expect(docs.secrets.keys).toEqual({ 'provider:opencode-go': 'sk-test' });

    const back = fromSyncDocs(
      JSON.parse(JSON.stringify(docs.config)),
      JSON.parse(JSON.stringify(docs.secrets)),
    );
    expect(back?.providers[0]?.secret).toBe('sk-test');
    expect(back?.settings.chat.thinking).toBe('low');
    expect(back?.exportedAt).toBe(50);
  });

  it('secreto faltante queda en null sin romper el paquete', () => {
    const docs = toSyncDocs(payload());
    const back = fromSyncDocs(docs.config, { version: 1, updatedAt: 50, keys: {} });
    expect(back?.providers[0]?.secret).toBeNull();
  });

  it('rechaza documentos inválidos', () => {
    const docs = toSyncDocs(payload());
    expect(fromSyncDocs(null, docs.secrets)).toBeNull();
    expect(fromSyncDocs(docs.config, null)).toBeNull();
    expect(fromSyncDocs({ ...docs.config, version: 2 }, docs.secrets)).toBeNull();
    expect(fromSyncDocs(docs.config, { ...docs.secrets, keys: { 'provider:x': '' } })).toBeNull();
    expect(fromSyncDocs({ ...docs.config, providers: [{ config: { id: '' } }] }, docs.secrets)).toBeNull();
  });
});

describe('isShareRelevant', () => {
  it('detecta cambios del subset compartible e ignora el resto', () => {
    const base = createDefaultSettings(1);
    expect(isShareRelevant(base, base)).toBe(false);
    expect(isShareRelevant(base, { ...base, theme: 'light' })).toBe(false);
    expect(isShareRelevant(base, { ...base, locale: 'en' })).toBe(true);
    expect(isShareRelevant(base, { ...base, activeProviderId: 'p1' })).toBe(true);
    expect(
      isShareRelevant(base, { ...base, lastModelByProvider: { p1: 'm1' } }),
    ).toBe(true);
    expect(
      isShareRelevant(base, { ...base, chat: { ...base.chat, thinking: 'max' } }),
    ).toBe(true);
  });
});
