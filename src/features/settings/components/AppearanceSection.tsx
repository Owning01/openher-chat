import { useId } from 'react';

import { DEFAULT_THEME_NAME, THEME_DEFINITIONS, THEME_NAMES } from '@/domain/themes';
import type { Locale, ThemeMode } from '@/domain/types/settings';
import { setLocale } from '@/i18n';
import { useT } from '@/i18n/useT';
import { applyTheme } from '@/shared/hooks/theme';
import { Select } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';

const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const LOCALES: readonly Locale[] = ['es', 'en'];

export function AppearanceSection() {
  const t = useT();
  const theme = useSettingsStore((state) => state.settings.theme);
  const ui = useSettingsStore((state) => state.settings.ui);
  const themeVariant = ui.themeVariant ?? DEFAULT_THEME_NAME;
  const locale = useSettingsStore((state) => state.settings.locale);
  const patch = useSettingsStore((state) => state.patch);
  const themeId = useId();
  const themeVariantId = useId();
  const localeId = useId();

  const themeOptions: SelectOption[] = THEMES.map((value) => ({
    value,
    label: t(`common.theme.${value}`),
  }));

  const themeVariantOptions: SelectOption[] = THEME_NAMES.map((name) => ({
    value: name,
    label: THEME_DEFINITIONS[name]?.label ?? name,
  }));

  const localeOptions: SelectOption[] = [
    { value: 'es', label: t('settings.localeEs') },
    { value: 'en', label: t('settings.localeEn') },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label htmlFor={themeId} className="block text-sm font-medium text-text">
          {t('settings.appearanceTheme')}
        </label>
        <Select
          id={themeId}
          value={theme}
          options={themeOptions}
          onChange={(event) => {
            if (!isThemeMode(event.target.value)) return;
            applyTheme(event.target.value, themeVariant);
            void patch({ theme: event.target.value });
          }}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={themeVariantId} className="block text-sm font-medium text-text">
          {t('settings.appearanceThemeVariant')}
        </label>
        <Select
          id={themeVariantId}
          value={themeVariant}
          options={themeVariantOptions}
          onChange={(event) => {
            const nextVariant = event.target.value;
            applyTheme(theme, nextVariant);
            void patch({ ui: { ...ui, themeVariant: nextVariant } });
          }}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <label htmlFor={localeId} className="block text-sm font-medium text-text">
          {t('settings.appearanceLocale')}
        </label>
        <Select
          id={localeId}
          value={locale}
          options={localeOptions}
          onChange={(event) => {
            if (!isLocale(event.target.value)) return;
            setLocale(event.target.value);
            void patch({ locale: event.target.value });
          }}
        />
      </div>
    </div>
  );
}

function isThemeMode(value: string): value is ThemeMode {
  return (THEMES as readonly string[]).includes(value);
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
