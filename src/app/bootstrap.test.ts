import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultSettings } from '@/domain/settings/defaults';
import type { AppSettings } from '@/domain/types/settings';
import { getLocale, setLocale } from '@/i18n';
import { applyTheme } from '@/shared/hooks/theme';
import { MemoryConversationRepository, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { bootstrapApp } from './bootstrap';

class FailingRecoveryRepository extends MemoryConversationRepository {
  override async recoverInterrupted(): Promise<string[]> {
    throw new Error('IndexedDB no disponible');
  }
}

afterEach(() => {
  setLocale('es');
  applyTheme('light');
});

describe('bootstrapApp', () => {
  it('carga settings, aplica idioma y tema, y recupera mensajes interrumpidos', async () => {
    const settings: AppSettings = { ...createDefaultSettings(10), locale: 'en', theme: 'dark' };

    const result = await bootstrapApp({
      settings: new MemorySettingsRepository({ initial: settings }),
      conversations: new MemoryConversationRepository(),
    });

    expect(result.storageError).toBeNull();
    expect(result.settings.locale).toBe('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('tolera un fallo de IndexedDB y lo reporta en storageError', async () => {
    const result = await bootstrapApp({ conversations: new FailingRecoveryRepository() });

    expect(result.storageError).toBe('IndexedDB no disponible');
    expect(result.services.conversations).toBeInstanceOf(FailingRecoveryRepository);
    expect(result.settings.schemaVersion).toBe(1);
  });
});
