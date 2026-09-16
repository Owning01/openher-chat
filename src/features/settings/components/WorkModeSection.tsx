import { useT } from '@/i18n/useT';
import { Switch } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';

const JURISDICTION_KEYS = {
  national: 'settings.workModeJurisdictionNational',
  caba: 'settings.workModeJurisdictionCaba',
  pba: 'settings.workModeJurisdictionPba',
  cordoba: 'settings.workModeJurisdictionCordoba',
  tucuman: 'settings.workModeJurisdictionTucuman',
} as const;

const MATTER_KEYS = {
  civil: 'settings.workModeMatterCivil',
  commercial: 'settings.workModeMatterCommercial',
  'civil-commercial': 'settings.workModeMatterCivilCommercial',
} as const;

/** Entrada de Ajustes para el workspace legal: switch + resumen del estado por defecto. */
export function WorkModeSection() {
  const t = useT();
  const legal = useSettingsStore((state) => state.settings.legal);
  const patch = useSettingsStore((state) => state.patch);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-text">{t('settings.workModeLegalLabel')}</p>
          <p className="text-xs text-muted">{t('settings.workModeLegalHint')}</p>
        </div>
        <Switch
          checked={legal.enabled}
          label={t('settings.workModeLegalLabel')}
          onCheckedChange={(checked) => void patch({ legal: { enabled: checked, setupCompleted: true } })}
        />
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-0.5">
          <dt className="text-xs text-muted">{t('settings.workModeJurisdiction')}</dt>
          <dd className="text-sm text-text">{t(JURISDICTION_KEYS[legal.defaultJurisdiction])}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-xs text-muted">{t('settings.workModeMatter')}</dt>
          <dd className="text-sm text-text">{t(MATTER_KEYS[legal.defaultMatter])}</dd>
        </div>
      </dl>

      <p className="text-sm text-muted">{t('settings.workModeSetupHint')}</p>
    </div>
  );
}
