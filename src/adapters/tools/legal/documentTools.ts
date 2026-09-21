/**
 * Suite de herramientas de documentos para el Agente (OpenHer Chat):
 * - `list_case_documents`: Lista los escritos disponibles en el expediente activo.
 * - `read_document`: Lectura selectiva por capítulos o completa con ObservationPack.
 * - `create_case_document`: Creación de nuevo escrito con persistencia en DocumentStudio.
 * - `patch_document_section`: Edición quirúrgica de capítulos con auditoría forense (Action Fusion).
 * - `audit_document`: Diagnóstico forense de completitud y reserva de caso federal.
 * - `read_observation`: Lectura bajo demanda de handles de observaciones compactadas (SoL-Pi).
 */

import {
  createObservationPack,
  formatObservationSummary,
  readObservationSection,
} from '@/domain/agent/observationPack';
import { formatEvidenceDigest, reduceToEvidence } from '@/domain/agent/evidenceReducer';
import { auditDocumentCompleteness, parseDocumentSections } from '@/domain/legal/documentAuditor';
import { getLegalTemplate } from '@/domain/legal/templates';
import type { LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type { ToolErrorCode, ToolResult } from '@/domain/types/chat';
import type { DocumentKind, LegalDocument } from '@/domain/types/legal';
import type { ToolDefinition } from '@/domain/types/tools';

export const LIST_CASE_DOCUMENTS_TOOL_NAME = 'list_case_documents';
export const READ_DOCUMENT_TOOL_NAME = 'read_document';
export const CREATE_CASE_DOCUMENT_TOOL_NAME = 'create_case_document';
export const PATCH_DOCUMENT_SECTION_TOOL_NAME = 'patch_document_section';
export const AUDIT_DOCUMENT_TOOL_NAME = 'audit_document';
export const READ_OBSERVATION_TOOL_NAME = 'read_observation';

export const DOCUMENT_TOOL_TIMEOUT_MS = 15_000;
export const DOCUMENT_TOOL_MAX_RESULT_CHARS = 8_000;

export interface DocumentToolsDeps {
  cases: LegalCaseRepository;
  caseId: string;
  now?: () => number;
}

function successResult(content: string, startedAt: number, endedAt: number): ToolResult {
  return {
    ok: true,
    content,
    durationMs: Math.max(0, endedAt - startedAt),
  };
}

function failureResult(
  message: string,
  code: ToolErrorCode,
  startedAt: number,
  endedAt: number,
): ToolResult {
  return {
    ok: false,
    content: message,
    error: { code, message },
    durationMs: Math.max(0, endedAt - startedAt),
  };
}

/** Crea la lista completa de tools de gestión documental para el agente. */
export function createDocumentTools(deps: DocumentToolsDeps): ToolDefinition[] {
  const now = deps.now ?? Date.now;

  return [
    createListCaseDocumentsTool(deps, now),
    createReadDocumentTool(deps, now),
    createCreateCaseDocumentTool(deps, now),
    createPatchDocumentSectionTool(deps, now),
    createAuditDocumentTool(deps, now),
    createReadObservationTool(now),
  ];
}

function createListCaseDocumentsTool(deps: DocumentToolsDeps, now: () => number): ToolDefinition {
  return {
    name: LIST_CASE_DOCUMENTS_TOOL_NAME,
    description:
      'List all legal briefs, filings, and drafts associated with the active case. Returns IDs, titles, kinds, statuses, and word counts.',
    parameters: {
      type: 'object',
      properties: {},
    },
    timeoutMs: DOCUMENT_TOOL_TIMEOUT_MS,
    maxResultChars: DOCUMENT_TOOL_MAX_RESULT_CHARS,
    execute: async (_args, _context): Promise<ToolResult> => {
      const startTime = now();
      try {
        const docs = await deps.cases.listDocuments(deps.caseId);
        if (docs.length === 0) {
          return successResult(
            `El expediente "${deps.caseId}" no tiene documentos redactados aún. Utilice "create_case_document" para redactar uno.`,
            startTime,
            now(),
          );
        }

        const lines: string[] = [
          `Documentos en el expediente (${docs.length}):`,
          ...docs.map((doc) => {
            const words = doc.markdown.trim().split(/\s+/).filter(Boolean).length;
            const fojas = Math.max(1, Math.round(words / 350));
            const updated = new Date(doc.updatedAt).toISOString().split('T')[0];
            return `- [ID: "${doc.id}"] "${doc.title}" | Tipo: ${doc.kind} | Estado: ${doc.status} | ~${words} palabras (${fojas} fojas) | Actualizado: ${updated}`;
          }),
        ];

        return successResult(lines.join('\n'), startTime, now());
      } catch (err: unknown) {
        return failureResult(
          `Error listando documentos del expediente: ${err instanceof Error ? err.message : String(err)}`,
          'parse_error',
          startTime,
          now(),
        );
      }
    },
  };
}

function createReadDocumentTool(deps: DocumentToolsDeps, now: () => number): ToolDefinition {
  return {
    name: READ_DOCUMENT_TOOL_NAME,
    description:
      'Read an existing case document or a specific chapter/section. Uses ObservationPack or evidence reduction for long briefs to prevent token overflow.',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The unique ID of the document to read.',
        },
        sectionHeading: {
          type: 'string',
          description:
            'Optional chapter heading or keyword (e.g. "Hechos", "Objeto", "Prueba", "Petitorio") to read only that section.',
        },
        mode: {
          type: 'string',
          enum: ['full', 'evidence_only'],
          description:
            'Reading mode. "full" returns the raw section/markdown; "evidence_only" uses SoL-Pi Evidence Reducer to extract facts, dates, and claims.',
        },
      },
      required: ['documentId'],
    },
    timeoutMs: DOCUMENT_TOOL_TIMEOUT_MS,
    maxResultChars: 16_000,
    execute: async (args, _context): Promise<ToolResult> => {
      const startTime = now();
      const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
      const sectionHeading =
        typeof args.sectionHeading === 'string' ? args.sectionHeading.trim().toLowerCase() : '';
      const mode = args.mode === 'evidence_only' ? 'evidence_only' : 'full';

      if (!documentId) {
        return failureResult('Parámetro "documentId" requerido.', 'invalid_args', startTime, now());
      }

      try {
        const docs = await deps.cases.listDocuments(deps.caseId);
        const doc = docs.find((d) => d.id === documentId);
        if (!doc) {
          return failureResult(
            `Documento con ID "${documentId}" no encontrado en este expediente.`,
            'invalid_args',
            startTime,
            now(),
          );
        }

        // Si se pide una sección específica
        if (sectionHeading) {
          const sections = parseDocumentSections(doc.markdown);
          const matched = sections.find(
            (s) =>
              s.heading.toLowerCase().includes(sectionHeading) ||
              s.id.toLowerCase().includes(sectionHeading),
          );

          if (!matched) {
            const available = sections.map((s) => `"${s.heading}"`).join(', ');
            return failureResult(
              `Capítulo "${sectionHeading}" no encontrado en "${doc.title}". Capítulos disponibles: [${available}].`,
              'invalid_args',
              startTime,
              now(),
            );
          }

          const content =
            mode === 'evidence_only'
              ? formatEvidenceDigest(reduceToEvidence(matched.content))
              : `### ${matched.heading}\n\n${matched.content}`;

          return successResult(
            `Capítulo "${matched.heading}" de "${doc.title}":\n\n${content}`,
            startTime,
            now(),
          );
        }

        // Lectura completa
        if (mode === 'evidence_only') {
          const digest = reduceToEvidence(doc.markdown);
          return successResult(
            `Evidencia procesal extraída de "${doc.title}":\n\n${formatEvidenceDigest(digest)}`,
            startTime,
            now(),
          );
        }

        // Si el documento es muy extenso (> 2.500 caracteres), empaquetar con ObservationPack
        if (doc.markdown.length > 2_500) {
          const pack = createObservationPack({
            title: doc.title,
            fullContent: doc.markdown,
          });
          return successResult(formatObservationSummary(pack), startTime, now());
        }

        return successResult(
          `Documento "${doc.title}" (completo):\n\n${doc.markdown}`,
          startTime,
          now(),
        );
      } catch (err: unknown) {
        return failureResult(
          `Error al leer documento: ${err instanceof Error ? err.message : String(err)}`,
          'parse_error',
          startTime,
          now(),
        );
      }
    },
  };
}

