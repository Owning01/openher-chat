import type { DeadlineRule } from '../../types/legal';

// ---------------------------------------------------------------------------
// Reglas de plazo de la jurisdicción nacional.
//
// Única fuente verificada del MVP: la prescripción del CCyC (Ley 26.994) contra
// el texto actualizado de InfoLEG. La caducidad de instancia del CPCCN se
// incluye marcada `verified:false` (fuente citada, sin cotejo automático).
// NO se agregan plazos fuera de estas normas.
// ---------------------------------------------------------------------------

/** Regla con nota editorial; el tipo base congelado no declara `notes`. */
export type DeadlineRuleWithNotes = DeadlineRule & { readonly notes?: string };

/** Fuente oficial del CCyC (texto actualizado, InfoLEG). */
export const CCYC_SOURCE_URL =
  'https://servicios.infoleg.gob.ar/infolegInternet/anexos/235000-239999/235975/texact.htm';

/** Fuente oficial del CPCCN (Ley 17.454, InfoLEG). */
export const CPCCN_SOURCE_URL =
  'https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=16547';

/** Art. 2554 CCyC: el plazo comienza el día en que la prestación es exigible. */
export const PRESCRIPTION_START_NORM_REF = 'CCyC art. 2554';

const dueDateNote = 'Cómputo desde que la prestación es exigible (CCyC art. 2554).';

/** Prescripción del CCyC: verificada contra el texto oficial. */
export const PRESCRIPTION_RULES_NATIONAL: DeadlineRuleWithNotes[] = [
  {
    id: 'ccyc-2560-prescripcion-generica',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2560',
    days: 5,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Prescripción genérica (5 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2561-danos-responsabilidad-civil',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2561',
    days: 3,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Daños derivados de responsabilidad civil (3 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2561-agresiones-sexuales-incapaces',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2561',
    days: 10,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Agresiones sexuales a personas incapaces (10 años)',
    notes: 'Corre desde el cese de la incapacidad; el ancla debe ser esa fecha (CCyC art. 2561).',
  },
  {
    id: 'ccyc-2561-lesa-humanidad',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2561',
    days: 0,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Acciones civiles por delitos de lesa humanidad (imprescriptibles)',
    notes: 'Imprescriptible (CCyC art. 2561). `days: 0` marca “sin vencimiento”: el motor no calcula dueDate.',
  },
  {
    id: 'ccyc-2562-nulidad-relativa-revision',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2562',
    days: 2,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Nulidad relativa y revisión de actos jurídicos (2 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2562-accidentes-enfermedades-trabajo',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2562',
    days: 2,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Daños por accidentes o enfermedades del trabajo (2 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2562-devengamiento-periodico',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2562',
    days: 2,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Prestaciones que se devengan por años o plazos periódicos más cortos (2 años)',
    notes: 'Exceptúa el reintegro de capital en cuotas (CCyC art. 2562).',
  },
  {
    id: 'ccyc-2562-danos-transporte',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2562',
    days: 2,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Daños del contrato de transporte de personas o cosas (2 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2562-revocacion-donacion-legado',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2562',
    days: 2,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Revocación de donación por ingratitud o legado por indignidad (2 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2562-inoponibilidad-fraude',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2562',
    days: 2,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Inoponibilidad nacida del fraude (2 años)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2564-vicios-redhibitorios',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2564',
    days: 1,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Vicios redhibitorios (1 año)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2564-acciones-posesorias',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2564',
    days: 1,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Acciones posesorias (1 año)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2564-constructor-ruina',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2564',
    days: 1,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Responsabilidad del constructor por ruina (1 año)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2564-documento-endosable-portador',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2564',
    days: 1,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Reclamos de documento endosable o al portador (1 año)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2564-repeticion-alimentos',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2564',
    days: 1,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Repetición de alimentos (1 año)',
    notes: dueDateNote,
  },
  {
    id: 'ccyc-2564-revision-cosa-juzgada',
    jurisdiction: 'national',
    scope: 'prescription',
    normRef: 'CCyC art. 2564',
    days: 1,
    unit: 'years',
    from: 'due-date',
    verified: true,
    sourceUrl: CCYC_SOURCE_URL,
    label: 'Acción autónoma de revisión de cosa juzgada (1 año)',
    notes: dueDateNote,
  },
];

/** Caducidad de instancia del CPCCN: plazo sin cotejo automático (`verified:false`). */
export const CADUCIDAD_RULES_NATIONAL: DeadlineRuleWithNotes[] = [
  {
    id: 'cpccn-310-caducidad-primera-instancia',
    jurisdiction: 'national',
    scope: 'instance-lapse',
    normRef: 'CPCCN art. 310',
    days: 6,
    unit: 'months',
    from: 'filing',
    verified: false,
    sourceUrl: CPCCN_SOURCE_URL,
    label: 'Caducidad de instancia — primera instancia (6 meses)',
    notes:
      'CPCCN arts. 310 y 311: cómputo desde la última petición o resolución que impulse el procedimiento; corre en días inhábiles salvo ferias. Si el plazo de prescripción fuese menor, rige ese.',
  },
  {
    id: 'cpccn-310-caducidad-segunda-tercera-instancia',
    jurisdiction: 'national',
    scope: 'instance-lapse',
    normRef: 'CPCCN art. 310',
    days: 3,
    unit: 'months',
    from: 'filing',
    verified: false,
    sourceUrl: CPCCN_SOURCE_URL,
    label:
      'Caducidad de instancia — segunda y tercera instancia, sumarísimos, ejecutivos e incidentes (3 meses)',
    notes:
      'CPCCN arts. 310 y 311: cómputo desde la última petición o resolución que impulse el procedimiento; corre en días inhábiles salvo ferias.',
  },
  {
    id: 'cpccn-310-caducidad-incidente-caducidad',
    jurisdiction: 'national',
    scope: 'instance-lapse',
    normRef: 'CPCCN art. 310',
    days: 1,
    unit: 'months',
    from: 'filing',
    verified: false,
    sourceUrl: CPCCN_SOURCE_URL,
    label: 'Caducidad de instancia — incidente de caducidad (1 mes)',
    notes:
      'CPCCN arts. 310 y 311: cómputo desde la última petición o resolución que impulse el procedimiento.',
  },
];
