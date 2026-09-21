import type { LegalTemplate } from '../../types/legal';

/**
 * Recurso de apelación y expresión de agravios ante la Cámara Nacional de Apelaciones.
 * La checklist cubre las exigencias del art. 265 del CPCCN: crítica concreta y razonada,
 * autosuficiencia del memorial y oportuno planteo de la cuestión federal (art. 14 Ley 48).
 */
export const APPEAL_TEMPLATE: LegalTemplate = {
  id: 'ar-appeal-cpccn',
  kind: 'appeal',
  title: 'Expresión de agravios (Apelación)',
  jurisdictions: ['national'],
  sections: [
    {
      id: 'object',
      heading: 'Objeto procesal y admisibilidad',
      guidance: 'Manifestar la personería, interponer la expresión de agravios en término de ley contra la resolución recurrida.',
      slots: ['case.title', 'case.court'],
      required: true,
    },
    {
      id: 'background',
      heading: 'Antecedentes de la resolución recurrida',
      guidance: 'Sintetizar con precisión lo resuelto en primera instancia y los puntos materia de recurso.',
      slots: [],
      required: true,
    },
    {
      id: 'grievance-facts',
      heading: 'Primer agravio: Error en la apreciación de los hechos y la prueba',
      guidance: 'Criticar de modo concreto y razonado los errores de hecho y de valoración probatoria del fallo.',
      slots: ['facts'],
      required: true,
    },
    {
      id: 'grievance-law',
      heading: 'Segundo agravio: Errónea aplicación del derecho',
      guidance: 'Demostrar la infracción o errónea interpretación de las normas de fondo aplicables.',
      slots: ['case.matter'],
      required: true,
    },
    {
      id: 'grievance-costs',
      heading: 'Tercer agravio: Imposición de costas y honorarios',
      guidance: 'Impugnar la distribución de costas y/o cuantificación de honorarios si causa gravamen irreparable.',
      slots: [],
      required: false,
    },
    {
      id: 'federal-case',
      heading: 'Reserva del Caso Federal',
      guidance: 'Hacer reserva expresa del Caso Federal para ocurrir ante la CSJN por vía del art. 14 de la Ley 48.',
      slots: [],
      required: true,
    },
    {
      id: 'petition',
      heading: 'Petitorio',
      guidance: 'Solicitar que se tenga por expresados los agravios en término y se revoque la sentencia con costas.',
      slots: ['case.clientRole'],
      required: true,
    },
  ],
  checklist: [
    {
      id: 'appeal-timely',
      label: 'Presentación en plazo procesal oportuno',
      normRef: 'CPCCN-265',
      packProvisions: ['CPCCN-265'],
    },
    {
      id: 'appeal-concrete-criticism',
      label: 'Crítica concreta y razonada de los fundamentos del fallo',
      normRef: 'CPCCN-265',
      packProvisions: ['CPCCN-265'],
    },
    {
      id: 'appeal-self-sufficient',
      label: 'Autosuficiencia del memorial sin remisiones genéricas',
      normRef: 'CPCCN-265',
      packProvisions: ['CPCCN-265'],
    },
    {
      id: 'appeal-federal-reserve',
      label: 'Planteo expreso de Reserva del Caso Federal (Ley 48 art. 14)',
      normRef: 'Ley 48 art. 14',
      packProvisions: [],
    },
    {
      id: 'appeal-revocation-petition',
      label: 'Petición expresa de revocatoria de la sentencia con costas',
      normRef: 'CPCCN-265',
      packProvisions: ['CPCCN-265'],
    },
  ],
  packProvisions: ['CPCCN-265'],
};
