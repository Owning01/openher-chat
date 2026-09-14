import type { LegalTemplate } from '../../types/legal';

/**
 * Demanda civil ante la justicia nacional. La checklist reproduce el contenido
 * del art. 330 del CPCCN: seis incisos más la precisión del monto reclamado.
 */
export const CLAIM_TEMPLATE: LegalTemplate = {
  id: 'ar-claim-cpccn',
  kind: 'claim',
  title: 'Demanda civil',
  jurisdictions: ['national'],
  sections: [
    {
      id: 'object',
      heading: 'Objeto',
      guidance: 'Identificar la pretensión y designar la cosa demandada con exactitud.',
      slots: ['case.title', 'case.matter'],
      required: true,
    },
    {
      id: 'parties',
      heading: 'Partes',
      guidance: 'Denominar al demandante y al demandado con nombre y domicilio.',
      slots: ['parties.plaintiff', 'parties.defendant'],
      required: true,
    },
    {
      id: 'facts',
      heading: 'Hechos',
      guidance: 'Relatar los hechos en orden cronológico, con fecha y fuente de cada uno.',
      slots: ['facts'],
      required: true,
    },
    {
      id: 'law',
      heading: 'Derecho',
      guidance: 'Exponer sucintamente el derecho aplicable, citando sólo normas del índice provisto.',
      slots: ['case.jurisdiction'],
      required: true,
    },
    {
      id: 'petition',
      heading: 'Petición',
      guidance: 'Redactar la petición en términos claros y positivos e indicar el monto reclamado.',
      slots: ['case.clientRole'],
      required: true,
    },
    {
      id: 'evidence',
      heading: 'Prueba',
      guidance: 'Ofrecer la prueba documental, testimonial, confesional y pericial.',
      slots: [],
      required: false,
    },
    {
      id: 'key-dates',
      heading: 'Fechas relevantes',
      guidance: 'Consignar las fechas clave del expediente que ordenan la narración.',
      slots: ['keyDates'],
      required: false,
    },
  ],
  checklist: [
    {
      id: 'claim-plaintiff',
      label: 'Nombre y domicilio del demandante',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
    {
      id: 'claim-defendant',
      label: 'Nombre y domicilio del demandado',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
    {
      id: 'claim-thing',
      label: 'La cosa demandada, designada con exactitud',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
    {
      id: 'claim-facts',
      label: 'Los hechos que fundan la demanda, explicados claramente',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
    {
      id: 'claim-law',
      label: 'El derecho expuesto sucintamente',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
    {
      id: 'claim-petition',
      label: 'La petición en términos claros y positivos',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
    {
      id: 'claim-amount',
      label: 'La precisión del monto reclamado, salvo imposibilidad de determinarlo',
      normRef: 'CPCCN-330',
      packProvisions: ['CPCCN-330'],
    },
  ],
  packProvisions: ['CPCCN-330'],
};
