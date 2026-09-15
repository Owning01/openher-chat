import { useEffect, useRef, useState } from 'react';

import type { SharePayload } from '@/domain/settings/share';
import { useT } from '@/i18n/useT';
import { Download, Upload } from '@/shared/icons';
import { downloadTextFile } from '@/shared/utils/download';
import { Button, Dialog, Switch, useToast } from '@/shared/ui';
import { AlertBanner } from '@/app/layout/AlertBanner';
import { useServices } from '@/app/services';
import type { CloudSyncPort } from '@/domain/ports/SyncPort';
import { readAttachmentText } from '@/domain/chat/attachments';
import { parseSharePayload } from '@/domain/settings/share';

import type { AutoSyncHandle, CloudSyncOutcome } from '../state/cloudSync';
import { startCloudAutoSync } from '../state/cloudSync';
import type { ShareApplyResult } from '../state/settingsStore';
import { useSettingsStore, useSettingsStoreApi } from '../state/settingsStore';

/**
 * Compartir configuración: exporta proveedores + secretos + ajustes mínimos
 * a un archivo JSON (para pasar por WhatsApp/mail) e importa el archivo en
 * otro dispositivo dejándolo listo para chatear. Solo configuración: nunca
 * viajan conversaciones ni expedientes. Los secretos van en texto plano.
 */
export function ShareSection() {
  const t = useT();
  const { push } = useToast();
  const services = useServices();
  const exportShareConfig = useSettingsStore((state) => state.exportShareConfig);
  const applyShareConfig = useSettingsStore((state) => state.applyShareConfig);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<SharePayload | null>(null);
  const [importError, setImportError] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleExport = async (): Promise<void> => {
    setBusy(true);
    try {
      const payload = await exportShareConfig();
      downloadTextFile('openher-chat-config.json', JSON.stringify(payload, null, 2), 'application/json');
      push({ title: t('settings.shareExported'), variant: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File | undefined): Promise<void> => {
    setImportError(false);
    if (file === undefined) return;
    setBusy(true);
    try {
      let text: string;
      try {
        text = await readAttachmentText(file);
      } catch {
        setImportError(true);
        return;
      }
      let raw: unknown = null;
      try {
        raw = JSON.parse(text) as unknown;
      } catch {
        raw = null;
      }
      const payload = parseSharePayload(raw);
      if (payload === null) {
        setImportError(true);
        return;
      }
      setPending(payload);
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    if (pending === null) return;
    setBusy(true);
    try {
      const result: ShareApplyResult = await applyShareConfig(pending);
      setPending(null);
      push({
        title: t('settings.shareApplied', {
          added: result.added,
          reused: result.reused,
          keys: result.keysSet,
        }),
        variant: result.keysMissing > 0 ? 'info' : 'success',
      });
      if (result.keysMissing > 0) {
        push({ title: t('settings.shareKeysMissing', { count: result.keysMissing }), variant: 'info' });
      }
    } finally {
      setBusy(false);
    }
  };

  const activeId = pending?.settings.activeProviderId ?? null;
  const activeProvider = pending?.providers.find((entry) => entry.config.id === activeId) ?? null;
  const activeModel =
    activeId === null ? null : (pending?.settings.lastModelByProvider[activeId] ?? null);

  return (
    <div className="space-y-3">
      {services.sync !== undefined ? <CloudSyncBlock cloud={services.sync} /> : null}
      <p className="text-sm text-muted">{t('settings.shareDescription')}</p>
      <p className="text-sm text-warning" role="note">
        {t('settings.sharePlaintextWarning')}
      </p>
      {importError ? (
        <AlertBanner variant="danger" title={t('settings.errorTitle')} description={t('settings.shareInvalid')} />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          icon={<Download aria-hidden="true" className="size-4" />}
          onClick={() => void handleExport()}
        >
          {t('settings.shareExport')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          icon={<Upload aria-hidden="true" className="size-4" />}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('settings.shareImport')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            void handleImportFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('settings.shareConfirmTitle')}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handleApply()}>
              {t('settings.shareApply')}
            </Button>
          </>
        }
      >
        {pending !== null ? (
          <div className="space-y-2 text-sm text-text">
            <p className="text-muted">{t('settings.shareConfirmBody')}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {t('settings.shareSummaryProviders', {
                  added: pending.providers.length,
                  names: pending.providers.map((entry) => entry.config.label).join(', '),
                })}
              </li>
              <li>
                {t('settings.shareSummaryModel', {
                  provider: activeProvider?.config.label ?? '—',
                  model: activeModel ?? '—',
                })}
              </li>
              <li>{t('settings.shareSummaryThinking', { level: pending.settings.chat.thinking })}</li>
              <li>
                {t('settings.shareSummaryKeys', {
                  withKey: pending.providers.filter((entry) => entry.secret !== null).length,
                  total: pending.providers.length,
                })}
              </li>
            </ul>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/**
 * Espejo en la nube (misma cuenta en varios dispositivos): reconcilia al abrir
 * Ajustes y sube cada cambio con antirrebote. Sólo se muestra con sesión
 * (servicio `sync`); sin él la app sigue 100% local.
 */
function CloudSyncBlock({ cloud }: { cloud: CloudSyncPort }) {
  const t = useT();
  const { push } = useToast();
  const store = useSettingsStoreApi();
  const ready = useSettingsStore((state) => state.ready);
  const cloudSync = useSettingsStore((state) => state.settings.ui.cloudSync);
  const patch = useSettingsStore((state) => state.patch);
  const handleRef = useRef<AutoSyncHandle | null>(null);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const handle = startCloudAutoSync(store, cloud);
    handleRef.current = handle;
    void handle.ready.then((outcome: CloudSyncOutcome) => {
      if (outcome === 'pulled') push({ title: t('settings.cloudPulled'), variant: 'success' });
      else if (outcome === 'error') push({ title: t('settings.cloudSyncError'), variant: 'warning' });
    });
    return () => {
      handle.stop();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [ready, store, cloud, push, t]);

  const handleToggle = (checked: boolean): void => {
    void (async () => {
      await patch({ ui: { cloudSync: checked } });
      if (!checked) return;
      const outcome = (await handleRef.current?.syncNow()) ?? 'error';
      if (outcome === 'pulled') push({ title: t('settings.cloudPulled'), variant: 'success' });
      else if (outcome === 'error') push({ title: t('settings.cloudSyncError'), variant: 'warning' });
    })();
  };

  const handlePushNow = (): void => {
    setPushing(true);
    void (async () => {
      try {
        const outcome = (await handleRef.current?.pushNow()) ?? 'error';
        push({
          title: outcome === 'pushed' ? t('settings.cloudPushed') : t('settings.cloudPushError'),
          variant: outcome === 'pushed' ? 'success' : 'danger',
        });
      } finally {
        setPushing(false);
      }
    })();
  };

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text">{t('settings.cloudTitle')}</span>
        <Switch checked={cloudSync} label={t('settings.cloudToggle')} onCheckedChange={handleToggle} />
      </div>
      <p className="text-sm text-muted">{t('settings.cloudDescription')}</p>
      <p className="text-sm text-warning" role="note">
        {t('settings.cloudWarning')}
      </p>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={pushing || !cloudSync}
          icon={<Upload aria-hidden="true" className="size-4" />}
          onClick={handlePushNow}
        >
          {pushing ? t('settings.cloudPushing') : t('settings.cloudPushNow')}
        </Button>
      </div>
    </div>
  );
}
