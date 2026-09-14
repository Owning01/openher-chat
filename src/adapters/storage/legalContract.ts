import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateLegalCaseInput, LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type { LegalPackStore } from '@/domain/ports/LegalPackStore';
import type {
  AcknowledgmentRecord,
  CaseAnalysis,
  GapReportEntry,
  LegalDocument,
  LegalPack,
} from '@/domain/types/legal';

export interface LegalRepositoryHarness {
  readonly cases: LegalCaseRepository;
  readonly packs: LegalPackStore;
  setNow(value: number): void;
  reset(): Promise<void>;
}

export type LegalRepositoryHarnessFactory = () =>
  | LegalRepositoryHarness
  | Promise<LegalRepositoryHarness>;

/** Suite compartida entre los repos reales (`IndexedDbLegal*`) y los fakes en memoria para garantizar paridad. */
export function describeLegalRepositoryContract(
  name: string,
  createHarness: LegalRepositoryHarnessFactory,
): void {
  describe(name, () => {
    let harness: LegalRepositoryHarness;

    beforeEach(async () => {
      harness = await createHarness();
      await harness.reset();
    });

    it('create arranca activo, con colecciones vacías y timestamps inyectados', async () => {
      harness.setNow(100);
      const created = await harness.cases.create(CASE_INPUT);
      expect(created).toEqual({
        id: created.id,
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
      expect(await harness.cases.get(created.id)).toEqual(created);
      expect(await harness.cases.listDocuments(created.id)).toEqual([]);
      expect(await harness.cases.listAnalyses(created.id)).toEqual([]);
      expect(await harness.cases.listAcknowledgments(created.id)).toEqual([]);
      expect(await harness.cases.listGaps(created.id)).toEqual([]);
    });

    it('get devuelve null para un id inexistente', async () => {
      expect(await harness.cases.get('missing')).toBeNull();
    });

    it('update preserva id y createdAt y bumpea updatedAt', async () => {
      harness.setNow(100);
      const created = await harness.cases.create(CASE_INPUT);
      harness.setNow(500);
      const updated = await harness.cases.update(created.id, {
        title: 'Desalojo (reformulado)',
        status: 'archived',
      });
      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(100);
      expect(updated.updatedAt).toBe(500);
      expect(updated.status).toBe('archived');
      expect(await harness.cases.get(created.id)).toEqual(updated);
    });

    it('update lanza si el caso no existe', async () => {
      await expect(harness.cases.update('missing', { title: 'X' })).rejects.toThrow();
    });

    it('list ordena por (createdAt, id) de forma estable', async () => {
      harness.setNow(300);
      const latest = await harness.cases.create({ ...CASE_INPUT, title: 'C' });
      harness.setNow(100);
      const first = await harness.cases.create({ ...CASE_INPUT, title: 'A' });
      harness.setNow(200);
      const middle = await harness.cases.create({ ...CASE_INPUT, title: 'B' });
      harness.setNow(100);
      const second = await harness.cases.create({ ...CASE_INPUT, title: 'A2' });

      const [earlyA, earlyB] = [first.id, second.id].sort();
      expect((await harness.cases.list()).map((legalCase) => legalCase.id)).toEqual([
        earlyA,
        earlyB,
        middle.id,
        latest.id,
      ]);
    });

    it('persiste y lista documentos y análisis filtrados por caso y ordenados', async () => {
      const legalCase = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendDocument(makeDocument('d2', legalCase.id, 20));
      await harness.cases.appendDocument(makeDocument('d1', legalCase.id, 10));
      await harness.cases.appendAnalysis(makeAnalysis('a2', legalCase.id, 20));
      await harness.cases.appendAnalysis(makeAnalysis('a1', legalCase.id, 10));

      expect((await harness.cases.listDocuments(legalCase.id)).map((document) => document.id)).toEqual([
        'd1',
        'd2',
      ]);
      expect((await harness.cases.listAnalyses(legalCase.id)).map((analysis) => analysis.id)).toEqual([
        'a1',
        'a2',
      ]);
      expect(await harness.cases.listDocuments('other-case')).toEqual([]);
      expect(await harness.cases.listAnalyses('other-case')).toEqual([]);
    });

    it('listDocuments desempata por id cuando createdAt coincide', async () => {
      const legalCase = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendDocument(makeDocument('d2', legalCase.id, 10));
      await harness.cases.appendDocument(makeDocument('d3', legalCase.id, 10));
      await harness.cases.appendDocument(makeDocument('d1', legalCase.id, 10));
      expect((await harness.cases.listDocuments(legalCase.id)).map((document) => document.id)).toEqual([
        'd1',
        'd2',
        'd3',
      ]);
    });

    it('updateDocument preserva id/caseId/createdAt y bumpea updatedAt', async () => {
      const legalCase = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendDocument(makeDocument('d1', legalCase.id, 10));
      harness.setNow(99);
      const updated = await harness.cases.updateDocument('d1', {
        markdown: '# editado',
        status: 'reviewed',
      });
      expect(updated.id).toBe('d1');
      expect(updated.caseId).toBe(legalCase.id);
      expect(updated.createdAt).toBe(10);
      expect(updated.updatedAt).toBe(99);
      expect(updated.status).toBe('reviewed');
      expect((await harness.cases.listDocuments(legalCase.id))[0]).toEqual(updated);
    });

    it('updateDocument lanza si el documento no existe', async () => {
      await expect(harness.cases.updateDocument('missing', { markdown: 'x' })).rejects.toThrow();
    });

    it('removeDocument borra solo ese documento y es no-op si no existe', async () => {
      const legalCase = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendDocument(makeDocument('d1', legalCase.id, 10));
      await harness.cases.appendDocument(makeDocument('d2', legalCase.id, 20));
      await harness.cases.removeDocument('d1');
      expect((await harness.cases.listDocuments(legalCase.id)).map((document) => document.id)).toEqual([
        'd2',
      ]);
      await harness.cases.removeDocument('missing');
      expect((await harness.cases.listDocuments(legalCase.id)).map((document) => document.id)).toEqual([
        'd2',
      ]);
    });

    it('append con un id repetido reemplaza el registro (upsert)', async () => {
      const legalCase = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendDocument(makeDocument('d1', legalCase.id, 10));
      await harness.cases.appendDocument({
        ...makeDocument('d1', legalCase.id, 10),
        markdown: '# editado',
      });
      const documents = await harness.cases.listDocuments(legalCase.id);
      expect(documents).toHaveLength(1);
      expect(documents[0]?.markdown).toBe('# editado');

      await harness.cases.appendAnalysis(makeAnalysis('a1', legalCase.id, 10));
      await harness.cases.appendAnalysis({
        ...makeAnalysis('a1', legalCase.id, 10),
        synthesis: 'síntesis consolidada',
      });
      const analyses = await harness.cases.listAnalyses(legalCase.id);
      expect(analyses).toHaveLength(1);
      expect(analyses[0]?.synthesis).toBe('síntesis consolidada');
    });

    it('persiste acknowledgments y gaps por caso en orden (at, id)', async () => {
      const legalCase = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendAcknowledgment(makeAcknowledgment('ack-2', legalCase.id, 'd1', 20));
      await harness.cases.appendAcknowledgment(makeAcknowledgment('ack-1', legalCase.id, 'd1', 10));
      await harness.cases.appendGap(makeGap('gap-2', legalCase.id, 30));
      await harness.cases.appendGap(makeGap('gap-1', legalCase.id, 30));

      expect(
        (await harness.cases.listAcknowledgments(legalCase.id)).map((record) => record.id),
      ).toEqual(['ack-1', 'ack-2']);
      expect((await harness.cases.listGaps(legalCase.id)).map((entry) => entry.id)).toEqual([
        'gap-1',
        'gap-2',
      ]);
      expect(await harness.cases.listAcknowledgments('other-case')).toEqual([]);
      expect(await harness.cases.listGaps('other-case')).toEqual([]);
    });

    it('remove borra el caso y sus derivados en cascada sin tocar otros casos', async () => {
      const doomed = await harness.cases.create(CASE_INPUT);
      const survivor = await harness.cases.create(CASE_INPUT);
      await harness.cases.appendDocument(makeDocument('doc-doomed', doomed.id, 1));
      await harness.cases.appendAnalysis(makeAnalysis('analysis-doomed', doomed.id, 1));
      await harness.cases.appendAcknowledgment(
        makeAcknowledgment('ack-doomed', doomed.id, 'doc-doomed', 1),
      );
      await harness.cases.appendGap(makeGap('gap-doomed', doomed.id, 1));

      await harness.cases.appendDocument(makeDocument('doc-survivor', survivor.id, 1));
      await harness.cases.appendAnalysis(makeAnalysis('analysis-survivor', survivor.id, 1));
      await harness.cases.appendAcknowledgment(
        makeAcknowledgment('ack-survivor', survivor.id, 'doc-survivor', 1),
      );
      await harness.cases.appendGap(makeGap('gap-survivor', survivor.id, 1));

      await harness.cases.remove(doomed.id);

      expect(await harness.cases.get(doomed.id)).toBeNull();
      expect(await harness.cases.listDocuments(doomed.id)).toEqual([]);
      expect(await harness.cases.listAnalyses(doomed.id)).toEqual([]);
      expect(await harness.cases.listAcknowledgments(doomed.id)).toEqual([]);
      expect(await harness.cases.listGaps(doomed.id)).toEqual([]);

      // Aislamiento: los derivados del caso sobreviviente quedan intactos.
      expect((await harness.cases.listDocuments(survivor.id)).map((document) => document.id)).toEqual([
        'doc-survivor',
      ]);
      expect((await harness.cases.listAnalyses(survivor.id)).map((analysis) => analysis.id)).toEqual([
        'analysis-survivor',
      ]);
      expect(
        (await harness.cases.listAcknowledgments(survivor.id)).map((record) => record.id),
      ).toEqual(['ack-survivor']);
      expect((await harness.cases.listGaps(survivor.id)).map((entry) => entry.id)).toEqual([
        'gap-survivor',
      ]);
      expect(await harness.cases.get(survivor.id)).not.toBeNull();
    });

    it('remove de un caso inexistente es no-op', async () => {
      const survivor = await harness.cases.create(CASE_INPUT);
      await harness.cases.remove('missing');
      expect(await harness.cases.get(survivor.id)).not.toBeNull();
    });

    it('devuelve copias defensivas: mutar lo leído no contamina el store', async () => {
      const created = await harness.cases.create(CASE_INPUT);
      const read = await harness.cases.get(created.id);
      if (read !== null) {
        read.title = 'Mutado';
        read.parties.push({ id: 'p1', name: 'Mutante', role: 'plaintiff' });
      }
      const reloaded = await harness.cases.get(created.id);
      expect(reloaded?.title).toBe(CASE_INPUT.title);
      expect(reloaded?.parties).toEqual([]);

      const document = makeDocument('d1', created.id, 10);
      await harness.cases.appendDocument(document);
      document.markdown = 'Mutado';
      expect((await harness.cases.listDocuments(created.id))[0]?.markdown).toBe('# d1');
    });

    it('install guarda bytes/installedAt y get devuelve el pack completo', async () => {
      harness.setNow(1234);
      const pack = makePack();
      const installed = await harness.packs.install(pack, 512);

      expect(installed).toEqual({
        id: 'pack-ccyc',
        version: '1.0.0',
        hash: 'pack-hash-1',
        installedAt: 1234,
        bytes: 512,
      });
      expect(await harness.packs.get('pack-ccyc')).toEqual(pack);
      expect(await harness.packs.get('missing')).toBeNull();
    });

    it('listInstalled devuelve metadatos sin contenido en orden (installedAt, id)', async () => {
      harness.setNow(10);
      await harness.packs.install(makePack(), 100);
      harness.setNow(20);
      await harness.packs.install(
        makePack({ id: 'pack-cpccn', version: '2.0.0', hash: 'pack-hash-2' }),
        200,
      );

      const installed = await harness.packs.listInstalled();
      expect(installed.map((pack) => pack.id)).toEqual(['pack-ccyc', 'pack-cpccn']);
      expect(installed[0]).toEqual({
        id: 'pack-ccyc',
        version: '1.0.0',
        hash: 'pack-hash-1',
        installedAt: 10,
        bytes: 100,
      });
      expect(installed[0]).not.toHaveProperty('provisions');
      expect(installed[0]).not.toHaveProperty('norms');
      expect(installed[0]).not.toHaveProperty('title');
    });

    it('listInstalled desempata por id cuando installedAt coincide', async () => {
      harness.setNow(10);
      await harness.packs.install(makePack({ id: 'pack-b' }), 100);
      await harness.packs.install(makePack({ id: 'pack-a' }), 100);
      expect((await harness.packs.listInstalled()).map((pack) => pack.id)).toEqual([
        'pack-a',
        'pack-b',
      ]);
    });

    it('install reemplaza por id (upsert) sin duplicar y actualiza metadatos', async () => {
      harness.setNow(10);
      await harness.packs.install(makePack(), 100);
      harness.setNow(20);
      const replaced = await harness.packs.install(
        makePack({ version: '2.0.0', hash: 'pack-hash-2' }),
        300,
      );

      expect(replaced).toEqual({
        id: 'pack-ccyc',
        version: '2.0.0',
        hash: 'pack-hash-2',
        installedAt: 20,
        bytes: 300,
      });
      expect(await harness.packs.listInstalled()).toHaveLength(1);
      expect((await harness.packs.get('pack-ccyc'))?.version).toBe('2.0.0');
      expect((await harness.packs.get('pack-ccyc'))?.hash).toBe('pack-hash-2');
    });

    it('remove borra el pack instalado y es no-op si no existe', async () => {
      await harness.packs.install(makePack(), 100);
      await harness.packs.remove('pack-ccyc');
      expect(await harness.packs.get('pack-ccyc')).toBeNull();
      expect(await harness.packs.listInstalled()).toEqual([]);
      await harness.packs.remove('missing');
      expect(await harness.packs.listInstalled()).toEqual([]);
    });

    it('packs: mutar el input o lo leído no contamina el store', async () => {
      const pack = makePack();
      await harness.packs.install(pack, 100);
      pack.title = 'Mutado';
      pack.provisions = [];
      const reloaded = await harness.packs.get(pack.id);
      expect(reloaded?.title).toBe('Código Civil y Comercial');
      expect(reloaded?.provisions).toHaveLength(1);
      if (reloaded !== null) reloaded.title = 'Mutado';
      expect((await harness.packs.get(pack.id))?.title).toBe('Código Civil y Comercial');
    });
  });
}

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

function makePack(overrides: Partial<LegalPack> = {}): LegalPack {
  return {
    schema: 'openher.legal.pack/1',
    id: 'pack-ccyc',
    title: 'Código Civil y Comercial',
    version: '1.0.0',
    publishedAt: '2026-01-01',
    jurisdiction: 'national',
    matter: 'civil',
    license: { name: 'InfoLEG', url: 'https://example.test/license', attribution: 'InfoLEG' },
    sources: [{ url: 'https://example.test/ccyc', retrievedAt: '2026-01-01' }],
    norms: [{ id: 'CCyC', short: 'CCyC', long: 'Código Civil y Comercial', jurisdiction: 'national' }],
    provisions: [
      {
        id: 'CCyC-1',
        normId: 'CCyC',
        article: '1',
        text: 'Texto del artículo.',
        jurisdiction: 'national',
        sourceUrl: 'https://example.test/ccyc/1',
        sourceDate: '2026-01-01',
        textHash: 'text-hash-1',
        verificationMethod: 'manual',
        tags: ['fuentes'],
        verified: true,
      },
    ],
    hash: 'pack-hash-1',
    ...overrides,
  };
}
