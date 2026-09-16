import type {
  LegalCase,
  LegalDocument,
  LegalFactCertainty,
  LegalJurisdiction,
  LegalMatter,
  LegalParty,
  LegalPartyRole,
  LegalTemplate,
  LegalTemplateSection,
} from '../types/legal';

/** Marca visible que señala información del expediente faltante en el borrador. */
export const MISSING_DATA_PREFIX = '[COMPLETAR:';

/** Watermark obligatorio de todo borrador legal. */
export const DOCUMENT_WATERMARK = 'ANÁLISIS INTERNO – PRIVILEGIADO – BORRADOR, NO PRESENTABLE';

/** Disclaimer de fuente normativa exigido en toda exportación. */
export const DOCUMENT_SOURCE_DISCLAIMER =
  'Los textos normativos son referenciales; el texto auténtico es el publicado en el Boletín Oficial.';

const JURISDICTION_LABELS: Record<LegalJurisdiction, string> = {
  national: 'Nacional',
  caba: 'Ciudad Autónoma de Buenos Aires',
  pba: 'Provincia de Buenos Aires',
  cordoba: 'Provincia de Córdoba',
  tucuman: 'Provincia de Tucumán',
};

const MATTER_LABELS: Record<LegalMatter, string> = {
  civil: 'Civil',
  commercial: 'Comercial',
  'civil-commercial': 'Civil y comercial',
};

const PARTY_ROLE_LABELS: Record<LegalPartyRole, string> = {
  plaintiff: 'Demandante',
  defendant: 'Demandado',
  'third-party': 'Tercero',
};

const CERTAINTY_LABELS: Record<LegalFactCertainty, string> = {
  certain: 'cierto',
  probable: 'probable',
  doubtful: 'dudoso',
  unknown: 'desconocido',
};

export interface RenderTemplateInput {
  case: LegalCase;
  extra?: string;
}

interface Miss {
  value: null;
  missing: string;
}

interface Hit {
  value: string;
  missing: string;
}

type SlotResolution = Hit | Miss;

/** Renderiza un esqueleto Markdown de la plantilla resolviendo los slots del caso. */
export function renderTemplate(template: LegalTemplate, data: RenderTemplateInput): string {
  const lines: string[] = [];
  lines.push(`# ${template.title}`);
  lines.push('');
  lines.push(`> Plantilla: \`${template.id}\` · Tipo: \`${template.kind}\``);
  if (template.jurisdictions.length > 0) {
    const jurisdictions = template.jurisdictions.map((jurisdiction) => JURISDICTION_LABELS[jurisdiction]).join(', ');
    lines.push(`> Jurisdicciones: ${jurisdictions}`);
  }
  lines.push('');

  for (const section of template.sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');
    lines.push(renderSection(section, data));
    lines.push('');
  }

  lines.push('## Checklist procesal');
  lines.push('');
  for (const item of template.checklist) {
    lines.push(`- [ ] ${item.label} (${item.normRef})`);
  }

  return lines.join('\n');
}

export interface BuildDocumentDraftInput {
  id: string;
  case: LegalCase;
  template: LegalTemplate;
  now: number;
  title?: string;
  extra?: string;
}

