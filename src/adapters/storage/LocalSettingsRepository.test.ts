import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_DEFAULTS, SETTINGS_SCHEMA_VERSION, createDefaultSettings } from '@/domain/settings/defaults';
import { migrateSettings } from '@/domain/settings/migrate';
import { LocalSettingsRepository, SETTINGS_STORAGE_KEY, settingsStorageKey } from './LocalSettingsRepository';

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
    expect(loaded.proxy).toEqual({ mode: 'direct', baseUrl: null, openCodeProxyUrl: null, xServiceUrl: null });
  });

  it('sin localStorage carga defaults y save es no-op', async () => {
    vi.stubGlobal('localStorage', undefined);
    const repo = new LocalSettingsRepository(() => NOW);
    await expect(repo.save(createDefaultSettings(NOW))).resolves.toBeUndefined();
    expect(await repo.load()).toEqual(createDefaultSettings(NOW));
    vi.unstubAllGlobals();
  });
});

describe('LocalSettingsRepository por owner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('settingsStorageKey usa la global sin owner y sufija con owner', () => {
    expect(settingsStorageKey()).toBe(SETTINGS_STORAGE_KEY);
    expect(settingsStorageKey(null)).toBe(SETTINGS_STORAGE_KEY);
    expect(settingsStorageKey('uid123')).toBe(`${SETTINGS_STORAGE_KEY}:uid123`);
  });

  it('los owners quedan aislados entre sí y del global', async () => {
    const repoA = new LocalSettingsRepository(() => NOW, 'owner-a');
    const repoB = new LocalSettingsRepository(() => NOW, 'owner-b');
    const global = new LocalSettingsRepository(() => NOW);

    const settingsA = migrateSettings({ locale: 'en' }, NOW);
    await repoA.save(settingsA);

    expect(await repoA.load()).toEqual(settingsA);
    expect(await repoB.load()).toEqual(createDefaultSettings(NOW));
    expect(await global.load()).toEqual(createDefaultSettings(NOW));
    expect(localStorage.getItem(settingsStorageKey('owner-a'))).not.toBeNull();
    expect(localStorage.getItem(settingsStorageKey('owner-b'))).toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('ctor default intacto: sin owner lee y escribe la clave global', async () => {
    const repo = new LocalSettingsRepository(() => NOW);
    const settings = migrateSettings({ theme: 'dark' }, NOW);
    await repo.save(settings);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
    expect(await repo.load()).toEqual(settings);
  });
});
