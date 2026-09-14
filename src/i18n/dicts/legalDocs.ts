import { defineDict } from '../index';

export const legalDocs = defineDict({
  es: {
    title: 'Estudio de documentos',
    templateLabel: 'Plantilla',
    checklistTitle: 'Checklist procesal',
    editLabel: 'Borrador (Markdown editable)',
    previewLabel: 'Vista previa con avisos',
    counters: '{verified} verificadas · {unverified} sin verificar',
    consentLabel:
      'Reconozco que el documento puede contener citas sin verificar y acepto exportarlo como borrador no presentable.',
    consentHint: 'La exportación queda bloqueada hasta marcar este reconocimiento.',
    consentRecorded: 'Reconocimiento registrado en esta sesión.',
    sessionConsentNote:
      'Sin repositorio de consentimientos: el reconocimiento vale sólo para esta sesión.',
    exportBlocked: 'Exportación bloqueada: marcá el reconocimiento para habilitarla.',
    exportDownload: 'Descargar .md',
    exportCopy: 'Copiar texto',
    exportPrint: 'Imprimir',
    saveDraft: 'Guardar borrador',
    draftSaved: 'Borrador guardado.',
    copied: 'Texto copiado al portapapeles.',
    copyFailed: 'No se pudo copiar. Seleccioná el texto manualmente.',
    ackError: 'No se pudo registrar el reconocimiento.',
    saveFailed: 'No se pudo guardar el borrador.',
    downloadFailed: 'No se pudo descargar el archivo.',
    printFailed: 'No se pudo abrir el diálogo de impresión.',
    dismiss: 'Descartar',
    limitsNote:
      'Límites: el borrador es interno y no presentable; las citas marcadas [VERIFICAR] no están confirmadas. En web se descarga .md o se imprime; en Android se copia el texto para compartirlo desde el sistema.',
  },
  en: {
    title: 'Document studio',
    templateLabel: 'Template',
    checklistTitle: 'Procedural checklist',
    editLabel: 'Draft (editable Markdown)',
    previewLabel: 'Preview with notices',
    counters: '{verified} verified · {unverified} unverified',
    consentLabel:
      'I acknowledge the document may contain unverified citations and accept exporting it as a non-presentable draft.',
    consentHint: 'Export stays blocked until this acknowledgment is checked.',
    consentRecorded: 'Acknowledgment recorded for this session.',
    sessionConsentNote:
      'No acknowledgment repository: the acknowledgment is valid for this session only.',
    exportBlocked: 'Export blocked: check the acknowledgment to enable it.',
    exportDownload: 'Download .md',
    exportCopy: 'Copy text',
    exportPrint: 'Print',
    saveDraft: 'Save draft',
    draftSaved: 'Draft saved.',
    copied: 'Text copied to the clipboard.',
    copyFailed: 'Could not copy. Select the text manually.',
    ackError: 'Could not record the acknowledgment.',
    saveFailed: 'Could not save the draft.',
    downloadFailed: 'Could not download the file.',
    printFailed: 'Could not open the print dialog.',
    dismiss: 'Dismiss',
    limitsNote:
      'Limits: the draft is internal and not for filing; citations marked [VERIFICAR] are unconfirmed. On web download the .md or print; on Android copy the text to share it from the system.',
  },
});

export type LegalDocsMessages = (typeof legalDocs)['es'];

declare module '../types' {
  interface I18nSchema {
    legalDocs: LegalDocsMessages;
  }
}