function createCreateCaseDocumentTool(deps: DocumentToolsDeps, now: () => number): ToolDefinition {
  return {
    name: CREATE_CASE_DOCUMENT_TOOL_NAME,
    description:
      'Create a new legal brief or document in the active case. It will instantly appear in the user Document Studio.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the brief, e.g. "Demanda por Daños y Perjuicios - Automotor".',
        },
        kind: {
          type: 'string',
          enum: [
            'claim',
            'answer',
            'prior-exceptions',
            'counterclaim',
            'cautelar',
            'evidence',
            'closing',
            'appeal',
            'demand-letter',
            'contract',
            'bylaws',
          ],
          description: 'Kind of procedural document.',
        },
        templateId: {
          type: 'string',
          description:
            'Optional template ID (e.g. "ar-claim-cpccn", "ar-appeal-cpccn", "ar-evidence-cpccn", "ar-answer-cpccn").',
        },
        markdown: {
          type: 'string',
          description: 'The initial markdown content of the draft.',
        },
        status: {
          type: 'string',
          enum: ['draft', 'reviewed', 'final'],
          description: 'Initial draft status. Defaults to "draft".',
        },
      },
      required: ['title', 'kind', 'markdown'],
    },
    timeoutMs: DOCUMENT_TOOL_TIMEOUT_MS,
    maxResultChars: DOCUMENT_TOOL_MAX_RESULT_CHARS,
    execute: async (args, _context): Promise<ToolResult> => {
      const startTime = now();
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const kind = args.kind as DocumentKind;
      const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      const templateId = typeof args.templateId === 'string' ? args.templateId.trim() : null;
      const status = (args.status as 'draft' | 'reviewed' | 'final') || 'draft';

      if (!title || !markdown) {
        return failureResult(
          'Se requieren "title" y "markdown" no vacíos para crear el documento.',
          'invalid_args',
          startTime,
          now(),
        );
      }

      try {
        const id = `doc_${Math.random().toString(36).substring(2, 9)}_${now().toString(36).slice(-4)}`;
        const template = templateId ? getLegalTemplate(templateId) : null;
        const audit = auditDocumentCompleteness(markdown, template);

        const newDoc: LegalDocument = {
          id,
          caseId: deps.caseId,
          kind,
          title,
          templateId,
          markdown,
          status,
          createdAt: now(),
          updatedAt: now(),
        };

        await deps.cases.appendDocument(newDoc);

        const lines = [
          `Documento creado exitosamente en el expediente:`,
          `- ID: "${id}"`,
          `- Título: "${title}"`,
          `- Fojas estimadas: ~${audit.estimatedPages} (${audit.wordCount} palabras)`,
          `- Estado de auditoría: ${audit.status.toUpperCase()}`,
          `- Reserva Caso Federal: ${audit.hasFederalReserve ? 'PRESENTE' : 'AUSENTE'}`,
          `- Petitorio explícito: ${audit.hasPetition ? 'PRESENTE' : 'AUSENTE'}`,
          `- Marcadores pendientes: ${audit.missingPlaceholders.length} [COMPLETAR], ${audit.unverifiedCitationsCount} [VERIFICAR]`,
          '',
          `El escrito ya se encuentra disponible para visualización y edición en el Estudio de Documentos.`,
        ];

        return successResult(lines.join('\n'), startTime, now());
      } catch (err: unknown) {
        return failureResult(
          `Error al crear documento: ${err instanceof Error ? err.message : String(err)}`,
          'parse_error',
          startTime,
          now(),
        );
      }
    },
  };
}

