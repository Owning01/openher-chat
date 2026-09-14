import type {
  CreateLegalCaseInput,
  LegalCaseRepository,
} from '@/domain/ports/LegalCaseRepository';
import type {
  AcknowledgmentRecord,
  CaseAnalysis,
  GapReportEntry,
  LegalCase,
  LegalDocument,
} from '@/domain/types/legal';
import { newId } from '@/shared/utils/ids';
import {
  ACKNOWLEDGMENTS_STORE,
  CASE_ID_INDEX,
  GAPS_STORE,
  LEGAL_ANALYSES_STORE,
  LEGAL_CASES_STORE,
  LEGAL_DOCUMENTS_STORE,
  getDb,
} from './idb';

export interface LegalCaseStorageDeps {
  newId: () => string;
  now: () => number;
  ownerId?: string | null;
}

const DEFAULT_DEPS: LegalCaseStorageDeps = { newId, now: () => Date.now() };

/**
 * Repositorio real del expediente sobre IndexedDB v2. El vínculo caso↔conversación
 * vive en `Conversation.legalCaseId`; este adapter no consulta por conversación.
 */
export class IndexedDbLegalCases implements LegalCaseRepository {
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly ownerId: string | null;

  constructor(deps: Partial<LegalCaseStorageDeps> = {}) {
    this.newId = deps.newId ?? DEFAULT_DEPS.newId;
    this.now = deps.now ?? DEFAULT_DEPS.now;
    this.ownerId = deps.ownerId ?? null;
  }

  /** Orden canónico estable: `(createdAt, id)` ascendente. */
  async list(): Promise<LegalCase[]> {
    const db = await getDb(this.ownerId);
    const cases = await db.getAll(LEGAL_CASES_STORE);
    return cases.sort(compareByCreatedAt);
  }

  async get(id: string): Promise<LegalCase | null> {
    const db = await getDb(this.ownerId);
    return (await db.get(LEGAL_CASES_STORE, id)) ?? null;
  }

  async create(input: CreateLegalCaseInput): Promise<LegalCase> {
    const now = this.now();
    const legalCase: LegalCase = {
      id: this.newId(),
      title: input.title,
      status: 'active',
      jurisdiction: input.jurisdiction,
      court: input.court,
      matter: input.matter,
      clientRole: input.clientRole,
      parties: [],
      facts: [],
      keyDates: [],
      createdAt: now,
      updatedAt: now,
    };
    const db = await getDb(this.ownerId);
    await db.put(LEGAL_CASES_STORE, legalCase);
    return legalCase;
  }

  async update(
    id: string,
    patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>,
  ): Promise<LegalCase> {
    const db = await getDb(this.ownerId);
    const tx = db.transaction(LEGAL_CASES_STORE, 'readwrite');
    const existing = await tx.store.get(id);
    if (existing === undefined) throw new Error(`Legal case not found: ${id}`);
    const updated: LegalCase = { ...existing, ...patch, updatedAt: this.now() };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  /** Baja en cascada: documentos, análisis, acknowledgments y gaps del caso, en una transacción. */
  async remove(id: string): Promise<void> {
    const db = await getDb(this.ownerId);
    const tx = db.transaction(
      [
        LEGAL_CASES_STORE,
        LEGAL_DOCUMENTS_STORE,
        LEGAL_ANALYSES_STORE,
        ACKNOWLEDGMENTS_STORE,
        GAPS_STORE,
      ],
      'readwrite',
    );
    const documents = tx.objectStore(LEGAL_DOCUMENTS_STORE);
    const analyses = tx.objectStore(LEGAL_ANALYSES_STORE);
    const acknowledgments = tx.objectStore(ACKNOWLEDGMENTS_STORE);
    const gaps = tx.objectStore(GAPS_STORE);
    const [documentKeys, analysisKeys, acknowledgmentKeys, gapKeys] = await Promise.all([
      documents.index(CASE_ID_INDEX).getAllKeys(id),
      analyses.index(CASE_ID_INDEX).getAllKeys(id),
      acknowledgments.index(CASE_ID_INDEX).getAllKeys(id),
      gaps.index(CASE_ID_INDEX).getAllKeys(id),
    ]);
    await Promise.all([
      ...documentKeys.map((key) => documents.delete(key)),
      ...analysisKeys.map((key) => analyses.delete(key)),
      ...acknowledgmentKeys.map((key) => acknowledgments.delete(key)),
      ...gapKeys.map((key) => gaps.delete(key)),
    ]);
    await tx.objectStore(LEGAL_CASES_STORE).delete(id);
    await tx.done;
  }

  async listAnalyses(caseId: string): Promise<CaseAnalysis[]> {
    const db = await getDb(this.ownerId);
    const analyses = await db.getAllFromIndex(LEGAL_ANALYSES_STORE, CASE_ID_INDEX, caseId);
    return analyses.sort(compareByCreatedAt);
  }

  async appendAnalysis(analysis: CaseAnalysis): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.put(LEGAL_ANALYSES_STORE, analysis);
  }

  async listDocuments(caseId: string): Promise<LegalDocument[]> {
    const db = await getDb(this.ownerId);
    const documents = await db.getAllFromIndex(LEGAL_DOCUMENTS_STORE, CASE_ID_INDEX, caseId);
    return documents.sort(compareByCreatedAt);
  }

  async appendDocument(document: LegalDocument): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.put(LEGAL_DOCUMENTS_STORE, document);
  }

  async updateDocument(
    id: string,
    patch: Partial<Omit<LegalDocument, 'id' | 'caseId' | 'createdAt'>>,
  ): Promise<LegalDocument> {
    const db = await getDb(this.ownerId);
    const tx = db.transaction(LEGAL_DOCUMENTS_STORE, 'readwrite');
    const existing = await tx.store.get(id);
    if (existing === undefined) throw new Error(`Legal document not found: ${id}`);
    const updated: LegalDocument = { ...existing, ...patch, updatedAt: this.now() };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async removeDocument(id: string): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.delete(LEGAL_DOCUMENTS_STORE, id);
  }

  async appendAcknowledgment(record: AcknowledgmentRecord): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.put(ACKNOWLEDGMENTS_STORE, record);
  }

  async listAcknowledgments(caseId: string): Promise<AcknowledgmentRecord[]> {
    const db = await getDb(this.ownerId);
    const records = await db.getAllFromIndex(ACKNOWLEDGMENTS_STORE, CASE_ID_INDEX, caseId);
    return records.sort(compareByAt);
  }

  async appendGap(entry: GapReportEntry): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.put(GAPS_STORE, entry);
  }

  async listGaps(caseId: string): Promise<GapReportEntry[]> {
    const db = await getDb(this.ownerId);
    const entries = await db.getAllFromIndex(GAPS_STORE, CASE_ID_INDEX, caseId);
    return entries.sort(compareByAt);
  }
}

/** Orden canónico `(createdAt, id)` para las colecciones datadas por creación. */
function compareByCreatedAt(
  a: { createdAt: number; id: string },
  b: { createdAt: number; id: string },
): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Orden canónico `(at, id)` del log append-only (acknowledgments y gaps). */
function compareByAt(a: { at: number; id: string }, b: { at: number; id: string }): number {
  return a.at - b.at || a.id.localeCompare(b.id);
}
