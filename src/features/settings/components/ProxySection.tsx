import { useEffect, useId, useState } from 'react';

import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { Badge, Button, Input, Select } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import { probeProxy } from '../state/proxyProbe';
import type { ProxyProbeResult } from '../state/proxyProbe';
import { isHttpUrl } from '../state/validation';

type ProbeState = { status: 'idle' } | { status: 'testing' } | { status: 'ok' } | { status: 'error'; result: ProxyProbeResult };

export function ProxySection() {
  const t = useT();
  const http = useServices().http;
  const proxy = useSettingsStore((state) => state.settings.proxy);
  const patch = useSettingsStore((state) => state.patch);
  const modeId = useId();
  const urlId = useId();
  const [url, setUrl] = useState(proxy.baseUrl ?? '');
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });

  useEffect(() => {
    setUrl(proxy.baseUrl ?? '');
  }, [proxy.baseUrl]);

  const modeOptions: SelectOption[] = [
    { value: 'direct', label: t('settings.proxyModeDirect') },
    { value: 'custom', label: t('settings.proxyModeCustom') },
  ];

  const commitUrl = (): void => {
    const trimmed = url.trim();
    if (trimmed === (proxy.baseUrl ?? '')) return;
    if (trimmed === '') {
      void patch({ proxy: { mode: 'direct', baseUrl: null } });
      return;
    }
    void patch({ proxy: { mode: 'custom', baseUrl: trimmed } });
  };

  const runProbe = async (): Promise<void> => {
    setProbe({ status: 'testing' });
    const result = await probeProxy(http, url);
    setProbe(result.ok ? { status: 'ok' } : { status: 'error', result });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border-subtle p-3">
      <h3 className="text-sm font-medium text-text">{t('settings.proxyTitle')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={modeId} className="block text-sm font-medium text-text">
            {t('settings.proxyMode')}
          </label>
          <Select
            id={modeId}
            value={proxy.mode}
            options={modeOptions}
            onChange={(event) => {
              const mode = event.target.value === 'custom' ? 'custom' : 'direct';
              void patch({ proxy: { mode } });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={urlId} className="block text-sm font-medium text-text">
            {t('settings.proxyBaseUrl')}
          </label>
          <Input
            id={urlId}
            value={url}
            disabled={proxy.mode !== 'custom'}
            placeholder={t('settings.proxyBaseUrlPlaceholder')}
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={commitUrl}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={probe.status === 'testing'}
          disabled={proxy.mode !== 'custom' || !isHttpUrl(url)}
          onClick={() => void runProbe()}
        >
          {t('common.test')}
        </Button>
        {probe.status === 'ok' ? <Badge variant="success">{t('common.connected')}</Badge> : null}
        {probe.status === 'error' ? (
          <p role="status" className="text-xs text-danger">
            {probeMessage(t, probe.result)}
          </p>
        ) : null}
      </div>

      <p className="text-sm text-muted">{t('settings.proxyHint')}</p>
    </div>
  );
}

function probeMessage(t: Translate, result: ProxyProbeResult): string {
  if (result.ok) return '';
  if (result.code === 'invalid_url') return t('settings.proxyInvalidUrl');
  if (result.code === 'http_error') return t('settings.proxyHttpError', { status: result.status });
  return t('settings.proxyUnreachable');
}
