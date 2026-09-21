import type { LegalTemplate } from '../../types/legal';

/**
 * Escrito de ofrecimiento de prueba en el proceso civil y comercial.
 * Cubre documental, confesional, testimonial con pliego, pericial con puntos de pericia
 * detallados e informativa mediante oficios (arts. 360, 364 y concs. CPCCN).
 */
export const EVIDENCE_TEMPLATE: LegalTemplate = {
  id: 'ar-evidence-cpccn',
  kind: 'evidence',
  title: 'Ofrecimiento de prueba',
  jurisdictions: ['national'],
  sections: [
    {
      id: 'object',
      heading: 'Objeto',
      guidance: 'Ofrecer los medios de prueba que hacen al derecho de esta parte.',
      slots: ['case.title', 'case.court'],
      required: true,
    },
    {
      id: 'documentary',
      heading: 'Prueba documental',
      guidance: 'Individualizar los documentos acompañados y solicitar intimación a la contraria o terceros si estuvieran en su poder.',
      slots: [],
      required: true,
    },
    {
      id: 'confessional',
      heading: 'Prueba confesional',
      guidance: 'Citar a la parte contraria a absolver posiciones a tenor del pliego que oportunamente se acompañará.',
      slots: ['parties.defendant'],
      required: false,
    },
    {
      id: 'testimonial',
      heading: 'Prueba testimonial',
      guidance: 'Nominar a los testigos con nombre, profesión, domicilio y el objeto sobre el que depondrán.',
      slots: [],
      required: false,
    },
    {
      id: 'expert',
      heading: 'Prueba pericial',
      guidance: 'Designar la especialidad pericial requerida y fijar los PUNTOS DE PERICIA concretos uno por uno.',
      slots: [],
      required: true,
    },
    {
      id: 'informative',
      heading: 'Prueba informativa',
      guidance: 'Librar oficios judiciales a organismos públicos y empresas privadas para corroborar hechos controvertidos.',
      slots: [],
      required: false,
    },
    {
      id: 'petition',
      heading: 'Petitorio probatorio',
      guidance: 'Tener por ofrecida la prueba en tiempo y forma y ordenar su oportuna producción.',
      slots: ['case.clientRole'],
      required: true,
    },
  ],
  checklist: [
    {
      id: 'evidence-doc-specification',
      label: 'Individualización precisa de la prueba documental',
      normRef: 'CPCCN-387',
      packProvisions: [],
    },
    {
      id: 'evidence-witness-identification',
      label: 'Identificación y domicilio completo de testigos',
      normRef: 'CPCCN-426',
      packProvisions: [],
    },
    {
      id: 'evidence-expert-points',
      label: 'Formulación expresa de puntos de pericia pertinentes',
      normRef: 'CPCCN-458',
      packProvisions: [],
    },
    {
      id: 'evidence-offices-stated',
      label: 'Determinación exacta de los entes destinatarios de oficios',
      normRef: 'CPCCN-396',
      packProvisions: [],
    },
  ],
  packProvisions: ['CPCCN-360', 'CPCCN-364', 'CPCCN-387', 'CPCCN-426', 'CPCCN-458'],
};
