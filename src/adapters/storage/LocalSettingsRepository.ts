import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import { migrateSettings } from '@/domain/settings/migrate';
import type { AppSettings } from '@/domain/types/settings';

export const SETTINGS_STORAGE_KEY = 'openher.settings.v1';

/**
 * Clave efectiva de settings: la global sin owner,
 * `` `${SETTINGS_STORAGE_KEY}:<owner>` `` con owner.
 */
export function settingsStorageKey(ownerId?: string | null): string {
  if (ownerId === null || ownerId === undefined || ownerId === '') return SETTINGS_STORAGE_KEY;
  return `${SETTINGS_STORAGE_KEY}:${ownerId}`;
}

export class LocalSettingsRepository implements SettingsRepository {
  private readonly now: () => number;
  private readonly storageKey: string;

  constructor(now: () => number = () => Date.now(), ownerId: string | null = null) {
    this.now = now;
    this.storageKey = settingsStorageKey(ownerId);
  }

  async load(): Promise<AppSettings> {
    const raw = this.readRaw();
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
    storage.setItem(this.storageKey, JSON.stringify(settings));
  }

  /** Lectura cruda de la clave instanciada; los fallos de storage devuelven null. */
  private readRaw(): string | null {
    const storage = getLocalStorage();
    if (storage === null) return null;
    try {
      return storage.getItem(this.storageKey);
    } catch {
      return null;
    }
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