function createPatchDocumentSectionTool(deps: DocumentToolsDeps, now: () => number): ToolDefinition {
  return {
    name: PATCH_DOCUMENT_SECTION_TOOL_NAME,
    description:
      'Action Fusion: Patch, update or append a specific chapter in an existing brief without rewriting the whole 20-page document. Automatically runs forensic audit on the result.',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The unique ID of the document to patch.',
        },
        sectionHeading: {
          type: 'string',
          description:
            'Heading of the chapter to update or create (e.g. "Primer Agravio", "Hechos", "Prueba Pericial").',
        },
        content: {
          type: 'string',
          description: 'The new Markdown text for this chapter.',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'Whether to replace the existing chapter content or append to it. Defaults to "replace".',
        },
      },
      required: ['documentId', 'sectionHeading', 'content'],
    },
    timeoutMs: DOCUMENT_TOOL_TIMEOUT_MS,
    maxResultChars: DOCUMENT_TOOL_MAX_RESULT_CHARS,
    execute: async (args, _context): Promise<ToolResult> => {
      const startTime = now();
      const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
      const sectionHeading = typeof args.sectionHeading === 'string' ? args.sectionHeading.trim() : '';
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      const mode = args.mode === 'append' ? 'append' : 'replace';

      if (!documentId || !sectionHeading || !content) {
        return failureResult(
          'Se requieren "documentId", "sectionHeading" y "content".',
          'invalid_args',
          startTime,
          now(),
        );
      }

      try {
        const docs = await deps.cases.listDocuments(deps.caseId);
        const doc = docs.find((d) => d.id === documentId);
        if (!doc) {
          return failureResult(
            `Documento con ID "${documentId}" no encontrado en este expediente.`,
            'invalid_args',
            startTime,
            now(),
          );
        }

        const sections = parseDocumentSections(doc.markdown);
        const matchIndex = sections.findIndex(
          (s) =>
            s.heading.toLowerCase().includes(sectionHeading.toLowerCase()) ||
            s.id.toLowerCase() === sectionHeading.toLowerCase(),
        );

        const newSections = [...sections];
        if (matchIndex >= 0) {
          const current = sections[matchIndex];
          if (current) {
            const updatedContent =
              mode === 'append' ? `${current.content}\n\n${content}` : content;
            newSections[matchIndex] = {
              ...current,
              content: updatedContent,
              wordCount: updatedContent.split(/\s+/).filter(Boolean).length,
            };
          }
        } else {
          // Agregar nueva sección al final
          newSections.push({
            id: `sec-${sections.length + 1}`,
            heading: sectionHeading,
            wordCount: content.split(/\s+/).filter(Boolean).length,
            content,
            hasPlaceholders: content.includes('[COMPLETAR'),
          });
        }

        // Reensamblar markdown
        const updatedMarkdown = newSections
          .map((s) => {
            if (s.heading === 'Encabezado inicial') return s.content;
            return `## ${s.heading}\n\n${s.content}`;
          })
          .join('\n\n');

        const updatedDoc = await deps.cases.updateDocument(documentId, {
          markdown: updatedMarkdown,
          updatedAt: now(),
        });

        // Auditoría forense instantánea (Action Fusion)
        const template = updatedDoc.templateId ? getLegalTemplate(updatedDoc.templateId) : null;
        const audit = auditDocumentCompleteness(updatedMarkdown, template);

        const lines = [
          `Capítulo "${sectionHeading}" actualizado con éxito en "${updatedDoc.title}" (${mode === 'append' ? 'anexado' : 'reemplazado'}).`,
          '',
          `Auditoría forense resultante:`,
          `- Volumen total: ~${audit.estimatedPages} fojas (${audit.wordCount} palabras)`,
          `- Estado: ${audit.status.toUpperCase()}`,
          `- Reserva Caso Federal: ${audit.hasFederalReserve ? 'PRESENTE' : 'AUSENTE'}`,
          `- Petitorio explícito: ${audit.hasPetition ? 'PRESENTE' : 'AUSENTE'}`,
          `- Marcadores pendientes: ${audit.missingPlaceholders.length} [COMPLETAR], ${audit.unverifiedCitationsCount} [VERIFICAR]`,
        ];

        if (audit.lintReport?.issues && audit.lintReport.issues.length > 0) {
          lines.push('');
          lines.push('Avisos del Linter Jurídico:');
          for (const issue of audit.lintReport.issues.slice(0, 5)) {
            const icon = issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
            lines.push(`${icon} [${issue.rule}] ${issue.message}`);
          }
        }

        return successResult(lines.join('\n'), startTime, now());
      } catch (err: unknown) {
        return failureResult(
          `Error al actualizar capítulo: ${err instanceof Error ? err.message : String(err)}`,
          'parse_error',
          startTime,
          now(),
        );
      }
    },
  };
}

