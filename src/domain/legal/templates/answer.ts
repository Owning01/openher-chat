import type { LegalTemplate } from '../../types/legal';

/**
 * Contestación de demanda ante la justicia nacional. La checklist cubre la carga
 * de los arts. 355/356 del CPCCN (reconocer o negar cada hecho y la autenticidad
 * de los documentos; silencio, evasivas y negativa general como posible
 * reconocimiento) y la mención de las excepciones previas de los arts. 346/347.
 */
export const ANSWER_TEMPLATE: LegalTemplate = {
  id: 'ar-answer-cpccn',
  kind: 'answer',
  title: 'Contestación de demanda',
  jurisdictions: ['national'],
  sections: [
    {
      id: 'object',
      heading: 'Objeto',
      guidance: 'Individualizar el expediente y la pretensión que se contesta.',
      slots: ['case.title', 'case.court'],
      required: true,
    },
    {
      id: 'parties',
      heading: 'Partes',
      guidance: 'Individualizar a quien contesta y a la contraria, con su carácter procesal.',
      slots: ['parties.defendant', 'parties.plaintiff'],
      required: true,
    },
    {
      id: 'facts-response',
      heading: 'Reconocimiento y negación de hechos',
      guidance: 'Pronunciarse uno por uno sobre cada hecho y sobre la autenticidad de los documentos atribuidos.',
      slots: ['facts'],
      required: true,
    },
    {
      id: 'defense',
      heading: 'Defensa',
      guidance: 'Explicar con claridad los hechos en que se funda la defensa.',
      slots: ['case.matter'],
      required: true,
    },
    {
      id: 'prior-exceptions',
      heading: 'Excepciones previas',
      guidance: 'Oponer las excepciones previas que correspondan y fundarlas normativamente.',
      slots: [],
      required: false,
    },
    {
      id: 'petition',
      heading: 'Petición',
      guidance: 'Formular la petición en términos claros y positivos.',
      slots: ['case.clientRole'],
      required: true,
    },
  ],
  checklist: [
    {
      id: 'answer-admit-deny',
      label: 'Reconocer o negar categóricamente cada hecho expuesto en la demanda',
      normRef: 'CPCCN-356',
      packProvisions: ['CPCCN-355', 'CPCCN-356'],
    },
    {
      id: 'answer-documents',
      label: 'Reconocer o negar la autenticidad de los documentos acompañados que se le atribuyan',
      normRef: 'CPCCN-356',
      packProvisions: ['CPCCN-356'],
    },
    {
      id: 'answer-silence-warning',
      label: 'Evitar el silencio, las respuestas evasivas o la negativa general: pueden estimarse reconocimiento',
      normRef: 'CPCCN-356',
      packProvisions: ['CPCCN-356'],
    },
    {
      id: 'answer-defense-facts',
      label: 'Especificar con claridad los hechos en que se funda la defensa',
      normRef: 'CPCCN-356',
      packProvisions: ['CPCCN-356'],
    },
    {
      id: 'answer-requirements',
      label: 'Observar, en lo aplicable, los requisitos del artículo 330',
      normRef: 'CPCCN-356',
      packProvisions: ['CPCCN-330', 'CPCCN-356'],
    },
    {
      id: 'answer-prior-exceptions',
      label: 'Oponer las excepciones previas que correspondan (incompetencia, falta de personería, litispendencia, defecto legal, cosa juzgada, prescripción, caducidad y demás)',
      normRef: 'CPCCN-346',
      packProvisions: ['CPCCN-346', 'CPCCN-347'],
    },
    {
      id: 'answer-deadline',
      label: 'Presentar la contestación dentro del plazo legal',
      normRef: 'CPCCN-355',
      packProvisions: ['CPCCN-355'],
    },
  ],
  packProvisions: ['CPCCN-330', 'CPCCN-346', 'CPCCN-347', 'CPCCN-355', 'CPCCN-356'],
};
