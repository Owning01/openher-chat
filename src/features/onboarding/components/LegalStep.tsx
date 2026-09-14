import { Scale } from 'lucide-react';
import { useId } from 'react';

import { SectionCard } from '@/features/settings/components/SectionCard';
import { useT } from '@/i18n/useT';
import { Button, Switch } from '@/shared/ui';

export interface LegalStepProps {
  enabled: boolean;
  consent: boolean;
  saving: boolean;
  onToggle(enabled: boolean): void;
  onConsent(consent: boolean): void;
  onBack(): void;
  onFinish(): void;
}

/** Paso final: preconfiguración opt-in del modo legal con disclaimer y consentimiento. */
export function LegalStep({ enabled, consent, saving, onToggle, onConsent, onBack, onFinish }: LegalStepProps) {
  const t = useT();
  const consentId = useId();
  const canFinish = !enabled || consent;

  return (
    <SectionCard
      title={t('legalSetup.title')}
      description={t('legalSetup.description')}
      icon={<Scale aria-hidden="true" className="size-4" />}
    >
      <ul className="space-y-1.5 text-sm text-muted">
        <li>{t('legalSetup.featureJurisdiction')}</li>
        <li>{t('legalSetup.featureCorpus')}</li>
        <li>{t('legalSetup.featureAnonymization')}</li>
      </ul>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-text">{t('legalSetup.enableLabel')}</p>
          <p className="text-xs text-muted">{t('legalSetup.enableHint')}</p>
        </div>
        <Switch checked={enabled} label={t('legalSetup.enableLabel')} onCheckedChange={onToggle} />
      </div>

      <div role="note" aria-label={t('legalSetup.disclaimerTitle')} className="space-y-1 rounded-lg border border-border-subtle bg-surface-subtle p-3">
        <p className="text-sm font-medium text-text">{t('legalSetup.disclaimerTitle')}</p>
        <p className="text-sm text-muted">{t('legalSetup.disclaimer')}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={consentId} className="flex cursor-pointer items-start gap-2.5 text-sm text-text">
          <input
            id={consentId}
            type="checkbox"
            className="mt-0.5 size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
            checked={consent}
            disabled={!enabled}
            onChange={(event) => onConsent(event.target.checked)}
          />
          <span>{t('legalSetup.consentLabel')}</span>
        </label>
        <p className="text-xs text-muted">{t('legalSetup.secrecyNotice')}</p>
        {enabled && !consent ? <p className="text-xs text-muted">{t('legalSetup.consentRequiredHint')}</p> : null}
      </div>

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
