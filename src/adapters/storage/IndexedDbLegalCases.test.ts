import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateLegalCaseInput } from '@/domain/ports/LegalCaseRepository';
import type {
  AcknowledgmentRecord,
  CaseAnalysis,
  GapReportEntry,
  LegalDocument,
} from '@/domain/types/legal';
import { IndexedDbLegalCases } from './IndexedDbLegalCases';
import {
  ACKNOWLEDGMENTS_STORE,
  GAPS_STORE,
  LEGAL_ANALYSES_STORE,
  LEGAL_CASES_STORE,
  LEGAL_DOCUMENTS_STORE,
  getDb,
} from './idb';

const CASE_INPUT: CreateLegalCaseInput = {
  title: 'Desalojo',
  jurisdiction: 'caba',
  court: 'JNC Civil 12',
  matter: 'civil',
  clientRole: 'plaintiff',
};

function makeDocument(id: string, caseId: string, createdAt: number): LegalDocument {
  return {
    id,
    caseId,
    kind: 'claim',
    title: `Documento ${id}`,
    templateId: null,
    markdown: `# ${id}`,
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
  };
}

function makeAnalysis(id: string, caseId: string, createdAt: number): CaseAnalysis {
  return {
    id,
    caseId,
    createdAt,
    providerId: 'groq',
    modelId: 'llama',
    packs: [],
    attacks: [],
    defenses: [],
    judgePosture: [],
    risks: [],
    openQuestions: [],
    synthesis: '',
    citations: { verified: 0, unverified: 0 },
    incomplete: false,
    raw: { defense: '', attack: '', judge: '', risk: '' },
  };
}

function makeAcknowledgment(
  id: string,
  caseId: string,
  documentId: string,
  at: number,
): AcknowledgmentRecord {
  return { id, caseId, documentId, at, unverifiedCount: 2, contentHash: 'sha256-x' };
}

function makeGap(id: string, caseId: string, at: number): GapReportEntry {
  return { id, caseId, query: 'consulta sin cobertura', at };
}

