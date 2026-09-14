import type { LegalCase, LegalParty } from '../types/legal';

// ---------------------------------------------------------------------------
// Pseudonimización conservadora del expediente.
//
// Solo regex sobre identificadores + reemplazo de los nombres y domicilios
// ESTRUCTURADOS del caso. PROHIBIDO intentar NER libre: los falsos negativos
// de un modelo serían peligrosos y no auditables. El mapping es local y este
// módulo NO lo serializa ni lo persiste en ningún lado.
//
// Límites conocidos (falsos negativos posibles):
//   - Nombres o domicilios que aparezcan con grafía distinta a la del caso.
//   - Personas o direcciones mencionadas en texto libre que no estén en el
//     expediente (no hay NER).
//   - Identificadores con formatos no previstos por las regex.
// ---------------------------------------------------------------------------

/** Categoría de dato pseudonimizado; define el prefijo del token. */
export type RedactionKind = 'person' | 'doc' | 'cuit' | 'email' | 'phone' | 'cbu' | 'address';

/** Par token↔valor original. */
export interface RedactionEntry {
  token: string;
  value: string;
  kind: RedactionKind;
}

/** Mapping local token→valor; nunca se serializa desde este módulo. */
export interface RedactionMapping {
  entries: RedactionEntry[];
}

/** Contenido mínimo del expediente que se pseudonimiza. */
export type RedactableCase = Pick<LegalCase, 'parties' | 'facts'>;

export interface RedactCaseContentInput {
  case: RedactableCase;
  /** Texto adicional (notas, borradores) que también se redacta. */
  extraText?: string;
}

const TOKEN_PREFIX: Record<RedactionKind, string> = {
  person: 'PERSONA',
  doc: 'DOC',
  cuit: 'CUIT',
  email: 'EMAIL',
  phone: 'TEL',
  cbu: 'CBU',
  address: 'DOM',
};

