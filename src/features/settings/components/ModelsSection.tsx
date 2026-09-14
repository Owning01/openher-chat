import { useId, useState } from 'react';

import type { ModelApi, ModelInfo, ProviderConfig } from '@/domain/types/provider';
import { useT } from '@/i18n/useT';
import { Plus, RefreshCw, Trash } from '@/shared/icons';
import { Badge, Button, IconButton, Input, Select, Switch, useToast } from '@/shared/ui';

import { useSettingsStore } from '../state/settingsStore';
import { NumberField } from './NumberField';

export interface ModelsSectionProps {
  provider: ProviderConfig;
}

const CONTEXT_WINDOW_MAX = 10_000_000;

export function ModelsSection({ provider }: ModelsSectionProps) {
  const t = useT();
  const refreshModels = useSettingsStore((state) => state.refreshModels);
  const updateProvider = useSettingsStore((state) => state.updateProvider);
  const setModelForProvider = useSettingsStore((state) => state.setModelForProvider);
  const refreshing = useSettingsStore((state) => state.refreshingProviderId === provider.id);
  const { push } = useToast();
  const defaultSelectId = useId();
  const [manualId, setManualId] = useState('');
  const [manualLabel, setManualLabel] = useState('');

  const modelOptions = [
    { value: '', label: t('common.none') },
    ...provider.models.map((model) => ({ value: model.id, label: model.label })),
  ];

  const routeOptions = [
    { value: '', label: t('settings.modelsRouteAuto') },
    { value: 'chat-completions', label: t('settings.modelsRouteChat') },
    { value: 'messages', label: t('settings.modelsRouteMessages') },
    { value: 'responses', label: t('settings.modelsRouteResponses') },
  ];

  const refresh = async (): Promise<void> => {
    const models = await refreshModels(provider.id);
    if (models === null) {
      push({ title: t('settings.modelsRefreshError'), variant: 'danger' });
      return;
    }
    push({ title: t('settings.modelsRefreshSuccess', { count: models.length }), variant: 'success' });
  };

  const commitModels = (models: ModelInfo[], defaultModelId: string | null): void => {
    void updateProvider(provider.id, { models, defaultModelId });
  };

  const patchModel = (modelId: string, patch: Partial<ModelInfo>): void => {
    commitModels(
      provider.models.map((model) => (model.id === modelId ? { ...model, ...patch } : model)),
      provider.defaultModelId,
    );
  };

  const removeModel = (modelId: string): void => {
    const models = provider.models.filter((model) => model.id !== modelId);
    const defaultModelId = provider.defaultModelId === modelId ? (models[0]?.id ?? null) : provider.defaultModelId;
    commitModels(models, defaultModelId);
  };

  const normalizedManualId = manualId.trim();
  const duplicate = provider.models.some((model) => model.id === normalizedManualId);
  const canAddManual = normalizedManualId !== '' && !duplicate;

  const addManualModel = (): void => {
    if (!canAddManual) return;
    const model: ModelInfo = {
      id: normalizedManualId,
      label: manualLabel.trim() === '' ? normalizedManualId : manualLabel.trim(),
      source: 'manual',
    };
    commitModels([...provider.models, model], provider.defaultModelId ?? model.id);
    setManualId('');
    setManualLabel('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text">{t('settings.providerModels')}</h3>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw aria-hidden="true" />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          {t('settings.modelsRefresh')}
        </Button>
      </div>

      {provider.models.length === 0 ? (
        <p className="text-sm text-muted">{t('settings.modelsEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {provider.models.map((model) => (
            <li key={model.id} className="rounded-lg border border-border-subtle p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{model.label}</p>
                  <p className="truncate text-xs text-muted">{model.id}</p>
                </div>
                <Badge variant={model.source === 'api' ? 'neutral' : 'primary'}>
                  {model.source === 'api' ? t('settings.modelsSourceApi') : t('settings.modelsSourceManual')}
                </Badge>
                <IconButton
                  label={t('settings.modelsRemove')}
                  icon={<Trash aria-hidden="true" />}
                  size="sm"
                  onClick={() => removeModel(model.id)}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <NumberField
                  label={t('settings.modelsContextWindow')}
                  value={model.contextWindow ?? null}
                  min={1}
                  max={CONTEXT_WINDOW_MAX}
                  allowNull
                  onCommit={(value) => patchModel(model.id, { contextWindow: value ?? undefined })}
                />
                <div className="flex items-center justify-between gap-2 sm:pt-7">
                  <span className="text-sm text-text">{t('settings.modelsSupportsTools')}</span>
                  <Switch
                    checked={model.supportsTools ?? false}
                    label={t('settings.modelsSupportsTools')}
                    onCheckedChange={(checked) => patchModel(model.id, { supportsTools: checked })}
                  />
                </div>
              </div>
              {provider.kind === 'opencode' ? (
                <div className="mt-3 space-y-1.5">
                  <label
                    htmlFor={`${defaultSelectId}-route-${model.id}`}
                    className="block text-sm font-medium text-text"
                  >
                    {t('settings.modelsRoute')}
                  </label>
                  <Select
                    id={`${defaultSelectId}-route-${model.id}`}
                    value={model.api ?? ''}
                    options={routeOptions}
                    onChange={(event) =>
                      patchModel(model.id, {
                        api: event.target.value === '' ? undefined : (event.target.value as ModelApi),
                      })
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-lg border border-border-subtle p-3">
        <h4 className="text-sm font-medium text-text">{t('settings.modelsAddTitle')}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${defaultSelectId}-manual-id`} className="block text-sm font-medium text-text">
              {t('settings.modelsAddId')}
            </label>
            <Input
              id={`${defaultSelectId}-manual-id`}
              value={manualId}
              placeholder={t('settings.modelsAddIdPlaceholder')}
              spellCheck={false}
              onChange={(event) => setManualId(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${defaultSelectId}-manual-label`} className="block text-sm font-medium text-text">
              {t('settings.modelsAddLabel')}
            </label>
            <Input
              id={`${defaultSelectId}-manual-label`}
              value={manualLabel}
              placeholder={t('settings.modelsAddLabelPlaceholder')}
              onChange={(event) => setManualLabel(event.target.value)}
            />
          </div>
        </div>
        <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" />} disabled={!canAddManual} onClick={addManualModel}>
          {t('settings.modelsAdd')}
        </Button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={defaultSelectId} className="block text-sm font-medium text-text">
          {t('settings.providerDefaultModel')}
        </label>
        <Select
          id={defaultSelectId}
          value={provider.defaultModelId ?? ''}
          options={modelOptions}
          onChange={(event) => void setModelForProvider(provider.id, event.target.value === '' ? null : event.target.value)}
        />
      </div>
    </div>
  );
}
