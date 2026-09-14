import { useState } from 'react';

import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import { Badge, Button, Dialog, Input, useToast } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import type { OpenCodeServerCatalog } from '../state/opencodeServer';
import { DEFAULT_OPENCODE_SERVER_URL, fetchOpenCodeServerCatalog } from '../state/opencodeServer';
import { providerKindLabel } from './providerKindLabel';

export interface ImportOpenCodeServerProps {
  open: boolean;
  onClose(): void;
}

/**
 * Importa el catálogo de proveedores/modelos de un `opencode serve` local.
 * Es una fuente de descubrimiento (no transporte de chat): las API keys se
 * agregan después en OpenHer Chat.
 */
export function ImportOpenCodeServer({ open, onClose }: ImportOpenCodeServerProps) {
  const t = useT();
  const services = useServices();
  const importProviders = useSettingsStore((state) => state.importProviders);
  const { push } = useToast();
  const [url, setUrl] = useState(DEFAULT_OPENCODE_SERVER_URL);
  const [catalog, setCatalog] = useState<OpenCodeServerCatalog | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setCatalog(null);
    setError(null);
  };

  const close = (): void => {
    if (connecting) return;
    reset();
    onClose();
  };

  const connect = async (): Promise<void> => {
    setConnecting(true);
    reset();
    try {
      setCatalog(await fetchOpenCodeServerCatalog(url, services.http));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const doImport = async (): Promise<void> => {
    if (catalog === null) return;
    const result = await importProviders(catalog.providers);
    push({
      title: t('settings.importOpencodeSuccess', { added: result.added, skipped: result.skipped }),
      variant: result.added > 0 ? 'success' : 'info',
    });
    onClose();
    reset();
  };

  return (
    <Dialog
      open={open}
      title={t('settings.importOpencodeTitle')}
      onClose={close}
      className="max-h-[85dvh] overflow-y-auto"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button disabled={catalog === null} onClick={() => void doImport()}>
            {t('settings.importOpencodeImport', { count: catalog?.providers.length ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('settings.importOpencodeDescription')}</p>

        <div className="space-y-1.5">
          <label htmlFor="opencode-server-url" className="block text-sm font-medium text-text">
            {t('settings.importOpencodeUrl')}
          </label>
          <div className="flex gap-2">
            <Input
              id="opencode-server-url"
              value={url}
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button variant="secondary" loading={connecting} onClick={() => void connect()}>
              {connecting ? t('settings.importOpencodeConnecting') : t('settings.importOpencodeConnect')}
            </Button>
          </div>
        </div>

        {error !== null ? (
          <p role="alert" className="text-sm text-danger">
            {t('settings.importOpencodeError')}: {error}
          </p>
        ) : null}

        {catalog !== null ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-text">
              {t('settings.importOpencodeFound', { count: catalog.providers.length })}
            </p>
            {catalog.providers.length === 0 ? (
              <p className="text-sm text-muted">{t('settings.importOpencodeEmpty')}</p>
            ) : (
              <ul className="space-y-2">
                {catalog.providers.map((provider) => (
                  <li
                    key={provider.id}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{provider.label}</p>
                      <p className="truncate font-mono text-xs text-muted">{provider.baseUrl}</p>
                    </div>
                    <Badge variant="neutral">{providerKindLabel(provider.kind, t)}</Badge>
                    <Badge variant="primary">
                      {t('settings.providerModelCount', { count: provider.models.length })}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <p className="text-xs text-muted">{t('settings.importOpencodeExperimental')}</p>
      </div>
    </Dialog>
  );
}