const TOKEN_RE = /\[[A-Z]+-\d+\]/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex de frase completa: no toca al valor si está pegado a letras/números. */
function phraseRegex(value: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escapeRegExp(value)})(?![\\p{L}\\p{N}])`, 'giu');
}

interface MappingBuilder {
  entries: RedactionEntry[];
  tokenFor(kind: RedactionKind, value: string): string;
}

function createMappingBuilder(): MappingBuilder {
  const entries: RedactionEntry[] = [];
  const byKind = new Map<RedactionKind, Map<string, string>>();
  return {
    entries,
    tokenFor(kind, value) {
      let values = byKind.get(kind);
      if (!values) {
        values = new Map<string, string>();
        byKind.set(kind, values);
      }
      const existing = values.get(value);
      if (existing) return existing;
      const token = `[${TOKEN_PREFIX[kind]}-${values.size + 1}]`;
      values.set(value, token);
      entries.push({ token, value, kind });
      return token;
    },
  };
}

function replaceWithToken(
  text: string,
  regex: RegExp,
  kind: RedactionKind,
  builder: MappingBuilder,
): string {
  return text.replace(regex, (match) => builder.tokenFor(kind, match));
}

function replaceStructured(
  text: string,
  values: string[],
  kind: RedactionKind,
  builder: MappingBuilder,
): string {
  const unique = [...new Set(values.filter((value) => value.trim().length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let result = text;
  for (const value of unique) {
    result = replaceWithToken(result, phraseRegex(value), kind, builder);
  }
  return result;
}

function partyAddresses(parties: LegalParty[]): string[] {
  const addresses: string[] = [];
  for (const party of parties) {
    if (party.address) addresses.push(party.address);
  }
  return addresses;
}

function partyNames(parties: LegalParty[]): string[] {
  const names: string[] = [];
  for (const party of parties) {
    names.push(party.name);
    if (party.representative) names.push(party.representative);
  }
  return names;
}

// Identificadores. Se aplican en orden: CBU (22 dígitos) antes que CUIT y DNI
// para que un número largo no se parta; CUIT antes que DNI por la misma razón.
const CBU_RE = /(?<!\d)\d{22}(?!\d)/g;
const ALIAS_RE = /(?<![\p{L}\p{N}])alias\s*:?\s*[A-Za-z0-9._-]{6,30}(?![\p{L}\p{N}])/giu;
const CUIT_RE = /(?<!\d)(?:20|23|24|27|30|33|34)[\s.-]?\d{8}[\s.-]?\d(?!\d)/g;
const DNI_RE = /(?<![\d.])\d{1,2}\.?\d{3}\.?\d{3}(?![\d.])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE =
  /(?<!\d)(?:\+?54[\s.-]?)?(?:9[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)/g;

function redactIdentifiers(text: string, builder: MappingBuilder): string {
  let result = replaceWithToken(text, CBU_RE, 'cbu', builder);
  result = replaceWithToken(result, ALIAS_RE, 'cbu', builder);
  result = replaceWithToken(result, CUIT_RE, 'cuit', builder);
  result = replaceWithToken(result, DNI_RE, 'doc', builder);
  result = replaceWithToken(result, EMAIL_RE, 'email', builder);
  result = replaceWithToken(result, PHONE_RE, 'phone', builder);
  return result;
}

/** Serializa el expediente a texto plano, sin pseudonimizar. */
export function composeCaseContent(input: RedactCaseContentInput): string {
  const lines: string[] = [];
  for (const party of input.case.parties) {
    const fields = [party.name];
    if (party.taxId) fields.push(`doc: ${party.taxId}`);
    if (party.address) fields.push(`domicilio: ${party.address}`);
    if (party.representative) fields.push(`representante: ${party.representative}`);
    lines.push(fields.join(' — '));
  }
  for (const fact of input.case.facts) {
    lines.push(fact.date ? `${fact.date} ${fact.statement}` : fact.statement);
  }
  if (input.extraText) lines.push(input.extraText);
  return lines.join('\n');
}

/**
 * Pseudonimiza el expediente (partes + hechos + `extraText`).
 * Devuelve el texto redactado y el mapping local para `deanonymize`.
 */
export function redactCaseContent(input: RedactCaseContentInput): {
  text: string;
  mapping: RedactionMapping;
} {
  const builder = createMappingBuilder();
  let text = composeCaseContent(input);
  // Domicilios primero: pueden contener números que las regex tomarían como
  // identificadores y partirían el domicilio, dejándolo sin redactar.
  text = replaceStructured(text, partyAddresses(input.case.parties), 'address', builder);
  text = redactIdentifiers(text, builder);
  // Nombres al final: así un nombre dentro de un email ya tokenizado no escapa.
  text = replaceStructured(text, partyNames(input.case.parties), 'person', builder);
  return { text, mapping: { entries: builder.entries } };
}

/**
 * Pseudonimiza el expediente completo manteniendo su forma (`LegalCase`).
 * Reutiliza la misma maquinaria que `redactCaseContent` (domicilios
 * estructurados → identificadores por regex → nombres estructurados) con un
 * único builder compartido, de modo que un mismo valor recibe el mismo token
 * en todos los campos.
 *
 * Campos con tokens: `title`, `court` (solo si menciona un nombre o un
 * identificador conocido; el nombre genérico del juzgado pasa intacto),
 * `parties[].name/address/taxId/representative`, `facts[].statement` y
 * `keyDates[].label`.
 *
 * NUNCA se tocan: `id` (de caso, partes, hechos y fechas), fechas ISO
 * (`facts[].date`, `keyDates[].date`), `jurisdiction`, `matter`, `status`,
 * `clientRole`, `certainty`, `createdAt`, `updatedAt` ni `consent`.
 * Esos campos viajan igual que antes y sostienen el ruteo del brief.
 */
export function redactLegalCase(legalCase: LegalCase): {
  redacted: LegalCase;
  mapping: RedactionMapping;
} {
  const builder = createMappingBuilder();
  const addresses = partyAddresses(legalCase.parties);
  const names = partyNames(legalCase.parties);
  const redactField = (text: string): string => {
    // Mismo orden que `redactCaseContent`: domicilios antes que identificadores
    // (pueden contener números) y nombres al final (pueden vivir en un email).
    let result = replaceStructured(text, addresses, 'address', builder);
    result = redactIdentifiers(result, builder);
    result = replaceStructured(result, names, 'person', builder);
    return result;
  };
  const redactOptional = (value: string | undefined): string | undefined => {
    if (value === undefined || value.trim().length === 0) return value;
    return redactField(value);
  };
  const redacted: LegalCase = {
    ...legalCase,
    title: redactField(legalCase.title),
    court: redactField(legalCase.court),
    parties: legalCase.parties.map((party) => ({
      ...party,
      name: redactField(party.name),
      address: redactOptional(party.address),
      taxId: redactOptional(party.taxId),
      representative: redactOptional(party.representative),
    })),
    facts: legalCase.facts.map((fact) => ({ ...fact, statement: redactField(fact.statement) })),
    keyDates: legalCase.keyDates.map((keyDate) => ({ ...keyDate, label: redactField(keyDate.label) })),
  };
  return { redacted, mapping: { entries: builder.entries } };
}

/** Restaura el texto redactado usando el mapping local (round-trip exacto). */
export function deanonymize(text: string, mapping: RedactionMapping): string {
  if (mapping.entries.length === 0) return text;
  const byToken = new Map<string, string>();
  for (const entry of mapping.entries) {
    byToken.set(entry.token, entry.value);
  }
  return text.replace(TOKEN_RE, (match) => byToken.get(match) ?? match);
}
