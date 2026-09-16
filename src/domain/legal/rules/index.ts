import type { DeadlineRule, LegalJurisdiction } from '../../types/legal';
import { PRESCRIPTION_RULES_CABA } from './caba';
import { CADUCIDAD_RULES_NATIONAL, PRESCRIPTION_RULES_NATIONAL } from './national';

// ---------------------------------------------------------------------------
// Registro de reglas por jurisdicción.
// ---------------------------------------------------------------------------

export {
  CADUCIDAD_RULES_NATIONAL,
  CCYC_SOURCE_URL,
  CPCCN_SOURCE_URL,
  PRESCRIPTION_RULES_NATIONAL,
  PRESCRIPTION_START_NORM_REF,
} from './national';
export type { DeadlineRuleWithNotes } from './national';
export { PRESCRIPTION_RULES_CABA } from './caba';

/** Todas las reglas nacionales: prescripción verificada + caducidad sin verificar. */
export const DEADLINE_RULES_NATIONAL: DeadlineRule[] = [
  ...PRESCRIPTION_RULES_NATIONAL,
  ...CADUCIDAD_RULES_NATIONAL,
];

/** Registro por jurisdicción; `pba`/`cordoba`/`tucuman` quedan declaradas sin reglas. */
export const DEADLINE_RULES_BY_JURISDICTION: Readonly<
  Record<LegalJurisdiction, readonly DeadlineRule[]>
> = {
  national: DEADLINE_RULES_NATIONAL,
  caba: PRESCRIPTION_RULES_CABA,
  pba: [],
  cordoba: [],
  tucuman: [],
};

/** Devuelve las reglas de la jurisdicción pedida (copia mutable). */
export function resolveDeadlineRules(jurisdiction: LegalJurisdiction): DeadlineRule[] {
  return [...DEADLINE_RULES_BY_JURISDICTION[jurisdiction]];
}
