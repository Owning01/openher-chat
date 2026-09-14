import { APP_VERSION } from '@/app/version';
import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import { Download } from '@/shared/icons';
import { Button, Switch } from '@/shared/ui';
import { useSettingsStore } from '@/features/settings/state/settingsStore';

import { useUpdateCheck } from '../useUpdateCheck';

const LINK_CLASSES =
  'inline-flex h-8 select-none items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/** Sección de Ajustes: comprobar actualización, descargar el APK y auto-chequeo. */
export function UpdatesSection() {
  const t = useT();
  const services = useServices();
  const autoCheck = useSettingsStore((state) => state.settings.ui.autoCheckUpdates);
  const patch = useSettingsStore((state) => state.patch);
  const { state, check } = useUpdateCheck(services);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{t('updates.currentVersion', { version: APP_VERSION })}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={state.status === 'checking'} onClick={check}>
          {t('updates.check')}
        </Button>
        {state.status === 'available' ? (
          <a href={state.manifest.apkUrl} className={LINK_CLASSES}>
            <Download aria-hidden="true" className="size-4" />
            {t('updates.download')}
          </a>
        ) : null}
      </div>

      {state.status === 'up-to-date' ? (
        <p role="status" className="text-success">
          {t('updates.upToDate', { version: APP_VERSION })}
        </p>
      ) : null}

      {state.status === 'available' ? (
        <div role="status" className="space-y-1">
          <p className="font-medium text-text">
            {t('updates.availableTitle', { version: state.manifest.version })}
          </p>
          {state.manifest.notes === undefined ? null : (
            <p className="text-muted">{state.manifest.notes}</p>
          )}
          <p className="text-xs text-muted">{t('updates.downloadHint')}</p>
          {state.manifest.sha256 === undefined ? null : (
            <p className="font-mono text-[11px] break-all text-muted">
              {t('updates.sha256', { hash: state.manifest.sha256 })}
            </p>
          )}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div role="alert" className="flex items-center gap-2">
          <p className="min-w-0 flex-1 break-words text-danger">
            {t('updates.error', { message: state.message })}
          </p>
          <Button size="sm" variant="ghost" onClick={check}>
            {t('updates.retry')}
          </Button>
        </div>
      ) : null}

      <div className="flex items-start gap-3 border-t border-border-subtle pt-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium text-text">{t('updates.autoCheck')}</p>
          <p className="text-xs text-muted">{t('updates.autoCheckHint')}</p>
        </div>
        <Switch
          checked={autoCheck}
          label={t('updates.autoCheck')}
          onCheckedChange={(checked) => void patch({ ui: { autoCheckUpdates: checked } })}
        />
      </div>
    </div>
  );
}
