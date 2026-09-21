import type { LegalCase, LegalTemplate } from '../types/legal';
import { MISSING_DATA_PREFIX } from './document';
import {
  type LegalLintReport,
  type LintIssue,
  formatLegalLintReport,
  lintLegalDocument,
} from './legalLinter';

export {
  type LegalLintReport,
  type LintIssue,
  formatLegalLintReport,
  lintLegalDocument,
};

export type DocumentAuditStatus = 'ready' | 'warning' | 'incomplete';

export interface DocumentSectionInfo {
  id: string;
  heading: string;
  content: string;
  wordCount: number;
  hasPlaceholders: boolean;
}

export interface DocumentAuditResult {
  status: DocumentAuditStatus;
  wordCount: number;
  charCount: number;
  estimatedPages: number;
  missingPlaceholders: string[];
  unverifiedCitationsCount: number;
  hasFederalReserve: boolean;
  hasPetition: boolean;
  hasFacts: boolean;
  sections: DocumentSectionInfo[];
  derogatedCitations?: string[];
  lintReport?: LegalLintReport;
}

/** Aproximación canónica de palabras por foja o página judicial argentina (doble faz / espaciado 1.5). */
export const WORDS_PER_JUDICIAL_PAGE = 350;

/** Audita la completitud procesal, métricas y posibles omisiones del borrador. */
export function auditDocumentCompleteness(
  markdown: string,
  template?: LegalTemplate | null,
): DocumentAuditResult {
  const text = markdown.trim();

  // Ejecución del Linter Jurídico Forense integral
  const lint = lintLegalDocument(markdown, template?.kind);

  const wordCount = lint.metrics.wordCount;
  const charCount = lint.metrics.charCount;
  const estimatedPages = lint.metrics.estimatedPages;
  const missingPlaceholders = lint.missingPlaceholders;

  // Conteo de citas dudosas no confirmadas
  const unverifiedRegex = /\[VERIFICAR\]/gi;
  const unverifiedMatches = text.match(unverifiedRegex);
  const unverifiedCitationsCount = unverifiedMatches?.length ?? 0;

  const hasFederalReserve = lint.checks.hasFederalReserve;
  const hasPetition = lint.checks.hasPetition;
  const hasFacts = lint.checks.hasFacts;

  // Parseo de secciones según encabezados Markdown
  const sections = parseDocumentSections(markdown);

  // Determinación del semáforo
  let status: DocumentAuditStatus = 'ready';
  if (!lint.isAdmissible || missingPlaceholders.length > 0 || !hasPetition) {
    status = 'incomplete';
  } else if (
    unverifiedCitationsCount > 0 ||
    !hasFederalReserve ||
    lint.checks.hasDerogatedCitations
  ) {
    status = 'warning';
  }

  return {
    status,
    wordCount,
    charCount,
    estimatedPages,
    missingPlaceholders,
    unverifiedCitationsCount,
    hasFederalReserve,
    hasPetition,
    hasFacts,
    sections,
    derogatedCitations: lint.derogatedCitations,
    lintReport: lint,
  };
}

/** Descompone el documento en secciones basadas en encabezados Markdown (`## ` o `# `). */
export function parseDocumentSections(markdown: string): DocumentSectionInfo[] {
  const lines = markdown.split('\n');
  const sections: DocumentSectionInfo[] = [];

  let currentHeading = 'Encabezado inicial';
  let currentId = 'section-0';
  let currentLines: string[] = [];
  let sectionIndex = 0;

  for (const line of lines) {
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch !== null && currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      const words = content === '' ? [] : content.split(/\s+/).filter((w) => w.length > 0);
      sections.push({
        id: currentId,
        heading: currentHeading,
        content,
        wordCount: words.length,
        hasPlaceholders: content.includes(MISSING_DATA_PREFIX),
      });

      sectionIndex += 1;
      currentId = `section-${sectionIndex}`;
      currentHeading = headingMatch[2]?.trim() ?? `Sección ${sectionIndex}`;
      currentLines = [];
    } else if (headingMatch !== null) {
      currentHeading = headingMatch[2]?.trim() ?? `Sección ${sectionIndex}`;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 || sections.length === 0) {
    const content = currentLines.join('\n').trim();
    const words = content === '' ? [] : content.split(/\s+/).filter((w) => w.length > 0);
    sections.push({
      id: currentId,
      heading: currentHeading,
      content,
      wordCount: words.length,
      hasPlaceholders: content.includes(MISSING_DATA_PREFIX),
    });
  }

  return sections;
}

export interface SectionPromptInput {
  caseData: LegalCase;
  sectionHeading: string;
  templateTitle: string;
  guidance?: string;
  existingContent?: string;
}

/**
 * Genera una instrucción estructurada con directivas anti-pereza para solicitar al
 * agente que redacte o profundice un capítulo específico sin truncamiento.
 */
export function buildSectionDraftingPrompt(input: SectionPromptInput): string {
  const lines: string[] = [];
  lines.push(
    `Sos el letrado redactor especializado en derecho procesal argentino para el expediente "${input.caseData.title}".`,
  );
  lines.push(
    `Tu tarea es redactar en detalle exhaustivo el capítulo "${input.sectionHeading}" del escrito "${input.templateTitle}".`,
  );
  lines.push('');

  if (input.guidance !== undefined && input.guidance.trim().length > 0) {
    lines.push(`Directiva particular de este capítulo: ${input.guidance}`);
    lines.push('');
  }

  lines.push('REGLAS ESTRICTAS DE REDACCIÓN COMPLETA (ANTI-TRUNCAMIENTO):');
  lines.push('- NO resumas, NO abrevies y NO dejes oraciones a la mitad.');
  lines.push('- NO uses placeholders genéricos tipo "[COMPLETAR]"; desarrollá cada circunstancia.');
  lines.push('- Mantené la fundamentación dogmática completa y citas normativas rigurosas (marcá [VERIFICAR] si una cita no consta en el índice).');
  lines.push('- Si se trata de hechos, narrá minuciosamente las circunstancias de tiempo, modo y lugar.');
  lines.push('- Si se trata de prueba o pericias, formulá cada punto de pericia o pregunta de interrogatorio de forma individual y detallada.');
  lines.push('- Entregá únicamente el texto redactado del capítulo en formato Markdown.');

  if (input.existingContent !== undefined && input.existingContent.trim().length > 0) {
    lines.push('');
    lines.push('Borrador previo a expandir o perfeccionar:');
    lines.push('```markdown');
    lines.push(input.existingContent.trim());
    lines.push('```');
  }

  return lines.join('\n');
}
