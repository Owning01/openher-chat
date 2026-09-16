/**
 * Handoff del circuito adversarial: textos semilla que viajan de un chat al
 * siguiente. Cada semilla trae data (markdown del chat anterior) más el
 * contrato de salida del rol que la recibe; las reglas de cada rol las pone el
 * scaffold (`buildLegalRolePrompt`), acá sólo van el contenido a revisar y el
 * formato de respuesta exigido.
 *
 * El redactor es el chat inicial y no tiene semilla: su contrato de estructura
 * (`REDACTOR_DRAFT_CONTRACT`) queda exportado para reutilización y la síntesis
 * lo aplica al fusionar. Modelo distinto por rol: diferido, cada chat usa el
 * modelo de su conversación.
 *
 * Excepción justificada: no se filtra el brief por rol porque el juez necesita
 * los hechos para ponderar; el firewall actúa sólo sobre las semillas.
 * Deuda anotada (no bloqueante): `resolveAttackerDoc` delega en
 * `resolveSanitizedPart`; la unificación total de helpers queda pendiente.
 */

/** Secciones obligatorias del escrito AR, en orden (redactor y síntesis). */
export const DRAFT_REQUIRED_SECTIONS: readonly string[] = [
  'Encabezado',
  'Objeto',
  'Hechos',
  'Derecho',
  'Prueba',
  'Petitorio',
];

/**
 * Estructura de escrito AR exigida al redactor (chat inicial, sin semilla) y a
 * la síntesis final. Se inyecta en la semilla de síntesis; el redactor la
 * recibe por su brief, no por semilla.
 */
export const REDACTOR_DRAFT_CONTRACT: string = [
  'El documento es un escrito AR con estas secciones, en este orden:',
  '1. Encabezado — juzgado, expediente, carátula y partes.',
  '2. Objeto — pretensión y cosa demandada con exactitud.',
  '3. Hechos — relato cronológico, cada hecho con fecha y fuente.',
  '4. Derecho — encuadre normativo con citas verificadas del índice; la jurisprudencia se cita con formato Fallos `tomo:página` y lo no confirmado se marca [VERIFICAR].',
  '5. Prueba — ofrecimiento de documental, testimonial, confesional y pericial.',
  '6. Petitorio — petición en términos claros y positivos, con monto reclamado o [COMPLETAR] si falta.',
  'Los datos ausentes se marcan [COMPLETAR]; nada se presenta como listo para presentar.',
].join('\n');

/** Contrato de salida del atacante: tesis numeradas accionables. */
export const ATTACKER_OUTPUT_CONTRACT: string = [
  'Respondé sólo con tesis numeradas (1., 2., 3., …). Cada tesis contiene:',
  '- Punto débil del escrito que ataca.',
  '- Norma que sostiene el ataque (cita verificada del índice o [VERIFICAR] si no se confirma).',
  '- Remedio procesal o argumento que lo explota.',
  'Sin preámbulos ni defensas del redactor.',
].join('\n');

/**
 * Contrato de salida del juez: rúbrica fija por tesis con cierre de veredicto
 * obligatorio. El formato `Verdict: side A x% / side B y%` coincide con el
 * exigido por el scaffold (`buildLegalRolePrompt`); conservarlo byte-idéntico.
 */
export const JUDGE_OUTPUT_CONTRACT: string = [
  'Contrastá cada tesis del escrito (parte A) con el ataque recibido (parte B).',
  'Ponderá cada tesis con su prueba y sus citas y estimá cómo fallaría un tribunal.',
  'Cerrá con la sección de veredicto: una línea por tesis con el formato `Verdict: side A x% / side B y%` (x + y = 100) más su fundamento. Nunca cierres la respuesta sin la sección de veredicto.',
].join('\n');

/** Encabezados de semillas previas o de contrato: marcan texto acarreado. */
const PRIOR_SEED_PATTERN =
  /^#{1,6}\s+(derivaci[oó]n al atacante|elevaci[oó]n al definitivo|s[ií]ntesis final del expediente|contrato de salida)/im;

/** Corta el texto acarreado de una semilla previa para que no se aniden. */
function stripPriorSeedText(markdown: string): string {
  const cut = markdown.search(PRIOR_SEED_PATTERN);
  return (cut < 0 ? markdown : markdown.slice(0, cut)).trim();
}

