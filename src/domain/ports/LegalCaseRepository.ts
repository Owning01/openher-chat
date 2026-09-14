import type {
  AcknowledgmentRecord,
  CaseAnalysis,
  GapReportEntry,
  LegalCase,
  LegalDocument,
} from '../types/legal';

/** Datos mínimos para crear un expediente; el repositorio completa id, estado y timestamps. */
export interface CreateLegalCaseInput {
  title: string;
  jurisdiction: LegalCase['jurisdiction'];
  court: string;
  matter: LegalCase['matter'];
  clientRole: LegalCase['clientRole'];
}

/**
 * Puerto del expediente y sus colecciones derivadas.
 * El vínculo caso↔conversación vive en `Conversation.legalCaseId`; este puerto no consulta por conversación.
 */
export interface LegalCaseRepository {
  list(): Promise<LegalCase[]>;
  get(id: string): Promise<LegalCase | null>;
  create(input: CreateLegalCaseInput): Promise<LegalCase>;
  update(id: string, patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>): Promise<LegalCase>;
  remove(id: string): Promise<void>;
  listAnalyses(caseId: string): Promise<CaseAnalysis[]>;
  appendAnalysis(analysis: CaseAnalysis): Promise<void>;
  listDocuments(caseId: string): Promise<LegalDocument[]>;
  appendDocument(document: LegalDocument): Promise<void>;
  updateDocument(
    id: string,
    patch: Partial<Omit<LegalDocument, 'id' | 'caseId' | 'createdAt'>>,
  ): Promise<LegalDocument>;
  removeDocument(id: string): Promise<void>;
  appendAcknowledgment(record: AcknowledgmentRecord): Promise<void>;
  listAcknowledgments(caseId: string): Promise<AcknowledgmentRecord[]>;
  appendGap(entry: GapReportEntry): Promise<void>;
  listGaps(caseId: string): Promise<GapReportEntry[]>;
}
