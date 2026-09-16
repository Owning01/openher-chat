import { useEffect, useId, useState } from 'react';

import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { Badge, Button, Input, Select } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import { probeOpenCodeProxy, probeProxy, probeXService } from '../state/proxyProbe';
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
  const openCodeId = useId();
  const xId = useId();
  const [url, setUrl] = useState(proxy.baseUrl ?? '');
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });
  const [openCodeUrl, setOpenCodeUrl] = useState(proxy.openCodeProxyUrl ?? '');
  const [openCodeProbe, setOpenCodeProbe] = useState<ProbeState>({ status: 'idle' });
  const [xUrl, setXUrl] = useState(proxy.xServiceUrl ?? '');
  const [xProbe, setXProbe] = useState<ProbeState>({ status: 'idle' });

  useEffect(() => {
    setUrl(proxy.baseUrl ?? '');
  }, [proxy.baseUrl]);

  useEffect(() => {
    setOpenCodeUrl(proxy.openCodeProxyUrl ?? '');
  }, [proxy.openCodeProxyUrl]);

  useEffect(() => {
    setXUrl(proxy.xServiceUrl ?? '');
  }, [proxy.xServiceUrl]);

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

  const commitOpenCodeUrl = (): void => {
    const trimmed = openCodeUrl.trim().replace(/\/+$/, '');
    if (trimmed === (proxy.openCodeProxyUrl ?? '')) return;
    if (trimmed === '' || !isHttpUrl(trimmed)) {
      if (trimmed === '') void patch({ proxy: { openCodeProxyUrl: null } });
      return;
    }
    void patch({ proxy: { openCodeProxyUrl: trimmed } });
  };

  const runOpenCodeProbe = async (): Promise<void> => {
    setOpenCodeProbe({ status: 'testing' });
    const result = await probeOpenCodeProxy(http, openCodeUrl);
    setOpenCodeProbe(result.ok ? { status: 'ok' } : { status: 'error', result });
  };

  const commitXUrl = (): void => {
    const trimmed = xUrl.trim().replace(/\/+$/, '');
    if (trimmed === (proxy.xServiceUrl ?? '')) return;
    if (trimmed === '' || !isHttpUrl(trimmed)) {
      if (trimmed === '') void patch({ proxy: { xServiceUrl: null } });
      return;
    }
    void patch({ proxy: { xServiceUrl: trimmed } });
  };

  const runXProbe = async (): Promise<void> => {
    setXProbe({ status: 'testing' });
    const result = await probeXService(http, xUrl);
    setXProbe(result.ok ? { status: 'ok' } : { status: 'error', result });
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

      <div className="space-y-1.5 border-t border-border-subtle pt-3">
        <label htmlFor={openCodeId} className="block text-sm font-medium text-text">
          {t('settings.proxyOpenCodeUrl')}
        </label>
        <Input
          id={openCodeId}
          value={openCodeUrl}
          placeholder={t('settings.proxyOpenCodeUrlPlaceholder')}
          spellCheck={false}
          onChange={(event) => setOpenCodeUrl(event.target.value)}
          onBlur={commitOpenCodeUrl}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={openCodeProbe.status === 'testing'}
            disabled={!isHttpUrl(openCodeUrl)}
            onClick={() => void runOpenCodeProbe()}
          >
            {t('common.test')}
          </Button>
          {openCodeProbe.status === 'ok' ? <Badge variant="success">{t('common.connected')}</Badge> : null}
          {openCodeProbe.status === 'error' ? (
            <p role="status" className="text-xs text-danger">
              {probeMessage(t, openCodeProbe.result)}
            </p>
          ) : null}
        </div>
        <p className="text-sm text-muted">{t('settings.proxyOpenCodeHint')}</p>
      </div>

      <div className="space-y-1.5 border-t border-border-subtle pt-3">
        <label htmlFor={xId} className="block text-sm font-medium text-text">
          {t('settings.proxyXUrl')}
        </label>
        <Input
          id={xId}
          value={xUrl}
          placeholder={t('settings.proxyXUrlPlaceholder')}
          spellCheck={false}
          onChange={(event) => setXUrl(event.target.value)}
          onBlur={commitXUrl}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={xProbe.status === 'testing'}
            disabled={!isHttpUrl(xUrl)}
            onClick={() => void runXProbe()}
          >
            {t('common.test')}
          </Button>
          {xProbe.status === 'ok' ? <Badge variant="success">{t('common.connected')}</Badge> : null}
          {xProbe.status === 'error' ? (
            <p role="status" className="text-xs text-danger">
              {probeMessage(t, xProbe.result)}
            </p>
          ) : null}
        </div>
        <p className="text-sm text-muted">{t('settings.proxyXHint')}</p>
      </div>
    </div>
  );
}

function probeMessage(t: Translate, result: ProxyProbeResult): string {
  if (result.ok) return '';
  if (result.code === 'invalid_url') return t('settings.proxyInvalidUrl');
  if (result.code === 'http_error') return t('settings.proxyHttpError', { status: result.status });
  return t('settings.proxyUnreachable');
}
