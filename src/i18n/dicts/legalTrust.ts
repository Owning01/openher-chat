import { defineDict } from '../index';

export const legalTrust = defineDict({
  es: {
    watermarkLabel: 'Borrador de trabajo: análisis interno, no presentable.',
    counters: '{verified} verificadas · {unverified} sin verificar',
    verifyHint: 'Las citas marcadas [VERIFICAR] no están confirmadas contra el índice legal.',
    privacyTitle: 'Qué sale del dispositivo',
    privacyShow: 'Ver detalle',
    privacyHide: 'Ocultar detalle',
    privacyEmpty: 'Sin datos anonimizados en este envío.',
    privacyNote: 'Solo salen conteos y texto anonimizado; los valores originales no se muestran aquí.',
    redactionPerson: 'Personas',
    redactionDoc: 'Documentos',
    redactionCuit: 'CUIT/CUIL',
    redactionEmail: 'Correos',
    redactionPhone: 'Teléfonos',
    redactionCbu: 'CBU/alias',
    redactionAddress: 'Domicilios',
    consentLabel: 'Acepto que el texto anonimizado del expediente salga del dispositivo para esta consulta.',
    consentRequired: 'Aceptá el consentimiento para enviar en modo legal.',
    consentAccepted: 'Consentimiento aceptado para esta sesión.',
    secrecyNotice: 'Rigen el secreto profesional y la Ley 25.326 de datos personales.',
  },
  en: {
    watermarkLabel: 'Working draft: internal analysis, not for filing.',
    counters: '{verified} verified · {unverified} unverified',
    verifyHint: 'Citations marked [VERIFICAR] are not confirmed against the legal index.',
    privacyTitle: 'What leaves the device',
    privacyShow: 'Show detail',
    privacyHide: 'Hide detail',
    privacyEmpty: 'No anonymized data in this send.',
    privacyNote: 'Only counts and anonymized text leave; original values are not shown here.',
    redactionPerson: 'People',
    redactionDoc: 'IDs',
    redactionCuit: 'Tax IDs',
    redactionEmail: 'Emails',
    redactionPhone: 'Phones',
    redactionCbu: 'Bank accounts',
    redactionAddress: 'Addresses',
    consentLabel: 'I accept that the anonymized case text leaves the device for this query.',
    consentRequired: 'Accept the consent to send in legal mode.',
    consentAccepted: 'Consent accepted for this session.',
    secrecyNotice: 'Professional secrecy and Personal Data Law 25.326 apply.',
  },
});

export type LegalTrustMessages = (typeof legalTrust)['es'];

declare module '../types' {
  interface I18nSchema {
    legalTrust: LegalTrustMessages;
  }
}
