import type { AppSettings } from '../types/settings';

export interface SettingsRepository {
  load(): Promise<AppSettings>;
  save(s: AppSettings): Promise<void>;
}
