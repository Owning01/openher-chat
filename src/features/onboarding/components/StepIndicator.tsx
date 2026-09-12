import type { MessageKey } from '@/i18n/types';
import { useT } from '@/i18n/useT';
import { Check, ChevronRight } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

import { WIZARD_STEPS } from '../state/wizardReducer';
import type { WizardStep } from '../state/wizardReducer';

const STEP_MESSAGE_KEYS = {
  provider: 'onboarding.stepProvider',
  key: 'onboarding.stepConnection',
  model: 'onboarding.stepModel',
} as const satisfies Record<WizardStep, MessageKey>;

export interface StepIndicatorProps {
  current: WizardStep;
}

/** Cabecera de progreso del wizard: número de paso, etiqueta y marca de completado. */
export function StepIndicator({ current }: StepIndicatorProps) {
  const t = useT();
  const currentIndex = WIZARD_STEPS.indexOf(current);

  return (
    <ol aria-label={t('onboarding.stepsLabel')} className="flex flex-wrap items-center gap-2">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'grid size-6 place-items-center rounded-full border text-xs font-medium',
                active
                  ? 'border-primary bg-primary text-on-primary'
                  : done
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border text-muted',
              )}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              aria-current={active ? 'step' : undefined}
              className={cn('text-sm', active ? 'font-medium text-text' : 'text-muted')}
            >
              {t(STEP_MESSAGE_KEYS[step])}
            </span>
            {index < WIZARD_STEPS.length - 1 ? (
              <ChevronRight aria-hidden="true" className="size-4 text-muted" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
