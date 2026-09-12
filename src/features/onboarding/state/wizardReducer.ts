import type { ModelInfo, ProviderConfig } from '@/domain/types/provider';

/** Pasos del wizard de onboarding, en orden. */
export type WizardStep = 'provider' | 'key' | 'model';

export const WIZARD_STEPS = ['provider', 'key', 'model'] as const satisfies readonly WizardStep[];

/** Elección del paso 1: una plantilla del catálogo o un proveedor propio. */
export type ProviderChoice = { kind: 'template'; templateId: string } | { kind: 'custom' };

export type ConnectionTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; count: number }
  | { status: 'error'; message: string };

export interface WizardState {
  step: WizardStep;
  choice: ProviderChoice | null;
  providerId: string | null;
  providerRequiresKey: boolean;
  providerKeyRef: string | null;
  keyInput: string;
  hasStoredKey: boolean;
  test: ConnectionTestState;
  /** Modelos devueltos por la última prueba de conexión exitosa. */
  models: ModelInfo[];
  selectedModelId: string | null;
}

export type WizardAction =
  | { type: 'selectProvider'; choice: ProviderChoice | null }
  | { type: 'providerCreated'; provider: ProviderConfig }
  | { type: 'keyChanged'; value: string }
  | { type: 'keyPresenceChanged'; present: boolean }
  | { type: 'testStarted' }
  | { type: 'testSucceeded'; models: ModelInfo[] }
  | { type: 'testFailed'; message: string }
  | { type: 'selectModel'; modelId: string }
  | { type: 'next' }
  | { type: 'skipKey' }
  | { type: 'back' };

export function createWizardState(): WizardState {
  return {
    step: 'provider',
    choice: null,
    providerId: null,
    providerRequiresKey: true,
    providerKeyRef: null,
    keyInput: '',
    hasStoredKey: false,
    test: { status: 'idle' },
    models: [],
    selectedModelId: null,
  };
}

/** Un proveedor con key configurada puede avanzar con la key escrita o con una ya guardada. */
export function keySatisfied(state: WizardState): boolean {
  return !state.providerRequiresKey || state.keyInput.trim() !== '' || state.hasStoredKey;
}

/** Habilita el botón principal de cada paso sin duplicar validaciones en la UI. */
export function canAdvance(state: WizardState): boolean {
  if (state.step === 'provider') return state.choice !== null;
  if (state.step === 'key') return keySatisfied(state);
  return state.selectedModelId !== null;
}

/**
 * Máquina de estados pura del wizard: solo transiciones válidas, sin efectos ni
 * acceso a stores. La persistencia y las llamadas al adapter viven en la UI.
 */
export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'selectProvider':
      return { ...state, choice: action.choice };

    case 'providerCreated':
      return {
        ...state,
        step: 'key',
        providerId: action.provider.id,
        providerRequiresKey: action.provider.requiresKey,
        providerKeyRef: action.provider.keyRef,
        keyInput: '',
        hasStoredKey: false,
        test: { status: 'idle' },
        models: [],
        selectedModelId: null,
      };

    case 'keyChanged':
      // Un resultado de conexión deja de ser válido en cuanto cambia la key.
      return { ...state, keyInput: action.value, test: { status: 'idle' } };

    case 'keyPresenceChanged':
      return { ...state, hasStoredKey: action.present };

    case 'testStarted':
      return { ...state, test: { status: 'testing' } };

    case 'testSucceeded': {
      const keepsSelection =
        state.selectedModelId !== null && action.models.some((model) => model.id === state.selectedModelId);
      const selectedModelId = keepsSelection ? state.selectedModelId : (action.models[0]?.id ?? null);
      return {
        ...state,
        models: action.models,
        selectedModelId,
        test: { status: 'success', count: action.models.length },
      };
    }

    case 'testFailed':
      return { ...state, test: { status: 'error', message: action.message } };

    case 'selectModel':
      if (!state.models.some((model) => model.id === action.modelId)) return state;
      return { ...state, selectedModelId: action.modelId };

    case 'next':
      if (state.step !== 'key' || !keySatisfied(state)) return state;
      return { ...state, step: 'model' };

    case 'skipKey':
      if (state.step !== 'key' || state.providerRequiresKey) return state;
      return { ...state, step: 'model' };

    case 'back':
      if (state.step === 'key') return { ...state, step: 'provider' };
      if (state.step === 'model') return { ...state, step: 'key' };
      return state;

    default:
      return state;
  }
}