function createAuditDocumentTool(deps: DocumentToolsDeps, now: () => number): ToolDefinition {
  return {
    name: AUDIT_DOCUMENT_TOOL_NAME,
    description:
      'Forensic audit: check estimated pages (fojas), placeholders [COMPLETAR], citations [VERIFICAR], and federal case reserve.',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'ID of an existing case document to audit.',
        },
        markdown: {
          type: 'string',
          description: 'Alternatively, provide raw markdown text to audit directly.',
        },
        templateId: {
          type: 'string',
          description: 'Optional template ID to check checklist compliance.',
        },
      },
    },
    timeoutMs: DOCUMENT_TOOL_TIMEOUT_MS,
    maxResultChars: DOCUMENT_TOOL_MAX_RESULT_CHARS,
    execute: async (args, _context): Promise<ToolResult> => {
      const startTime = now();
      const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
      let textToAudit = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      let templateId = typeof args.templateId === 'string' ? args.templateId.trim() : null;

      if (!textToAudit && documentId) {
        try {
          const docs = await deps.cases.listDocuments(deps.caseId);
          const doc = docs.find((d) => d.id === documentId);
          if (!doc) {
            return failureResult(
              `Documento con ID "${documentId}" no encontrado en este expediente.`,
              'invalid_args',
              startTime,
              now(),
            );
          }
          textToAudit = doc.markdown;
          if (!templateId) templateId = doc.templateId;
        } catch (err: unknown) {
          return failureResult(
            `Error al obtener documento para auditoría: ${err instanceof Error ? err.message : String(err)}`,
            'parse_error',
            startTime,
            now(),
          );
        }
      }

      if (!textToAudit) {
        return failureResult(
          'Se requiere "documentId" o "markdown" para auditar.',
          'invalid_args',
          startTime,
          now(),
        );
      }

      const template = templateId ? getLegalTemplate(templateId) : null;
      const audit = auditDocumentCompleteness(textToAudit, template);

      const lines = [
        `Informe de Auditoría Forense:`,
        `- Estado general: ${audit.status.toUpperCase()}`,
        `- Fojas estimadas: ~${audit.estimatedPages} fojas judiciales (${audit.wordCount} palabras, ${audit.charCount} caracteres)`,
        `- Reserva de Caso Federal (art. 14 Ley 48): ${audit.hasFederalReserve ? 'VERIFICADA' : 'NO DETECTADA (Atención)'}`,
        `- Petitorio en términos claros: ${audit.hasPetition ? 'VERIFICADO' : 'NO DETECTADO (Atención)'}`,
        `- Marcadores sin resolver: ${audit.missingPlaceholders.length} [COMPLETAR], ${audit.unverifiedCitationsCount} [VERIFICAR]`,
      ];

      if (audit.missingPlaceholders.length > 0) {
        lines.push('');
        lines.push('Detalle de marcadores pendientes:');
        for (const p of audit.missingPlaceholders.slice(0, 8)) {
          lines.push(`• ${p}`);
        }
      }

      if (audit.lintReport?.issues && audit.lintReport.issues.length > 0) {
        lines.push('');
        lines.push('Observaciones del Linter Jurídico Procesal:');
        for (const issue of audit.lintReport.issues.slice(0, 6)) {
          const icon = issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
          lines.push(`${icon} [${issue.rule}] ${issue.message}`);
          lines.push(`   Solución procesal: ${issue.remedy}`);
        }
      }

      return successResult(lines.join('\n'), startTime, now());
    },
  };
}

