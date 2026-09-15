/**
 * Handoff del circuito adversarial: textos semilla que viajan de un chat al
 * siguiente. Data pura (markdown); las reglas de cada rol las pone el scaffold
 * (`buildLegalRolePrompt`), acá sólo va el contenido a revisar.
 */

/** Semilla del chat atacante: el escrito a revisar, delimitado. */
export function buildAttackerSeed(documentMarkdown: string): string {
  const doc = documentMarkdown.trim();
  return ['# Derivación al atacante', '', 'Revisá y atacá el siguiente escrito con todo lo lícito.', '', '## Escrito a revisar', '', doc !== '' ? doc : '[COMPLETAR: escrito pendiente]'].join('\n');
}

/** Semilla del chat definitivo: escrito + ataque de la contraparte. */
export function buildJudgeSeed(documentMarkdown: string, attackMarkdown: string): string {
  const doc = documentMarkdown.trim();
  const attack = attackMarkdown.trim();
  return [
    '# Elevación al definitivo',
    '',
    'Decidí únicamente con lo presentado acá: el escrito (parte A) y el ataque (parte B).',
    '',
    '## Escrito',
    '',
    doc !== '' ? doc : '[COMPLETAR: escrito pendiente]',
    '',
    '## Ataque de la contraparte',
    '',
    attack !== '' ? attack : '[COMPLETAR: ataque pendiente]',
  ].join('\n');
}

/**
 * Semilla del chat de síntesis final: escrito + ataque + veredicto del
 * definitivo. Data pura (markdown); las reglas las pone el scaffold.
 */
export function buildFinalSeed(documentMarkdown: string, attackMarkdown: string, verdictMarkdown: string): string {
  const doc = documentMarkdown.trim();
  const attack = attackMarkdown.trim();
  const verdict = verdictMarkdown.trim();
  return [
    '# Síntesis final del expediente',
    '',
    'Fusioná las tres partes en el documento final pulido, siguiendo el veredicto.',
    '',
    '## Parte 1 — Escrito',
    '',
    doc !== '' ? doc : '[COMPLETAR: escrito pendiente]',
    '',
    '## Parte 2 — Ataque de la contraparte',
    '',
    attack !== '' ? attack : '[COMPLETAR: ataque pendiente]',
    '',
    '## Parte 3 — Veredicto del definitivo',
    '',
    verdict !== '' ? verdict : '[COMPLETAR: veredicto pendiente]',
  ].join('\n');
}
