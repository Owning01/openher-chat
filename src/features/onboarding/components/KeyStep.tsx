import { KeyRound } from 'lucide-react';

import { AlertBanner } from '@/app/layout/AlertBanner';
import { ApiKeyField } from '@/features/settings/components/ApiKeyField';
import { SectionCard } from '@/features/settings/components/SectionCard';
import { useT } from '@/i18n/useT';
import { Badge, Button } from '@/shared/ui';

import type { ConnectionTestState } from '../state/wizardReducer';

export interface KeyStepProps {
  requiresKey: boolean;
  keyInput: string;
  hasStoredKey: boolean;
  canContinue: boolean;
  test: ConnectionTestState;
  saving: boolean;
  onKeyChange(value: string): void;
  onSaveKey(): void;
  onTest(): void;
  onBack(): void;
  onContinue(): void;
}

/** Paso 2: API key opcional + "Probar conexión" contra el adapter real. */
export function KeyStep({
  requiresKey,
  keyInput,
  hasStoredKey,
  canContinue,
  test,
  saving,
  onKeyChange,
  onSaveKey,
  onTest,
  onBack,
  onContinue,
}: KeyStepProps) {
  const t = useT();
  const testing = test.status === 'testing';

  return (
    <SectionCard
      title={t('onboarding.keyTitle')}
      description={requiresKey ? t('onboarding.keyDescription') : t('onboarding.keyDescriptionOptional')}
      icon={<KeyRound aria-hidden="true" className="size-4" />}
    >
      {requiresKey ? (
        <>
          <ApiKeyField
            label={t('settings.apiKeyLabel')}
            value={keyInput}
            hasStoredKey={hasStoredKey}
            saving={saving}
            hint={t('settings.apiKeyHint')}
            onChange={onKeyChange}
            onSave={onSaveKey}
          />
          {!canContinue ? <p className="text-xs text-muted">{t('onboarding.keyRequiredHint')}</p> : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" loading={testing} onClick={onTest}>
          {testing ? t('onboarding.testing') : t('onboarding.testConnection')}
        </Button>
        {test.status === 'success' ? (
          <Badge variant={test.count > 0 ? 'success' : 'warning'}>
            {test.count > 0
              ? t('onboarding.testSuccess', { count: test.count })
              : t('onboarding.testEmpty')}
          </Badge>
        ) : null}
      </div>

      {test.status === 'error' ? (
        <AlertBanner variant="danger" title={t('onboarding.testErrorTitle')} description={test.message} />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button loading={saving} disabled={requiresKey && !canContinue} onClick={onContinue}>
          {requiresKey ? t('common.next') : t('onboarding.skipKey')}
        </Button>
      </div>
    </SectionCard>
  );
}
