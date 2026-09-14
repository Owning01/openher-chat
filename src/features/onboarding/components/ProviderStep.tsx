import { Server } from 'lucide-react';

import { PROVIDER_TEMPLATES } from '@/domain/providers/catalog';
import { ProviderForm } from '@/features/settings/components/ProviderForm';
import type { ProviderFormValue } from '@/features/settings/components/ProviderForm';
import { SectionCard } from '@/features/settings/components/SectionCard';
import { providerKindLabel } from '@/features/settings/components/providerKindLabel';
import { useT } from '@/i18n/useT';
import { Badge, Button } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import type { ProviderChoice } from '../state/wizardReducer';

export interface ProviderStepProps {
  choice: ProviderChoice | null;
  saving: boolean;
  onSelectTemplate(templateId: string): void;
  onSelectCustom(): void;
  onCancelCustom(): void;
  onContinue(): void;
  onSubmitCustom(value: ProviderFormValue): void;
}

const CARD_CLASSES =
  'flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/** Paso 1: catálogo de plantillas + proveedor personalizado (reutiliza `ProviderForm`). */
export function ProviderStep({
  choice,
  saving,
  onSelectTemplate,
  onSelectCustom,
  onCancelCustom,
  onContinue,
  onSubmitCustom,
}: ProviderStepProps) {
  const t = useT();
  const selectedTemplateId = choice?.kind === 'template' ? choice.templateId : null;

  return (
    <SectionCard
      title={t('onboarding.providerTitle')}
      description={t('onboarding.providerDescription')}
      icon={<Server aria-hidden="true" className="size-4" />}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {PROVIDER_TEMPLATES.map((template) => {
          const selected = template.id === selectedTemplateId;

          return (
            <li key={template.id}>
              <button
                type="button"
                aria-pressed={selected}
                className={cn(
                  CARD_CLASSES,
                  selected ? 'border-primary bg-primary-soft/40' : 'border-border-subtle hover:bg-surface-subtle',
                )}
                onClick={() => onSelectTemplate(template.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{template.label}</span>
                  {selected ? <Badge variant="primary">{t('onboarding.selected')}</Badge> : null}
                </span>
                <span className="truncate font-mono text-xs text-muted">{template.baseUrl}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="neutral">{providerKindLabel(template.kind, t)}</Badge>
                  <Badge variant={template.requiresKey ? 'neutral' : 'success'}>
                    {template.requiresKey ? t('onboarding.keyRequired') : t('onboarding.keyNotRequired')}
                  </Badge>
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            aria-pressed={choice?.kind === 'custom'}
            className={cn(
              CARD_CLASSES,
              choice?.kind === 'custom'
                ? 'border-primary bg-primary-soft/40'
                : 'border-border-subtle hover:bg-surface-subtle',
            )}
            onClick={onSelectCustom}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text">{t('onboarding.customTitle')}</span>
              {choice?.kind === 'custom' ? (
                <Badge variant="primary">{t('onboarding.selected')}</Badge>
              ) : null}
            </span>
            <span className="text-xs text-muted">{t('onboarding.customDescription')}</span>
          </button>
        </li>
      </ul>

      {choice?.kind === 'custom' ? (
        <div className="rounded-lg border border-border-subtle p-4">
          <ProviderForm
            provider={null}
            saving={saving}
            onSubmit={onSubmitCustom}
            onCancel={onCancelCustom}
          />
        </div>
      ) : null}

      {choice?.kind === 'template' ? (
        <div className="flex justify-end">
          <Button loading={saving} onClick={onContinue}>
            {t('onboarding.continue')}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
