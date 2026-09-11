import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_DEFAULTS, SETTINGS_SCHEMA_VERSION, createDefaultSettings } from '@/domain/settings/defaults';
import { migrateSettings } from '@/domain/settings/migrate';
import { LocalSettingsRepository, SETTINGS_STORAGE_KEY } from './LocalSettingsRepository';

const NOW = 1_700_000_000_000;

describe('LocalSettingsRepository', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sin datos previos devuelve defaults migrados', async () => {
    const repo = new LocalSettingsRepository(() => NOW);
    expect(await repo.load()).toEqual(createDefaultSettings(NOW));
  });

  it('save/load conserva valores y es idempotente', async () => {
    const repo = new LocalSettingsRepository(() => NOW);
    const settings = migrateSettings({ locale: 'en', theme: 'dark', chat: { temperature: 1.1 } }, NOW);
    await repo.save(settings);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();

    const first = await repo.load();
    expect(first).toEqual(settings);
    await repo.save(first);
    expect(await repo.load()).toEqual(first);
  });

  it('JSON corrupto cae a defaults sin lanzar', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{"locale":');
    const repo = new LocalSettingsRepository(() => NOW);
    expect(await repo.load()).toEqual(createDefaultSettings(NOW));
  });

  it('migra un esquema parcial y sella la versión actual', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ locale: 'en', theme: 'dark' }));
    const repo = new LocalSettingsRepository(() => NOW);
    const loaded = await repo.load();
    expect(loaded.locale).toBe('en');
    expect(loaded.theme).toBe('dark');
    expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(loaded.chat).toEqual(DEFAULT_CHAT_DEFAULTS);
    expect(loaded.proxy).toEqual({ mode: 'direct', baseUrl: null });
  });

  it('sin localStorage carga defaults y save es no-op', async () => {
    vi.stubGlobal('localStorage', undefined);
    const repo = new LocalSettingsRepository(() => NOW);
    await expect(repo.save(createDefaultSettings(NOW))).resolves.toBeUndefined();
    expect(await repo.load()).toEqual(createDefaultSettings(NOW));
    vi.unstubAllGlobals();
  });
});