describe('IndexedDbLegalCases', () => {
  let nowValue = 0;
  let idCounter = 0;
  let repo: IndexedDbLegalCases;

  beforeEach(async () => {
    nowValue = 0;
    idCounter = 0;
    repo = new IndexedDbLegalCases({
      newId: () => `case-${(idCounter += 1)}`,
      now: () => nowValue,
    });
    const db = await getDb();
    await db.clear(LEGAL_CASES_STORE);
    await db.clear(LEGAL_DOCUMENTS_STORE);
    await db.clear(LEGAL_ANALYSES_STORE);
    await db.clear(ACKNOWLEDGMENTS_STORE);
    await db.clear(GAPS_STORE);
  });

  it('create arranca activo, con colecciones vacías y timestamps inyectados', async () => {
    nowValue = 100;
    const created = await repo.create(CASE_INPUT);
    expect(created).toEqual({
      id: 'case-1',
      title: 'Desalojo',
      status: 'active',
      jurisdiction: 'caba',
      court: 'JNC Civil 12',
      matter: 'civil',
      clientRole: 'plaintiff',
      parties: [],
      facts: [],
      keyDates: [],
      createdAt: 100,
      updatedAt: 100,
    });
    expect(await repo.get(created.id)).toEqual(created);
    expect(await repo.get('missing')).toBeNull();
  });

  it('update preserva id y createdAt y bumpea updatedAt', async () => {
    nowValue = 100;
    const created = await repo.create(CASE_INPUT);
    nowValue = 500;
    const updated = await repo.update(created.id, { title: 'Desalojo (reformulado)', status: 'archived' });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(100);
    expect(updated.updatedAt).toBe(500);
    expect(updated.status).toBe('archived');
    expect(await repo.get(created.id)).toEqual(updated);
  });

  it('update lanza si el caso no existe', async () => {
    await expect(repo.update('missing', { title: 'X' })).rejects.toThrow();
  });

  it('list ordena por (createdAt, id) de forma estable', async () => {
    nowValue = 300;
    const latest = await repo.create({ ...CASE_INPUT, title: 'C' });
    nowValue = 100;
    const first = await repo.create({ ...CASE_INPUT, title: 'A' });
    nowValue = 200;
    const middle = await repo.create({ ...CASE_INPUT, title: 'B' });
    nowValue = 100;
    const second = await repo.create({ ...CASE_INPUT, title: 'A2' });

    expect((await repo.list()).map((legalCase) => legalCase.id)).toEqual([
      first.id,
      second.id,
      middle.id,
      latest.id,
    ]);
  });

  it('persiste y lista documentos y análisis filtrados por caso', async () => {
    const legalCase = await repo.create(CASE_INPUT);
    await repo.appendDocument(makeDocument('d2', legalCase.id, 20));
    await repo.appendDocument(makeDocument('d1', legalCase.id, 10));
    await repo.appendAnalysis(makeAnalysis('a2', legalCase.id, 20));
    await repo.appendAnalysis(makeAnalysis('a1', legalCase.id, 10));

    expect((await repo.listDocuments(legalCase.id)).map((document) => document.id)).toEqual([
      'd1',
      'd2',
    ]);
    expect((await repo.listAnalyses(legalCase.id)).map((analysis) => analysis.id)).toEqual([
      'a1',
      'a2',
    ]);
    expect(await repo.listDocuments('other-case')).toEqual([]);
    expect(await repo.listAnalyses('other-case')).toEqual([]);
  });

  it('updateDocument preserva id/caseId/createdAt y removeDocument borra', async () => {
    const legalCase = await repo.create(CASE_INPUT);
    await repo.appendDocument(makeDocument('d1', legalCase.id, 10));
    nowValue = 99;
    const updated = await repo.updateDocument('d1', { markdown: '# editado', status: 'reviewed' });
    expect(updated.id).toBe('d1');
    expect(updated.caseId).toBe(legalCase.id);
    expect(updated.createdAt).toBe(10);
    expect(updated.updatedAt).toBe(99);
    expect(updated.status).toBe('reviewed');

    await repo.removeDocument('d1');
    expect(await repo.listDocuments(legalCase.id)).toEqual([]);
    await expect(repo.updateDocument('d1', { markdown: 'x' })).rejects.toThrow();
  });

  it('persiste acknowledgments y gaps por caso en orden (at, id)', async () => {
    const legalCase = await repo.create(CASE_INPUT);
    await repo.appendAcknowledgment(makeAcknowledgment('ack-2', legalCase.id, 'd1', 20));
    await repo.appendAcknowledgment(makeAcknowledgment('ack-1', legalCase.id, 'd1', 10));
    await repo.appendGap(makeGap('gap-2', legalCase.id, 30));
    await repo.appendGap(makeGap('gap-1', legalCase.id, 30));

    expect((await repo.listAcknowledgments(legalCase.id)).map((record) => record.id)).toEqual([
      'ack-1',
      'ack-2',
    ]);
    expect((await repo.listGaps(legalCase.id)).map((entry) => entry.id)).toEqual(['gap-1', 'gap-2']);
    expect(await repo.listAcknowledgments('other-case')).toEqual([]);
    expect(await repo.listGaps('other-case')).toEqual([]);
  });

  it('remove borra el caso y sus derivados en cascada sin tocar otros casos', async () => {
    const doomed = await repo.create(CASE_INPUT);
    const survivor = await repo.create(CASE_INPUT);
    await repo.appendDocument(makeDocument('doc-doomed', doomed.id, 1));
    await repo.appendAnalysis(makeAnalysis('analysis-doomed', doomed.id, 1));
    await repo.appendAcknowledgment(makeAcknowledgment('ack-doomed', doomed.id, 'doc-doomed', 1));
    await repo.appendGap(makeGap('gap-doomed', doomed.id, 1));

    await repo.appendDocument(makeDocument('doc-survivor', survivor.id, 1));
    await repo.appendAnalysis(makeAnalysis('analysis-survivor', survivor.id, 1));
    await repo.appendAcknowledgment(makeAcknowledgment('ack-survivor', survivor.id, 'doc-survivor', 1));
    await repo.appendGap(makeGap('gap-survivor', survivor.id, 1));

    await repo.remove(doomed.id);

    expect(await repo.get(doomed.id)).toBeNull();
    expect(await repo.listDocuments(doomed.id)).toEqual([]);
    expect(await repo.listAnalyses(doomed.id)).toEqual([]);
    expect(await repo.listAcknowledgments(doomed.id)).toEqual([]);
    expect(await repo.listGaps(doomed.id)).toEqual([]);

    // Aislamiento: los derivados del caso sobreviviente quedan intactos.
    expect((await repo.listDocuments(survivor.id)).map((document) => document.id)).toEqual([
      'doc-survivor',
    ]);
    expect((await repo.listAnalyses(survivor.id)).map((analysis) => analysis.id)).toEqual([
      'analysis-survivor',
    ]);
    expect((await repo.listAcknowledgments(survivor.id)).map((record) => record.id)).toEqual([
      'ack-survivor',
    ]);
    expect((await repo.listGaps(survivor.id)).map((entry) => entry.id)).toEqual(['gap-survivor']);
    expect(await repo.get(survivor.id)).not.toBeNull();
  });
});