/** Normaliza una línea para detectar instrucciones (sin tildes, minúsculas). */
function normalizeScanLine(line: string): string {
  return line
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Patrones de instrucción embebida (cambio de rol o de instrucciones).
 *
 * Cobertura barata por línea, sin tablas de confusables. Límites conocidos
 * (documentados, no se corrigen acá): homoglifos cirílicos que evaden la
 * normalización NFD, cambio de rol en portugués e instrucción llana sin
 * palabras clave (p. ej. escondida en un fence). Filtrar imperativos llanos
 * sería demasiado agresivo contra hechos legítimos.
 */
const INSTRUCTION_INJECTION_PATTERNS: readonly RegExp[] = [
  /actua\s+como/,
  /act\s+as\b/,
  /\b(sos|eres)\s+(el\s+)?(redactor|defensor|juez|atacante|abogado)\b/,
  /you\s+are\s+(now\s+)?((the|my)\s+)?(judge|lawyer)\b/,
  /ignora.*(instruccion|regla|orden|todo lo anterior)/,
  /ignora.*(todo|anterior)/,
  /olvida.*(instruccion|todo lo anterior)/,
  /cambia(r)?\s+(tu|de)\s+rol/,
  /sigue\s+estas\s+instrucciones/,
  /revela.*(instruccion|prompt)/,
  /you\s+are\s+(now\s+)?(a|an|the|my)\b/,
  /ignore\s+.*(instruction|rule)/,
  /ignore\s+(all\s+)?previous\s+instructions/,
  /follow\s+these\s+instructions/,
  /change\s+your\s+role/,
  /system\s+prompt/,
  /\bsystem\s*:/,
];

/**
 * Sanitiza el escrito que recibe el atacante: elimina líneas con
 * instrucciones embebidas (intento de cambio de rol o de instrucciones) y
 * colapsa blancos. Nunca lanza.
 */
function sanitizeEmbeddedInstructions(markdown: string): string {
  return markdown
    .split('\n')
    .filter(
      (line) =>
        !INSTRUCTION_INJECTION_PATTERNS.some((pattern) => pattern.test(normalizeScanLine(line))),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Coerción defensiva: entradas no-string degradan a '' sin lanzar. */
function toSafeMarkdown(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Parte sanitizada (semilla previa + instrucciones embebidas); placeholder si queda vacía. */
function resolveSanitizedPart(markdown: string, placeholder: string): string {
  const clean = sanitizeEmbeddedInstructions(stripPriorSeedText(markdown));
  return clean !== '' ? clean : placeholder;
}

/** Escrito del atacante: sin texto previo y sin instrucciones embebidas. */
function resolveAttackerDoc(documentMarkdown: string): string {
  return resolveSanitizedPart(documentMarkdown, '[COMPLETAR: escrito pendiente]');
}

/** Semilla del chat atacante: el escrito a revisar, delimitado. */
export function buildAttackerSeed(documentMarkdown: unknown): string {
  const doc = resolveAttackerDoc(toSafeMarkdown(documentMarkdown));
  return [
    '# Derivación al atacante',
    '',
    'Revisá y atacá el siguiente escrito con todo lo lícito.',
    '',
    '## Contrato de salida (obligatorio)',
    '',
    ATTACKER_OUTPUT_CONTRACT,
    '',
    '## Escrito a revisar',
    '',
    doc,
  ].join('\n');
}

/** Semilla del chat definitivo: escrito + ataque de la contraparte. */
export function buildJudgeSeed(documentMarkdown: unknown, attackMarkdown: unknown): string {
  const doc = resolveSanitizedPart(toSafeMarkdown(documentMarkdown), '[COMPLETAR: escrito pendiente]');
  const attack = resolveSanitizedPart(toSafeMarkdown(attackMarkdown), '[COMPLETAR: ataque pendiente]');
  return [
    '# Elevación al definitivo',
    '',
    'Decidí únicamente con lo presentado acá: el escrito (parte A) y el ataque (parte B).',
    '',
    '## Contrato de salida (obligatorio)',
    '',
    JUDGE_OUTPUT_CONTRACT,
    '',
    '## Escrito',
    '',
    doc,
    '',
    '## Ataque de la contraparte',
    '',
    attack,
  ].join('\n');
}

/**
 * Semilla del chat de síntesis final: escrito + ataque + veredicto del
 * definitivo. Data pura (markdown); las reglas las pone el scaffold.
 */
export function buildFinalSeed(
  documentMarkdown: unknown,
  attackMarkdown: unknown,
  verdictMarkdown: unknown,
): string {
  const doc = resolveSanitizedPart(toSafeMarkdown(documentMarkdown), '[COMPLETAR: escrito pendiente]');
  const attack = resolveSanitizedPart(toSafeMarkdown(attackMarkdown), '[COMPLETAR: ataque pendiente]');
  const verdict = resolveSanitizedPart(toSafeMarkdown(verdictMarkdown), '[COMPLETAR: veredicto pendiente]');
  return [
    '# Síntesis final del expediente',
    '',
    'Fusioná las tres partes en el documento final pulido, siguiendo el veredicto.',
    '',
    '## Contrato de salida (obligatorio)',
    '',
    REDACTOR_DRAFT_CONTRACT,
    '',
    '## Parte 1 — Escrito',
    '',
    doc,
    '',
    '## Parte 2 — Ataque de la contraparte',
    '',
    attack,
    '',
    '## Parte 3 — Veredicto del definitivo',
    '',
    verdict,
  ].join('\n');
}

/** Línea canónica de veredicto: `Verdict: side A x% / side B y%` con x + y = 100. */
const VERDICT_LINE_PATTERN = /Verdict:\s*side\s+A\s+(\d{1,3})%\s*\/\s*side\s+B\s+(\d{1,3})%/;

/**
 * Validador puro de la línea canónica de veredicto. Devuelve los porcentajes
 * si la línea existe y suman 100; si no, `null`. Nunca lanza.
 */
export function extractVerdict(text: unknown): { a: number; b: number } | null {
  if (typeof text !== 'string') return null;
  const match = VERDICT_LINE_PATTERN.exec(text);
  if (match === null) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a < 0 || a > 100 || b < 0 || b > 100 || a + b !== 100) return null;
  return { a, b };
}