export function createReadObservationTool(now: () => number): ToolDefinition {
  return {
    name: READ_OBSERVATION_TOOL_NAME,
    description:
      'SoL-Pi ObservationPack Reader: Retrieve full text for a specific section from a compacted observation handle, avoiding token waste.',
    parameters: {
      type: 'object',
      properties: {
        handleId: {
          type: 'string',
          description: 'The observation handle ID, e.g. "obs_12345_abc".',
        },
        sectionId: {
          type: 'string',
          description: 'The specific section ID to read (e.g. "sec-1", "sec-2", "intro").',
        },
        offset: {
          type: 'integer',
          description: 'Character offset to start reading from. Defaults to 0.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum characters to read (100 to 10000). Defaults to 4000.',
        },
      },
      required: ['handleId'],
    },
    timeoutMs: DOCUMENT_TOOL_TIMEOUT_MS,
    maxResultChars: 16_000,
    execute: async (args, _context): Promise<ToolResult> => {
      const startTime = now();
      const handleId = typeof args.handleId === 'string' ? args.handleId.trim() : '';
      const sectionId = typeof args.sectionId === 'string' ? args.sectionId.trim() : undefined;
      const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
      const limit = typeof args.limit === 'number' ? Math.min(10_000, Math.max(100, args.limit)) : 4_000;

      if (!handleId) {
        return failureResult('Parámetro "handleId" requerido.', 'invalid_args', startTime, now());
      }

      const res = readObservationSection(handleId, sectionId, offset, limit);
      if (!res.found) {
        return failureResult(
          res.error ?? `Error al leer la observación "${handleId}".`,
          'invalid_args',
          startTime,
          now(),
        );
      }

      return successResult(
        `[Observation: ${handleId} | Sección: ${res.sectionHeading ?? 'completa'}]\n\n${res.text}`,
        startTime,
        now(),
      );
    },
  };
}
