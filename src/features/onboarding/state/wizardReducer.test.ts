import { describe, expect, it } from 'vitest';

import type { ModelInfo, ProviderConfig } from '@/domain/types/provider';

import { canAdvance, createWizardState, keySatisfied, wizardReducer } from './wizardReducer';
import type { WizardState } from './wizardReducer';

const MODELS: ModelInfo[] = [
  { id: 'model-a', label: 'Model A', source: 'api' },
  { id: 'model-b', label: 'Model B', source: 'api' },
];

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    keyRef: 'provider:groq',
    models: [],
    defaultModelId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** Estado con proveedor ya creado, parado en el paso de conexión. */
function atKeyStep(overrides: Partial<ProviderConfig> = {}): WizardState {
  const chosen = wizardReducer(createWizardState(), {
    type: 'selectProvider',
    choice: { kind: 'template', templateId: 'groq' },
  });
  return wizardReducer(chosen, { type: 'providerCreated', provider: makeProvider(overrides) });
}

describe('wizardReducer', () => {
  it('arranca en el paso de proveedor sin elección', () => {
    const state = createWizardState();

    expect(state.step).toBe('provider');
    expect(state.choice).toBeNull();
    expect(state.providerId).toBeNull();
    expect(state.test).toEqual({ status: 'idle' });
    expect(state.models).toEqual([]);
    expect(canAdvance(state)).toBe(false);
  });

  it('selecciona una plantilla o el modo personalizado y permite limpiar la elección', () => {
    const template = wizardReducer(createWizardState(), {
      type: 'selectProvider',
      choice: { kind: 'template', templateId: 'ollama' },
    });
    expect(template.choice).toEqual({ kind: 'template', templateId: 'ollama' });
    expect(canAdvance(template)).toBe(true);

    const custom = wizardReducer(template, { type: 'selectProvider', choice: { kind: 'custom' } });
    expect(custom.choice).toEqual({ kind: 'custom' });

    const cleared = wizardReducer(custom, { type: 'selectProvider', choice: null });
    expect(cleared.choice).toBeNull();
    expect(canAdvance(cleared)).toBe(false);
  });

  it('providerCreated avanza al paso de conexión y limpia el estado de prueba', () => {
    const state = atKeyStep();

    expect(state.step).toBe('key');
    expect(state.providerId).toBe('groq');
    expect(state.providerRequiresKey).toBe(true);
    expect(state.providerKeyRef).toBe('provider:groq');
    expect(state.keyInput).toBe('');
    expect(state.hasStoredKey).toBe(false);
    expect(state.test).toEqual({ status: 'idle' });
  });

  it('no avanza sin key cuando el proveedor la requiere', () => {
    const state = atKeyStep();

    expect(keySatisfied(state)).toBe(false);
    expect(wizardReducer(state, { type: 'next' }).step).toBe('key');

    const typed = wizardReducer(state, { type: 'keyChanged', value: 'sk-1' });
    expect(keySatisfied(typed)).toBe(true);
    expect(wizardReducer(typed, { type: 'next' }).step).toBe('model');
  });

  it('acepta una key ya guardada como válida para avanzar', () => {
    const state = atKeyStep();
    const stored = wizardReducer(state, { type: 'keyPresenceChanged', present: true });

    expect(keySatisfied(stored)).toBe(true);
    expect(wizardReducer(stored, { type: 'next' }).step).toBe('model');
  });

  it('permite saltar la key solo cuando el proveedor no la requiere', () => {
    const keyless = atKeyStep({ id: 'ollama', requiresKey: false, keyRef: null });

    expect(keySatisfied(keyless)).toBe(true);
    expect(wizardReducer(keyless, { type: 'next' }).step).toBe('model');
    expect(wizardReducer(keyless, { type: 'skipKey' }).step).toBe('model');

    const withKey = atKeyStep();
    expect(wizardReducer(withKey, { type: 'skipKey' }).step).toBe('key');
  });

  it('retrocede sin perder la elección ni la key escrita', () => {
    const keyed = wizardReducer(atKeyStep(), { type: 'keyChanged', value: 'sk-1' });
    const toProvider = wizardReducer(keyed, { type: 'back' });
    expect(toProvider.step).toBe('provider');
    expect(toProvider.choice).toEqual({ kind: 'template', templateId: 'groq' });
    expect(toProvider.keyInput).toBe('sk-1');

    const toKey = wizardReducer(wizardReducer(keyed, { type: 'next' }), { type: 'back' });
    expect(toKey.step).toBe('key');

    expect(wizardReducer(createWizardState(), { type: 'back' }).step).toBe('provider');
  });

  it('gestiona el ciclo de la prueba de conexión', () => {
    const keyed = wizardReducer(atKeyStep(), { type: 'keyChanged', value: 'sk-1' });
    const testing = wizardReducer(keyed, { type: 'testStarted' });
    expect(testing.test).toEqual({ status: 'testing' });

    const success = wizardReducer(testing, { type: 'testSucceeded', models: MODELS });
    expect(success.test).toEqual({ status: 'success', count: 2 });
    expect(success.models).toEqual(MODELS);
    expect(success.selectedModelId).toBe('model-a');
    expect(wizardReducer(success, { type: 'next' }).step).toBe('model');

    const failed = wizardReducer(testing, { type: 'testFailed', message: 'sin red' });
    expect(failed.test).toEqual({ status: 'error', message: 'sin red' });
    expect(failed.models).toEqual([]);

    const retried = wizardReducer(failed, { type: 'testStarted' });
    expect(retried.test).toEqual({ status: 'testing' });
  });

  it('cambiar la key invalida el resultado de la prueba anterior', () => {
    const success = wizardReducer(atKeyStep(), { type: 'testSucceeded', models: MODELS });
    const edited = wizardReducer(success, { type: 'keyChanged', value: 'sk-2' });

    expect(edited.test).toEqual({ status: 'idle' });
    expect(edited.models).toEqual(MODELS);
  });

  it('conserva la selección válida al re-probar y cae al primer modelo si desaparece', () => {
    const success = wizardReducer(atKeyStep(), { type: 'testSucceeded', models: MODELS });
    const picked = wizardReducer(success, { type: 'selectModel', modelId: 'model-b' });
    expect(picked.selectedModelId).toBe('model-b');

    const reTested = wizardReducer(picked, { type: 'testSucceeded', models: MODELS });
    expect(reTested.selectedModelId).toBe('model-b');

    const shrunk = wizardReducer(picked, {
      type: 'testSucceeded',
      models: [{ id: 'model-c', label: 'Model C', source: 'api' }],
    });
    expect(shrunk.selectedModelId).toBe('model-c');
  });

  it('ignora modelos desconocidos y finaliza solo con selección', () => {
    const keyless = atKeyStep({ requiresKey: false, keyRef: null });
    const withModels = wizardReducer(keyless, { type: 'testSucceeded', models: MODELS });

    expect(wizardReducer(withModels, { type: 'selectModel', modelId: 'nope' }).selectedModelId).toBe('model-a');
    expect(wizardReducer(withModels, { type: 'selectModel', modelId: 'model-b' }).selectedModelId).toBe('model-b');
    expect(canAdvance(withModels)).toBe(true);
  });

  it('arranca con el modo legal apagado y sin consentimiento', () => {
    const state = createWizardState();

    expect(state.legalEnabled).toBe(false);
    expect(state.legalConsent).toBe(false);
  });

  it('el paso legal avanza siempre salvo activado sin consentimiento', () => {
    const base = { ...createWizardState(), step: 'legal' } as WizardState;

    expect(canAdvance(base)).toBe(true);

    const enabled = wizardReducer(base, { type: 'setLegal', enabled: true });
    expect(enabled.legalEnabled).toBe(true);
    expect(canAdvance(enabled)).toBe(false);

    const consented = wizardReducer(enabled, { type: 'setLegal', consent: true });
    expect(canAdvance(consented)).toBe(true);
  });

  it('apagar el modo legal limpia el consentimiento', () => {
    const base = { ...createWizardState(), step: 'legal' } as WizardState;
    const on = wizardReducer(wizardReducer(base, { type: 'setLegal', enabled: true }), {
      type: 'setLegal',
      consent: true,
    });
    const off = wizardReducer(on, { type: 'setLegal', enabled: false });

    expect(off.legalEnabled).toBe(false);
    expect(off.legalConsent).toBe(false);
    expect(canAdvance(off)).toBe(true);
  });

  it('atraviesa el paso legal con next y back', () => {
    const keyless = atKeyStep({ requiresKey: false, keyRef: null });
    const withModels = wizardReducer(keyless, { type: 'testSucceeded', models: MODELS });

    const atModel = wizardReducer(withModels, { type: 'next' });
    expect(atModel.step).toBe('model');

    // Sin modelo elegido no se avanza al paso legal.
    expect(wizardReducer({ ...atModel, selectedModelId: null }, { type: 'next' }).step).toBe('model');

    const picked = wizardReducer(atModel, { type: 'selectModel', modelId: 'model-b' });
    const toLegal = wizardReducer(picked, { type: 'next' });
    expect(toLegal.step).toBe('legal');
    expect(toLegal.selectedModelId).toBe('model-b');

    const backToModel = wizardReducer(toLegal, { type: 'back' });
    expect(backToModel.step).toBe('model');
    expect(backToModel.legalEnabled).toBe(false);
  });

  it('el paso legal es terminal para next y conserva el estado al volver', () => {
    const base = { ...createWizardState(), step: 'legal' } as WizardState;
    const enabled = wizardReducer(wizardReducer(base, { type: 'setLegal', enabled: true }), {
      type: 'setLegal',
      consent: true,
    });

    expect(wizardReducer(enabled, { type: 'next' }).step).toBe('legal');

    const back = wizardReducer(enabled, { type: 'back' });
    expect(back.step).toBe('model');
    expect(back.legalEnabled).toBe(true);
    expect(back.legalConsent).toBe(true);
  });
  it('canAdvance refleja la validación de cada paso', () => {
    expect(canAdvance(createWizardState())).toBe(false);
    expect(canAdvance({ ...createWizardState(), choice: { kind: 'custom' } })).toBe(true);

    const keyless = atKeyStep({ requiresKey: false, keyRef: null });
    expect(canAdvance(keyless)).toBe(true);

    const withoutModels = wizardReducer(keyless, { type: 'next' });
    expect(withoutModels.step).toBe('model');
    expect(canAdvance(withoutModels)).toBe(false);
  });
});
