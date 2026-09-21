import { describe, expect, it } from 'vitest';
import { createObservationPack } from '@/domain/agent/observationPack';
import type { LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type { LegalDocument } from '@/domain/types/legal';
import type { ToolExecutionContext } from '@/domain/types/tools';
import {
  AUDIT_DOCUMENT_TOOL_NAME,
  CREATE_CASE_DOCUMENT_TOOL_NAME,
  LIST_CASE_DOCUMENTS_TOOL_NAME,
  PATCH_DOCUMENT_SECTION_TOOL_NAME,
  READ_DOCUMENT_TOOL_NAME,
  READ_OBSERVATION_TOOL_NAME,
  createDocumentTools,
} from './documentTools';

function createFakeCaseRepo(initialDocs: LegalDocument[] = []): LegalCaseRepository {
  let docs = [...initialDocs];
  return {
    list: async () => [],
    get: async () => null,
    create: async () => ({} as never),
    update: async () => ({} as never),
    remove: async () => undefined,
    listAnalyses: async () => [],
    appendAnalysis: async () => undefined,
    listDocuments: async (caseId: string) => docs.filter((d) => d.caseId === caseId),
    appendDocument: async (doc: LegalDocument) => {
      docs.push(doc);
    },
    updateDocument: async (id: string, patch: Partial<Omit<LegalDocument, 'id' | 'caseId' | 'createdAt'>>) => {
      const idx = docs.findIndex((d) => d.id === id);
      if (idx === -1) throw new Error('Doc not found');
      const updated = { ...docs[idx]!, ...patch };
      docs[idx] = updated;
      return updated;
    },
    removeDocument: async (id: string) => {
      docs = docs.filter((d) => d.id !== id);
    },
    appendAcknowledgment: async () => undefined,
    listAcknowledgments: async () => [],
    appendGap: async () => undefined,
    listGaps: async () => [],
  };
}

describe('Document Tools for Agent', () => {
  const sampleDoc: LegalDocument = {
    id: 'doc-123',
    caseId: 'case-abc',
    kind: 'claim',
    title: 'Demanda Ordinaria por Daños',
    templateId: 'ar-claim-cpccn',
    markdown: `
## Objeto
Demandar a la parte demandada por $5.000.000.

## Hechos
El día 10 de octubre de 2024 se produjo el siniestro vial en Av. Corrientes...
El demandado conducía a exceso de velocidad conforme acta notarial.

## Prueba
Ofrezco documental y testimonial.

## Petitorio
Tener por promovida la demanda con costas.
`,
    status: 'draft',
    createdAt: 1000,
    updatedAt: 1000,
  };

  const fakeContext: ToolExecutionContext = {
    signal: new AbortController().signal,
    conversationId: 'conv-test',
  };

  it('lista los documentos del expediente activo con list_case_documents', async () => {
    const repo = createFakeCaseRepo([sampleDoc]);
    const tools = createDocumentTools({ cases: repo, caseId: 'case-abc', now: () => 2000 });
    const listTool = tools.find((t) => t.name === LIST_CASE_DOCUMENTS_TOOL_NAME)!;

    const res = await listTool.execute({}, fakeContext);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('Demanda Ordinaria por Daños');
    expect(res.content).toContain('doc-123');
  });

  it('lee un capítulo específico con read_document', async () => {
    const repo = createFakeCaseRepo([sampleDoc]);
    const tools = createDocumentTools({ cases: repo, caseId: 'case-abc', now: () => 2000 });
    const readTool = tools.find((t) => t.name === READ_DOCUMENT_TOOL_NAME)!;

    // Leer solo Hechos
    const res = await readTool.execute(
      { documentId: 'doc-123', sectionHeading: 'Hechos' },
      fakeContext,
    );
    expect(res.ok).toBe(true);
    expect(res.content).toContain('siniestro vial en Av. Corrientes');
    expect(res.content).not.toContain('Demandar a la parte demandada'); // no debe traer Objeto
  });

  it('crea un nuevo documento en el expediente con create_case_document', async () => {
    const repo = createFakeCaseRepo([]);
    const tools = createDocumentTools({ cases: repo, caseId: 'case-abc', now: () => 2000 });
    const createTool = tools.find((t) => t.name === CREATE_CASE_DOCUMENT_TOOL_NAME)!;

    const res = await createTool.execute(
      {
        title: 'Expresión de Agravios',
        kind: 'appeal',
        templateId: 'ar-appeal-cpccn',
        markdown: '## Objeto\nInterponer recurso.\n\n## Petitorio\nRevocar con costas.',
      },
      fakeContext,
    );

    expect(res.ok).toBe(true);
    expect(res.content).toContain('Documento creado exitosamente');
    expect(res.content).toContain('Expresión de Agravios');

    // Verificar en el repo
    const docs = await repo.listDocuments('case-abc');
    expect(docs.length).toBe(1);
    expect(docs[0]?.title).toBe('Expresión de Agravios');
  });

  it('parcha quirúrgicamente un capítulo con patch_document_section (Action Fusion)', async () => {
    const repo = createFakeCaseRepo([sampleDoc]);
    const tools = createDocumentTools({ cases: repo, caseId: 'case-abc', now: () => 2000 });
    const patchTool = tools.find((t) => t.name === PATCH_DOCUMENT_SECTION_TOOL_NAME)!;

    // Actualizar solo el capítulo "Prueba"
    const res = await patchTool.execute(
      {
        documentId: 'doc-123',
        sectionHeading: 'Prueba',
        content: 'Ofrezco pericia médica neurológica y mecánica detallada.',
        mode: 'replace',
      },
      fakeContext,
    );

    expect(res.ok).toBe(true);
    expect(res.content).toContain('actualizado con éxito');
    expect(res.content).toContain('Auditoría forense resultante');

    // Comprobar que el doc se actualizó manteniendo los Hechos intactos
    const docs = await repo.listDocuments('case-abc');
    expect(docs[0]?.markdown).toContain('pericia médica neurológica');
    expect(docs[0]?.markdown).toContain('siniestro vial en Av. Corrientes');
  });

  it('audita un documento con audit_document', async () => {
    const repo = createFakeCaseRepo([sampleDoc]);
    const tools = createDocumentTools({ cases: repo, caseId: 'case-abc', now: () => 2000 });
    const auditTool = tools.find((t) => t.name === AUDIT_DOCUMENT_TOOL_NAME)!;

    const res = await auditTool.execute({ documentId: 'doc-123' }, fakeContext);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('Informe de Auditoría Forense');
    expect(res.content).toContain('Fojas estimadas');
  });

  it('lee observaciones con read_observation', async () => {
    createObservationPack({
      id: 'obs_fixture_1',
      title: 'Dictamen Pericial',
      fullContent: '## Capítulo 1\nDetalle pericial extenso de fs 10.\n\n## Capítulo 2\nConclusión médica.',
    });

    const tools = createDocumentTools({ cases: createFakeCaseRepo(), caseId: 'case-abc' });
    const obsTool = tools.find((t) => t.name === READ_OBSERVATION_TOOL_NAME)!;

    const res = await obsTool.execute(
      { handleId: 'obs_fixture_1', sectionId: 'sec-2' },
      fakeContext,
    );
    expect(res.ok).toBe(true);
    expect(res.content).toContain('Conclusión médica');
  });
});