/** Construye el borrador persistible a partir de la plantilla y el expediente. */
export function buildDocumentDraft(input: BuildDocumentDraftInput): LegalDocument {
  const title = input.title !== undefined && input.title.trim().length > 0 ? input.title : input.template.title;
  return {
    id: input.id,
    caseId: input.case.id,
    kind: input.template.kind,
    title,
    templateId: input.template.id,
    markdown: renderTemplate(input.template, { case: input.case, extra: input.extra }),
    status: 'draft',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface DocumentRenderOptions {
  /** Fuerza el watermark (los borradores ya lo llevan por defecto). */
  watermark?: boolean;
}

/**
 * Serializa el documento a Markdown con los avisos no descartables.
 * El watermark se impone a todo documento que no esté finalizado y a todo
 * documento marcado explícitamente; no existe opción para quitarlo.
 * El disclaimer de fuente se incluye siempre.
 */
export function documentToMarkdown(document: LegalDocument, options?: DocumentRenderOptions): string {
  const watermarked = document.status !== 'final' || options?.watermark === true;

  const blocks: string[] = [];
  if (watermarked) {
    blocks.push(`> ${DOCUMENT_WATERMARK}`);
    blocks.push('');
  }
  blocks.push(`# ${document.title}`);
  blocks.push('');
  blocks.push(document.markdown);
  blocks.push('');
  blocks.push('---');
  blocks.push('');
  blocks.push(`> ${DOCUMENT_SOURCE_DISCLAIMER}`);
  return blocks.join('\n');
}

function renderSection(section: LegalTemplateSection, data: RenderTemplateInput): string {
  if (section.slots.length === 0) {
    return `${MISSING_DATA_PREFIX} ${section.guidance}]`;
  }

  const parts: string[] = [];
  for (const slot of section.slots) {
    const resolution = resolveSlot(slot, data);
    parts.push(resolution.value !== null ? resolution.value : `${MISSING_DATA_PREFIX} ${resolution.missing}]`);
  }
  return parts.join('\n\n');
}

function resolveSlot(slot: string, data: RenderTemplateInput): SlotResolution {
  const legalCase = data.case;
  switch (slot) {
    case 'case.title':
      return fromText(legalCase.title, 'título del expediente');
    case 'case.court':
      return fromText(legalCase.court, 'juzgado y competencia');
    case 'case.jurisdiction':
      return present(`Jurisdicción: ${JURISDICTION_LABELS[legalCase.jurisdiction]}`);
    case 'case.matter':
      return present(`Materia: ${MATTER_LABELS[legalCase.matter]}`);
    case 'case.clientRole':
      return present(`Carácter del cliente: ${PARTY_ROLE_LABELS[legalCase.clientRole]}`);
    case 'parties.plaintiff':
      return fromParties(legalCase.parties, 'plaintiff', 'nombre y domicilio del demandante');
    case 'parties.defendant':
      return fromParties(legalCase.parties, 'defendant', 'nombre y domicilio del demandado');
    case 'parties.all':
      return fromParties(legalCase.parties, null, 'partes intervinientes');
    case 'facts':
      return fromFacts(legalCase);
    case 'keyDates':
      return fromKeyDates(legalCase);
    case 'extra':
      return fromText(data.extra, 'datos adicionales');
    default:
      return { value: null, missing: `dato no soportado (${slot})` };
  }
}

function present(value: string): Hit {
  return { value, missing: '' };
}

function fromText(value: string | undefined, missing: string): SlotResolution {
  const text = (value ?? '').trim();
  return text.length > 0 ? { value: text, missing } : { value: null, missing };
}

function fromParties(parties: LegalParty[], role: LegalPartyRole | null, missing: string): SlotResolution {
  const selected = role === null ? parties : parties.filter((party) => party.role === role);
  if (selected.length === 0) return { value: null, missing };

  const lines = selected.map((party) => {
    const fields = [`${PARTY_ROLE_LABELS[party.role]}: ${party.name}`];
    const address = (party.address ?? '').trim();
    fields.push(address.length > 0 ? `Domicilio: ${address}` : `${MISSING_DATA_PREFIX} domicilio]`);
    if (party.representative !== undefined && party.representative.trim().length > 0) {
      fields.push(`Representante: ${party.representative}`);
    }
    return `- ${fields.join(' — ')}`;
  });
  return { value: lines.join('\n'), missing };
}

function fromFacts(legalCase: LegalCase): SlotResolution {
  if (legalCase.facts.length === 0) return { value: null, missing: 'hechos del expediente' };

  const lines = legalCase.facts.map((fact) => {
    const date = (fact.date ?? '').trim();
    const when = date.length > 0 ? ` (${date})` : '';
    return `- ${fact.statement}${when} [${CERTAINTY_LABELS[fact.certainty]}]`;
  });
  return { value: lines.join('\n'), missing: 'hechos del expediente' };
}

function fromKeyDates(legalCase: LegalCase): SlotResolution {
  if (legalCase.keyDates.length === 0) return { value: null, missing: 'fechas relevantes del expediente' };

  const lines = legalCase.keyDates.map((keyDate) => `- ${keyDate.label}: ${keyDate.date}`);
  return { value: lines.join('\n'), missing: 'fechas relevantes del expediente' };
}
