import type { LegalTemplate } from '../../types/legal';

/**
 * Carta documento: instrumento postal de intimación previa. La checklist reúne
 * los recaudos formales del instrumento (Ley 23.789 y su reglamentación) y la
 * intimación con plazo y apercibimiento para constituir en mora (CCyC art. 886).
 */
export const DEMAND_LETTER_TEMPLATE: LegalTemplate = {
  id: 'ar-demand-letter',
  kind: 'demand-letter',
  title: 'Carta documento',
  jurisdictions: [],
  sections: [
    {
      id: 'sender',
      heading: 'Remitente',
      guidance: 'Individualizar al remitente con nombre, domicilio y carácter en que se dirige.',
      slots: ['case.title', 'case.clientRole'],
      required: true,
    },
    {
      id: 'recipient',
      heading: 'Destinatario',
      guidance: 'Individualizar al destinatario con nombre y domicilio.',
      slots: ['parties.defendant', 'parties.all'],
      required: true,
    },
    {
      id: 'facts',
      heading: 'Antecedentes',
      guidance: 'Relacionar los hechos y el vínculo jurídico que origina la intimación.',
      slots: ['facts', 'keyDates'],
      required: true,
    },
    {
      id: 'claim',
      heading: 'Intimación',
      guidance: 'Expresar de modo concreto y positivo lo que se intima a cumplir.',
      slots: [],
      required: true,
    },
    {
      id: 'deadline',
      heading: 'Plazo',
      guidance: 'Otorgar un plazo cierto y razonable para el cumplimiento.',
      slots: [],
      required: true,
    },
    {
      id: 'warning',
      heading: 'Apercibimiento',
      guidance: 'Advertir las consecuencias legales del incumplimiento.',
      slots: [],
      required: true,
    },
    {
      id: 'signature',
      heading: 'Firma y fecha',
      guidance: 'Consignar lugar, fecha y firma del remitente.',
      slots: [],
      required: true,
    },
  ],
  checklist: [
    {
      id: 'letter-sender',
      label: 'Identificación del remitente (nombre, domicilio y carácter)',
      normRef: 'LEY-23789',
      packProvisions: ['LEY-23789'],
    },
    {
      id: 'letter-recipient',
      label: 'Identificación del destinatario (nombre y domicilio)',
      normRef: 'LEY-23789',
      packProvisions: ['LEY-23789'],
    },
    {
      id: 'letter-relationship',
      label: 'Relación de los hechos y del vínculo jurídico',
      normRef: 'LEY-23789',
      packProvisions: ['LEY-23789'],
    },
    {
      id: 'letter-claim',
      label: 'Intimación concreta y clara de lo exigido',
      normRef: 'CCyC-886',
      packProvisions: ['CCyC-886'],
    },
    {
      id: 'letter-deadline',
      label: 'Plazo otorgado para el cumplimiento',
      normRef: 'CCyC-886',
      packProvisions: ['CCyC-886'],
    },
    {
      id: 'letter-warning',
      label: 'Apercibimiento de las consecuencias legales del incumplimiento',
      normRef: 'CCyC-886',
      packProvisions: ['CCyC-886'],
    },
    {
      id: 'letter-signature',
      label: 'Lugar, fecha y firma del remitente',
      normRef: 'LEY-23789',
      packProvisions: ['LEY-23789'],
    },
  ],
  packProvisions: ['LEY-23789', 'CCyC-886'],
};
