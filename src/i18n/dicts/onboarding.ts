import { defineDict } from '../index';

export const onboarding = defineDict({
  es: {
    stepsLabel: 'Pasos del onboarding',
    stepLabel: 'Paso {current} de {total}',
    title: 'Configurá tu proveedor',
    subtitle: 'En tres pasos vas a poder empezar a chatear.',
    skipForNow: 'Saltar por ahora',
    errorTitle: 'Algo salió mal',

    stepProvider: 'Proveedor',
    stepConnection: 'Conexión',
    stepModel: 'Modelo',
    stepLegal: 'Legal',

    providerTitle: 'Elegí un proveedor',
    providerDescription: 'Seleccioná una plantilla del catálogo o configurá un endpoint propio.',
    keyRequired: 'Requiere API key',
    keyNotRequired: 'Sin API key',
    customTitle: 'Personalizado',
    customDescription: 'Configurá un endpoint OpenAI compatible o Anthropic.',
    selected: 'Seleccionado',
    continue: 'Continuar',

    keyTitle: 'Conectá con el proveedor',
    keyDescription: 'La API key se guarda solo en este dispositivo.',
    keyDescriptionOptional: 'Este proveedor no requiere API key. Igual podés probar la conexión.',
    keyRequiredHint: 'Ingresá tu API key para continuar.',
    testConnection: 'Probar conexión',
    testing: 'Probando…',
    testSuccess: '{count} modelos disponibles',
    testEmpty: 'Conexión correcta, sin modelos devueltos',
    testErrorTitle: 'No se pudo conectar',
    testErrorUnknown: 'Error desconocido',
    skipKey: 'Saltar',

    modelTitle: 'Elegí un modelo por defecto',
    modelDescription: 'Se usará en tus conversaciones nuevas.',
    modelEmptyTitle: 'Sin modelos todavía',
    modelEmptyDescription: 'Probá la conexión para descubrir los modelos disponibles.',
    modelContext: '{tokens} tokens de contexto',
    finish: 'Empezar a chatear',
  },
  en: {
    stepsLabel: 'Onboarding steps',
    stepLabel: 'Step {current} of {total}',
    title: 'Set up your provider',
    subtitle: 'Three steps and you are ready to chat.',
    skipForNow: 'Skip for now',
    errorTitle: 'Something went wrong',

    stepProvider: 'Provider',
    stepConnection: 'Connection',
    stepModel: 'Model',
    stepLegal: 'Legal',

    providerTitle: 'Choose a provider',
    providerDescription: 'Pick a template from the catalog or configure your own endpoint.',
    keyRequired: 'API key required',
    keyNotRequired: 'No API key',
    customTitle: 'Custom',
    customDescription: 'Configure an OpenAI-compatible or Anthropic endpoint.',
    selected: 'Selected',
    continue: 'Continue',

    keyTitle: 'Connect to the provider',
    keyDescription: 'The API key is stored only on this device.',
    keyDescriptionOptional: 'This provider does not require an API key. You can still test the connection.',
    keyRequiredHint: 'Enter your API key to continue.',
    testConnection: 'Test connection',
    testing: 'Testing…',
    testSuccess: '{count} models available',
    testEmpty: 'Connection succeeded, no models returned',
    testErrorTitle: 'Connection failed',
    testErrorUnknown: 'Unknown error',
    skipKey: 'Skip',

    modelTitle: 'Choose a default model',
    modelDescription: 'It will be used for your new conversations.',
    modelEmptyTitle: 'No models yet',
    modelEmptyDescription: 'Test the connection to discover available models.',
    modelContext: '{tokens} context tokens',
    finish: 'Start chatting',
  },
});

export type OnboardingMessages = (typeof onboarding)['es'];

declare module '../types' {
  interface I18nSchema {
    onboarding: OnboardingMessages;
  }
}
