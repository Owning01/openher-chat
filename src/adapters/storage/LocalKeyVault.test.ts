import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { ProviderConfig } from '@/domain/types/provider';
import { LocalSettingsRepository, SETTINGS_STORAGE_KEY } from './LocalSettingsRepository';
import { KEY_STORAGE_PREFIX, LocalKeyVault } from './LocalKeyVault';

const NOW = 1_700_000_000_000;

describe('LocalKeyVault', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('get/set/has/remove usan openher.key.<ref>', async () => {
    const vault = new LocalKeyVault();
    expect(await vault.has('provider:groq')).toBe(false);
    expect(await vault.get('provider:groq')).toBeNull();

    await vault.set('provider:groq', 'sk-secret');
    expect(localStorage.getItem(`${KEY_STORAGE_PREFIX}provider:groq`)).toBe('sk-secret');
    expect(await vault.has('provider:groq')).toBe(true);
    expect(await vault.get('provider:groq')).toBe('sk-secret');

    await vault.remove('provider:groq');
    expect(await vault.has('provider:groq')).toBe(false);
    expect(await vault.get('provider:groq')).toBeNull();
    expect(localStorage.getItem(`${KEY_STORAGE_PREFIX}provider:groq`)).toBeNull();
  });

  it('sin localStorage responde vacío y no lanza', async () => {
    vi.stubGlobal('localStorage', undefined);
    const vault = new LocalKeyVault();
    await expect(vault.set('search:brave', 'x')).resolves.toBeUndefined();
    expect(await vault.has('search:brave')).toBe(false);
    expect(await vault.get('search:brave')).toBeNull();
    await expect(vault.remove('search:brave')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('la key del vault no se filtra en el JSON de settings ni de ProviderConfig', async () => {
    const secret = 'sk-live-super-secret-123';
    const vault = new LocalKeyVault();
    await vault.set('provider:groq', secret);

    const settingsRepo = new LocalSettingsRepository(() => NOW);
    await settingsRepo.save(createDefaultSettings(NOW));
    const provider: ProviderConfig = {
      id: 'groq',
      label: 'Groq',
      kind: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      requiresKey: true,
      keyRef: 'provider:groq',
      models: [],
      defaultModelId: null,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const serializedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '';
    const serializedProvider = JSON.stringify(provider);
    expect(serializedSettings).not.toContain(secret);
    expect(serializedProvider).not.toContain(secret);
    expect(serializedProvider).toContain('provider:groq');
    expect(await vault.get('provider:groq')).toBe(secret);
  });
});
