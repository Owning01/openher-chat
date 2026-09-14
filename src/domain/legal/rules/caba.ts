import type { DeadlineRule } from '../../types/legal';

// ---------------------------------------------------------------------------
// Reglas de plazo de la jurisdicción CABA.
//
// El MVP no fija plazos locales verificados: la lista queda deliberadamente
// vacía para no inventar términos. Cuando se cure el Código Procesal de la
// Ciudad (u otra norma local) se agregan aquí con `verified`, `normRef` y
// `sourceUrl`, y se activan vía `resolveDeadlineRules('caba')`.
// ---------------------------------------------------------------------------

/** Sin plazos CABA verificados en el MVP. */
export const PRESCRIPTION_RULES_CABA: DeadlineRule[] = [];
