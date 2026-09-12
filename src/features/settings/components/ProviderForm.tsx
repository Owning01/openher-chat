import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { PROVIDER_TEMPLATES, getProviderTemplate } from '@/domain/providers/catalog';
import type { ProviderConfig, ProviderKind } from '@/domain/types/provider';
import { useT } from '@/i18n/useT';
import { Button, Input, Select, Switch } from '@/shared/ui';
import type { SelectOption } from '@/shared/ui';

import { isProviderKind, validateProviderDraft } from '../state/validation';
import { ApiKeyField } from './ApiKeyField';

export interface ProviderFormValue {
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  requiresKey: boolean;
  apiKey: string;
}

export interface ProviderFormProps {
  provider: ProviderConfig | null;
  hasStoredKey?: boolean;
  saving?: boolean;
  onSubmit(value: ProviderFormValue): void;
  onCancel(): void;
  onClearKey?: () => void;
}

const CUSTOM_TEMPLATE = 'custom';

export function ProviderForm({
  provider,
  hasStoredKey = false,
  saving = false,
  onSubmit,
  onCancel,
  onClearKey,
}: ProviderFormProps) {
  const t = useT();
  const formId = useId();
  const [templateId, setTemplateId] = useState(CUSTOM_TEMPLATE);
  const [label, setLabel] = useState(provider?.label ?? '');
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? 'openai-compatible');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [requiresKey, setRequiresKey] = useState(provider?.requiresKey ?? true);
  const [apiKey, setApiKey] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const templateOptions = useMemo<SelectOption[]>(
    () => [
      { value: CUSTOM_TEMPLATE, label: t('settings.providerTemplateCustom') },
      ...PROVIDER_TEMPLATES.map((template) => ({ value: template.id, label: template.label })),
    ],
    [t],
  );

  const kindOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'openai-compatible', label: t('settings.providerKindOpenai') },
      { value: 'anthropic', label: t('settings.providerKindAnthropic') },
    ],
    [t],
  );

  const errors = validateProviderDraft({ label, kind, baseUrl, requiresKey });

  const applyTemplate = (id: string): void => {
    setTemplateId(id);
    const template = getProviderTemplate(id);
    if (template === undefined) return;
    setLabel(template.label);
    setKind(template.kind);
    setBaseUrl(template.baseUrl);
    setRequiresKey(template.requiresKey);
  };

  const submit = (): void => {
    setSubmitted(true);
    if (errors.label !== undefined || errors.baseUrl !== undefined) return;
    onSubmit({ label: label.trim(), kind, baseUrl: baseUrl.trim(), requiresKey, apiKey });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  const labelInvalid = submitted && errors.label !== undefined;
  const baseUrlInvalid = submitted && errors.baseUrl !== undefined;

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {provider === null ? (
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-template`} className="block text-sm font-medium text-text">
            {t('settings.providerTemplate')}
          </label>
          <Select
            id={`${formId}-template`}
            value={templateId}
            options={templateOptions}
            onChange={(event) => applyTemplate(event.target.value)}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`${formId}-label`} className="block text-sm font-medium text-text">
          {t('settings.providerLabel')}
        </label>
        <Input
          id={`${formId}-label`}
          value={label}
          invalid={labelInvalid}
          placeholder={t('settings.providerLabelPlaceholder')}
          onChange={(event) => setLabel(event.target.value)}
        />
        {labelInvalid ? <p className="text-xs text-danger">{t('settings.providerErrorRequired')}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-kind`} className="block text-sm font-medium text-text">
            {t('settings.providerKind')}
          </label>
          <Select
            id={`${formId}-kind`}
            value={kind}
            options={kindOptions}
            onChange={(event) => {
              if (isProviderKind(event.target.value)) setKind(event.target.value);
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-6">
          <span className="text-sm font-medium text-text">{t('settings.providerRequiresKey')}</span>
          <Switch
            checked={requiresKey}
            label={t('settings.providerRequiresKey')}
            onCheckedChange={setRequiresKey}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${formId}-base-url`} className="block text-sm font-medium text-text">
          {t('settings.providerBaseUrl')}
        </label>
        <Input
          id={`${formId}-base-url`}
          value={baseUrl}
          invalid={baseUrlInvalid}
          placeholder={t('settings.providerBaseUrlPlaceholder')}
          spellCheck={false}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        {baseUrlInvalid ? <p className="text-xs text-danger">{t('settings.providerErrorUrl')}</p> : null}
      </div>

      {requiresKey ? (
        <ApiKeyField
          label={t('settings.apiKeyLabel')}
          value={apiKey}
          hint={t('settings.apiKeyHint')}
          hasStoredKey={hasStoredKey}
          onChange={setApiKey}
          onSave={submit}
          onClear={onClearKey}
        />
      ) : null}

      <footer className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </footer>
    </form>
  );
}
