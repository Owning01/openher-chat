import { useEffect, useReducer, useState } from 'react';

import { AlertBanner } from '@/app/layout/AlertBanner';
import { chatHref, navigate, SETTINGS_HREF } from '@/app/routing';
import type { ProviderFormValue } from '@/features/settings/components/ProviderForm';
import { useSettingsStore } from '@/features/settings/state/settingsStore';
import type { SettingsStore } from '@/features/settings/state/settingsStore';
import { useT } from '@/i18n/useT';
import { Button } from '@/shared/ui';

import { resolveOnboardingSession } from '../session';
import { KeyStep } from './KeyStep';
import { LegalStep } from './LegalStep';
import { ModelStep } from './ModelStep';
import { ProviderStep } from './ProviderStep';
import { StepIndicator } from './StepIndicator';
import {
  WIZARD_STEPS,
  canAdvance,
  createWizardState,
  keySatisfied,
  wizardReducer,
} from '../state/wizardReducer';

export interface OnboardingWizardProps {
  store: SettingsStore;
}

/**
 * Orquesta el wizard: reducer puro para el avance y `settingsStore` para crear el
 * proveedor, guardar la key, descubrir modelos y persistir el resultado.
 */
export function OnboardingWizard({ store }: OnboardingWizardProps) {
  const t = useT();
  const [state, dispatch] = useReducer(wizardReducer, undefined, createWizardState);
  const providers = useSettingsStore((settings) => settings.providers);
  const keyPresence = useSettingsStore((settings) => settings.keyPresence);
  const storeError = useSettingsStore((settings) => settings.error);
  const addProvider = useSettingsStore((settings) => settings.addProvider);
  const saveApiKey = useSettingsStore((settings) => settings.saveApiKey);
  const refreshModels = useSettingsStore((settings) => settings.refreshModels);
  const setActiveProvider = useSettingsStore((settings) => settings.setActiveProvider);
  const setModelForProvider = useSettingsStore((settings) => settings.setModelForProvider);
  const patch = useSettingsStore((settings) => settings.patch);
  const dismissError = useSettingsStore((settings) => settings.dismissError);
  const [saving, setSaving] = useState(false);

  const provider =
    state.providerId === null
      ? null
      : (providers.find((entry) => entry.id === state.providerId) ?? null);

  useEffect(() => {
    if (state.providerKeyRef === null) return;
    dispatch({ type: 'keyPresenceChanged', present: keyPresence[state.providerKeyRef] === true });
  }, [keyPresence, state.providerKeyRef]);

  const createFromTemplate = async (): Promise<void> => {
    if (state.choice?.kind !== 'template') return;
    setSaving(true);
    const created = await addProvider({ type: 'template', templateId: state.choice.templateId });
    setSaving(false);
    if (created === null) return;
    dispatch({ type: 'providerCreated', provider: created });
  };

  const createFromForm = async (value: ProviderFormValue): Promise<void> => {
    setSaving(true);
    const created = await addProvider({
      type: 'manual',
      label: value.label,
      kind: value.kind,
      baseUrl: value.baseUrl,
      requiresKey: value.requiresKey,
    });
    if (created === null) {
      setSaving(false);
      return;
    }
    if (value.apiKey.trim() !== '' && created.keyRef !== null) {
      await saveApiKey(created.keyRef, value.apiKey);
    }
    setSaving(false);
    dispatch({ type: 'providerCreated', provider: created });
  };

  const persistTypedKey = async (): Promise<void> => {
    if (!state.providerRequiresKey || state.keyInput.trim() === '' || state.providerKeyRef === null) return;
    await saveApiKey(state.providerKeyRef, state.keyInput);
  };

  const saveKey = async (): Promise<void> => {
    setSaving(true);
    await persistTypedKey();
    setSaving(false);
  };

  const testConnection = async (): Promise<void> => {
    if (provider === null) return;
    dispatch({ type: 'testStarted' });
    dismissError();
    await persistTypedKey();
    const models = await refreshModels(provider.id);
    if (models === null) {
      // El error contextual vive en el resultado del test; se evita duplicarlo arriba.
      dispatch({
        type: 'testFailed',
        message: store.getState().error ?? t('onboarding.testErrorUnknown'),
      });
      dismissError();
      return;
    }
    dispatch({ type: 'testSucceeded', models });
  };

  const continueFromKey = async (): Promise<void> => {
    if (!keySatisfied(state)) return;
    setSaving(true);
    await persistTypedKey();
    setSaving(false);
    dispatch({ type: 'next' });
  };

  const back = (): void => {
    dismissError();
    dispatch({ type: 'back' });
  };

  const skipForNow = (): void => {
    resolveOnboardingSession();
    navigate(SETTINGS_HREF);
  };

  const finish = async (): Promise<void> => {
    if (provider === null || state.selectedModelId === null || !canAdvance(state)) return;
    setSaving(true);
    dismissError();
    await setActiveProvider(provider.id);
    if (store.getState().error === null) {
      await setModelForProvider(provider.id, state.selectedModelId);
    }
    if (store.getState().error === null) {
      // `setupCompleted` marca que ya se ofreció el modo legal, incluso apagado,
      // para no re-preguntar: el usuario existente lo retoma desde Ajustes.
      await patch({
        onboardingCompleted: true,
        legal: { enabled: state.legalEnabled, setupCompleted: true },
      });
    }
    setSaving(false);
    if (store.getState().error !== null) return;
    resolveOnboardingSession();
    navigate(chatHref());
  };

  const stepNumber = WIZARD_STEPS.indexOf(state.step) + 1;

  return (
    <section
      data-testid="onboarding-wizard"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            {t('onboarding.stepLabel', { current: stepNumber, total: WIZARD_STEPS.length })}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text">{t('onboarding.title')}</h1>
          <p className="text-sm text-muted">{t('onboarding.subtitle')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={skipForNow}>
          {t('onboarding.skipForNow')}
        </Button>
      </header>

      <StepIndicator current={state.step} />

      {storeError !== null ? (
        <AlertBanner
          variant="danger"
          title={t('onboarding.errorTitle')}
          description={storeError}
          action={
            <Button size="sm" variant="ghost" onClick={dismissError}>
              {t('common.dismiss')}
            </Button>
          }
        />
      ) : null}

      {state.step === 'provider' ? (
        <ProviderStep
          choice={state.choice}
          saving={saving}
          onSelectTemplate={(templateId) =>
            dispatch({ type: 'selectProvider', choice: { kind: 'template', templateId } })
          }
          onSelectCustom={() => dispatch({ type: 'selectProvider', choice: { kind: 'custom' } })}
          onCancelCustom={() => dispatch({ type: 'selectProvider', choice: null })}
          onContinue={() => void createFromTemplate()}
          onSubmitCustom={(value) => void createFromForm(value)}
        />
      ) : null}

      {state.step === 'key' ? (
        <KeyStep
          requiresKey={state.providerRequiresKey}
          keyInput={state.keyInput}
          hasStoredKey={state.hasStoredKey}
          canContinue={canAdvance(state)}
          test={state.test}
          saving={saving}
          onKeyChange={(value) => dispatch({ type: 'keyChanged', value })}
          onSaveKey={() => void saveKey()}
          onTest={() => void testConnection()}
          onBack={back}
          onContinue={() => {
            if (state.providerRequiresKey) void continueFromKey();
            else dispatch({ type: 'skipKey' });
          }}
        />
      ) : null}

      {state.step === 'model' ? (
        <ModelStep
          models={state.models}
          selectedModelId={state.selectedModelId}
          test={state.test}
          saving={saving}
          onSelect={(modelId) => dispatch({ type: 'selectModel', modelId })}
          onTest={() => void testConnection()}
          onBack={back}
          onFinish={() => dispatch({ type: 'next' })}
        />
      ) : null}

      {state.step === 'legal' ? (
        <LegalStep
          enabled={state.legalEnabled}
          consent={state.legalConsent}
          saving={saving}
          onToggle={(enabled) => dispatch({ type: 'setLegal', enabled })}
          onConsent={(consent) => dispatch({ type: 'setLegal', consent })}
          onBack={back}
          onFinish={() => void finish()}
        />
      ) : null}
    </section>
  );
}
