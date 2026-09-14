import { defineDict } from '../index';

export const legalSetup = defineDict({
  es: {
    title: 'Modo legal (opcional)',
    description: 'Preconfigura el workspace jurídico argentino (civil y comercial). Podés cambiarlo luego en Ajustes.',
    featureJurisdiction: 'Jurisdicción por defecto: nacional y CABA.',
    featureCorpus: 'Corpus normativo offline con fuente y fecha de cada artículo.',
    featureAnonymization: 'Anonimización obligatoria: los datos del cliente se pseudonimizan antes de salir del dispositivo.',
    enableLabel: 'Activar modo legal',
    enableHint: 'Si lo dejás apagado, igual vas a poder activarlo después desde Ajustes.',
    disclaimerTitle: 'Aviso importante',
    disclaimer:
      'El modo legal no es asesoramiento jurídico ni reemplaza tu criterio profesional. Las citas deben verificarse contra la fuente oficial; lo no verificado se marca [VERIFICAR].',
    consentLabel: 'Entiendo el secreto profesional y acepto el tratamiento de datos sensibles del expediente.',
    secrecyNotice: 'Rigen el secreto profesional (Ley 23.187 art. 6 inc. f) y la Ley 25.326 de datos personales.',
    consentRequiredHint: 'Activá el consentimiento para continuar con el modo legal.',
  },
  en: {
    title: 'Legal mode (optional)',
    description: 'Preconfigure the Argentine legal workspace (civil and commercial). You can change it later in Settings.',
    featureJurisdiction: 'Default jurisdiction: national and CABA.',
    featureCorpus: 'Offline norm corpus with source and date for each article.',
    featureAnonymization: 'Mandatory anonymization: client data is pseudonymized before leaving the device.',
    enableLabel: 'Enable legal mode',
    enableHint: 'If you leave it off, you can still enable it later from Settings.',
    disclaimerTitle: 'Important notice',
    disclaimer:
      'Legal mode is not legal advice and does not replace your professional judgment. Citations must be checked against the official source; anything unverified is marked [VERIFICAR].',
    consentLabel: 'I understand professional secrecy and accept the processing of sensitive case data.',
    secrecyNotice: 'Professional secrecy (Law 23.187 art. 6 inc. f) and Personal Data Law 25.326 apply.',
    consentRequiredHint: 'Accept the consent to continue with legal mode enabled.',
  },
});

export type LegalSetupMessages = (typeof legalSetup)['es'];

declare module '../types' {
  interface I18nSchema {
    legalSetup: LegalSetupMessages;
  }
}
