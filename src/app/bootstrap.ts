import type { AppSettings } from '@/domain/types/settings';
import { setLocale } from '@/i18n';
import { applyTheme } from '@/shared/hooks/theme';

import { createServices } from './services';
import type { AppServices, CreateServicesOptions, CreateServicesOverrides } from './services';

export interface BootstrappedApp {
  services: AppServices;
  settings: AppSettings;
  /** Mensaje del fallo de IndexedDB durante `recoverInterrupted`; null si todo fue bien. */
  storageError: string | null;
}

/**
 * Arranque de la aplicación: servicios reales, settings persistidos, tema e idioma
 * aplicados y recuperación de mensajes interrumpidos. Un fallo de IndexedDB no
 * tumba el arranque: se reporta en `storageError`. Con `options.userId` los
 * repos reales leen la partición de ese usuario; sin él usan la legacy.
 */
export async function bootstrapApp(
  overrides: CreateServicesOverrides = {},
  options: CreateServicesOptions = {},
): Promise<BootstrappedApp> {
  const services = createServices(overrides, options);
  const settings = await services.settings.load();

  setLocale(settings.locale);
  applyTheme(settings.theme);

  let storageError: string | null = null;
  try {
    await services.conversations.recoverInterrupted();
  } catch (error) {
    storageError = error instanceof Error ? error.message : String(error);
  }

  return { services, settings, storageError };
}
