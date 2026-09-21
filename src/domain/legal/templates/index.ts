import type { DocumentKind, LegalTemplate, LegalTemplateChecklistItem } from '../../types/legal';
import { ANSWER_TEMPLATE } from './answer';
import { APPEAL_TEMPLATE } from './appeal';
import { CLAIM_TEMPLATE } from './claim';
import { DEMAND_LETTER_TEMPLATE } from './demandLetter';
import { EVIDENCE_TEMPLATE } from './evidence';

/** Todas las plantillas de documento disponibles, en orden canónico. */
export const LEGAL_TEMPLATES: readonly LegalTemplate[] = [
  CLAIM_TEMPLATE,
  ANSWER_TEMPLATE,
  APPEAL_TEMPLATE,
  EVIDENCE_TEMPLATE,
  DEMAND_LETTER_TEMPLATE,
];

/** Registro por id para búsquedas directas y búsquedas O(1). */
export const LEGAL_TEMPLATES_BY_ID: Readonly<Record<string, LegalTemplate>> = Object.freeze(
  LEGAL_TEMPLATES.reduce<Record<string, LegalTemplate>>((acc, template) => {
    acc[template.id] = template;
    return acc;
  }, {}),
);

/** Registro por tipo de documento; un tipo puede tener varias plantillas. */
export const LEGAL_TEMPLATES_BY_KIND: Readonly<Partial<Record<DocumentKind, readonly LegalTemplate[]>>> = Object.freeze(
  LEGAL_TEMPLATES.reduce<Partial<Record<DocumentKind, LegalTemplate[]>>>((acc, template) => {
    const bucket = acc[template.kind] ?? [];
    bucket.push(template);
    acc[template.kind] = bucket;
    return acc;
  }, {}),
);

/** Devuelve la plantilla registrada con ese id, o `null` si no existe. */
export function getLegalTemplate(id: string): LegalTemplate | null {
  return LEGAL_TEMPLATES_BY_ID[id] ?? null;
}

/** Lista plantillas; con `kind` filtra por tipo de documento. */
export function listTemplates(kind?: DocumentKind): LegalTemplate[] {
  if (kind === undefined) return [...LEGAL_TEMPLATES];
  return [...(LEGAL_TEMPLATES_BY_KIND[kind] ?? [])];
}

/** Checklist procesal de una plantilla; arreglo vacío si el id no existe. */
export function templateChecklist(templateId: string): LegalTemplateChecklistItem[] {
  const template = LEGAL_TEMPLATES_BY_ID[templateId];
  if (template === undefined) return [];
  return [...template.checklist];
}
