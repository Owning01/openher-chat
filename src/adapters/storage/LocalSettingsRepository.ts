import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import { migrateSettings } from '@/domain/settings/migrate';
import type { AppSettings } from '@/domain/types/settings';

export const SETTINGS_STORAGE_KEY = 'openher.settings.v1';

export class LocalSettingsRepository implements SettingsRepository {
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async load(): Promise<AppSettings> {
    const raw = readRaw();
    if (raw === null) return migrateSettings(undefined, this.now());
    try {
      const parsed: unknown = JSON.parse(raw);
      return migrateSettings(parsed, this.now());
    } catch {
      return migrateSettings(undefined, this.now());
    }
  }

  async save(settings: AppSettings): Promise<void> {
    const storage = getLocalStorage();
    if (storage === null) return;
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }
}

function readRaw(): string | null {
  const storage = getLocalStorage();
  if (storage === null) return null;
  try {
    return storage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
