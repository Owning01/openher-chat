import type { ModelInfo } from '@/domain/types/provider';
import { SectionCard } from '@/features/settings/components/SectionCard';
import { useT } from '@/i18n/useT';
import { Brain } from '@/shared/icons';
import { Badge, Button, EmptyState } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import type { ConnectionTestState } from '../state/wizardReducer';

export interface ModelStepProps {
  models: readonly ModelInfo[];
  selectedModelId: string | null;
  test: ConnectionTestState;
  saving: boolean;
  onSelect(modelId: string): void;
  onTest(): void;
  onBack(): void;
  onFinish(): void;
}

/** Paso 3: elección del modelo por defecto entre los descubiertos por la conexión. */
export function ModelStep({
  models,
  selectedModelId,
  test,
  saving,
  onSelect,
  onTest,
  onBack,
  onFinish,
}: ModelStepProps) {
  const t = useT();
  const testing = test.status === 'testing';
  const canFinish = selectedModelId !== null;

  return (
    <SectionCard
      title={t('onboarding.modelTitle')}
      description={t('onboarding.modelDescription')}
      icon={<Brain aria-hidden="true" className="size-4" />}
    >
      {models.length === 0 ? (
        <EmptyState
          icon={<Brain aria-hidden="true" />}
          title={t('onboarding.modelEmptyTitle')}
          description={t('onboarding.modelEmptyDescription')}
          action={
            <Button variant="secondary" loading={testing} onClick={onTest}>
              {testing ? t('onboarding.testing') : t('onboarding.testConnection')}
            </Button>
          }
        />
      ) : (
        <ul aria-label={t('onboarding.modelTitle')} role="radiogroup" className="space-y-2">
          {models.map((model) => {
            const selected = model.id === selectedModelId;

            return (
              <li key={model.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                    selected ? 'border-primary bg-primary-soft/40' : 'border-border-subtle hover:bg-surface-subtle',
                  )}
                >
                  <input
                    type="radio"
                    name="onboarding-model"
                    className="size-4 accent-primary"
                    checked={selected}
                    onChange={() => onSelect(model.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{model.label}</span>
                    <span className="block truncate text-xs text-muted">{model.id}</span>
                  </span>
                  {model.contextWindow !== undefined ? (
                    <Badge variant="neutral">
                      {t('onboarding.modelContext', { tokens: model.contextWindow })}
                    </Badge>
                  ) : null}
                  {selected ? <Badge variant="primary">{t('onboarding.selected')}</Badge> : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button loading={saving} disabled={!canFinish} onClick={onFinish}>
          {t('onboarding.finish')}
        </Button>
      </div>
    </SectionCard>
  );
}
