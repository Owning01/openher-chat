import type { ChatMessage } from './chat';

// ---------------------------------------------------------------------------
// Vocabulario base: jurisdicción, materia, rol de parte y certeza de hecho.
// ---------------------------------------------------------------------------

/** Jurisdicción aplicable; el MVP cubre nacional y CABA, con provinciales declaradas. */
export type LegalJurisdiction = 'national' | 'caba' | 'pba' | 'cordoba';

/** Materia del expediente (civil, comercial o su fuero unificado). */
export type LegalMatter = 'civil' | 'commercial' | 'civil-commercial';

/** Rol procesal de una parte; también tipa el rol del cliente en el caso. */
export type LegalPartyRole = 'plaintiff' | 'defendant' | 'third-party';

/** Grado de certeza con el que se conoce un hecho del expediente. */
export type LegalFactCertainty = 'certain' | 'probable' | 'doubtful' | 'unknown';

/** Parte interviniente en el expediente. */
export interface LegalParty {
  id: string;
  name: string;
  role: LegalPartyRole;
  /** Documento/CUIT; dato sensible que se pseudonimiza antes de salir del dispositivo. */
  taxId?: string;
  address?: string;
  /** Apoderado o patrocinante, si consta. */
  representative?: string;
}

/** Hecho relevante del caso; es dato, nunca instrucción para el modelo. */
export interface LegalFact {
  id: string;
  statement: string;
  /** Fecha del hecho (ISO `YYYY-MM-DD`) cuando se conoce. */
  date?: string;
  certainty: LegalFactCertainty;
  /** Origen del hecho (documento, relato del cliente, pericia, etc.). */
  source?: string;
}

/** Fecha clave del expediente (no implica cómputo de plazo). */
export interface LegalKeyDate {
  id: string;
  label: string;
  date: string;
}

/** Consentimiento informado persistido para tratar datos sensibles del caso. */
export interface LegalConsent {
  at: number;
  text: string;
  scope: 'sensitive-data' | 'professional-secrecy';
}

/** Tipo de documento legal que puede redactarse. */
export type DocumentKind =
  | 'claim'
  | 'answer'
  | 'prior-exceptions'
  | 'counterclaim'
  | 'cautelar'
  | 'evidence'
  | 'closing'
  | 'appeal'
  | 'demand-letter'
  | 'contract'
  | 'bylaws';

/** Conteo de citas de un análisis o documento; se persiste para exportar con honestidad. */
export interface LegalCitationCounters {
  verified: number;
  unverified: number;
}

/**
 * Expediente: fuente única de la verdad del caso en runtime.
 * El vínculo con la conversación vive en `Conversation.legalCaseId` (no acá).
 */
export interface LegalCase {
  id: string;
  title: string;
  status: 'active' | 'archived';
  jurisdiction: LegalJurisdiction;
  court: string;
  matter: LegalMatter;
  clientRole: LegalPartyRole;
  parties: LegalParty[];
  facts: LegalFact[];
  keyDates: LegalKeyDate[];
  consent?: LegalConsent;
  createdAt: number;
  updatedAt: number;
}

/** Documento redactado (borrador). Se persiste crudo; el guard y el watermark se aplican al render/exportar. */
export interface LegalDocument {
  id: string;
  caseId: string;
  kind: DocumentKind;
  title: string;
  /** Plantilla usada para generarlo, o `null` si se redactó libremente. */
  templateId: string | null;
  /** Markdown del borrador sin marcar citas. */
  markdown: string;
  status: 'draft' | 'reviewed' | 'final';
  /** Conteo de citas del último guard aplicado. */
  citationCounters?: LegalCitationCounters;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Corpus: normas, provisiones, packs e índice léxico.
// ---------------------------------------------------------------------------

/** Norma del corpus, indexable por sigla, nombre largo y alias. */
export interface LegalNorm {
  /** Id canónico, p. ej. `CCyC` o `CPCCN`. */
  id: string;
  /** Sigla usada en citas (`CCyC`). */
  short: string;
  /** Nombre completo (`Código Civil y Comercial de la Nación`). */
  long: string;
  /** Alias/abreviaturas indexables (`CCCN`, `Código Civil y Comercial`). */
  aliases?: string[];
  jurisdiction: LegalJurisdiction;
  sourceUrl?: string;
}

/** Provisión (artículo) publicada en un pack, con trazabilidad de procedencia. */
export interface LegalProvision {
  id: string;
  normId: string;
  article: string;
  title?: string;
  text: string;
  jurisdiction: LegalJurisdiction;
  sourceUrl: string;
  sourceDate: string;
  textHash: string;
  verificationMethod: 'manual' | 'scripted' | 'user-provided';
  curatedBy?: string;
  curatedAt?: string;
  tags: string[];
  synonyms?: string[];
  verified: boolean;
}

/** Pack de corpus versionado y firmado por hash. */
export interface LegalPack {
  schema: 'openher.legal.pack/1';
  id: string;
  title: string;
  version: string;
  publishedAt: string;
  jurisdiction: LegalJurisdiction;
  matter: LegalMatter;
  license: { name: string; url: string; attribution: string; verifiedAt?: string };
  sources: { url: string; retrievedAt: string; note?: string }[];
  norms: LegalNorm[];
  provisions: LegalProvision[];
  /** SHA-256 del canon `{schema,id,version,publishedAt,license,sources,norms,provisions}`. */
  hash: string;
}

/** Metadatos del pack instalado en el dispositivo (sin el contenido). */
export interface InstalledPack {
  id: string;
  version: string;
  hash: string;
  installedAt: number;
  bytes: number;
}

/** Resultado de retrieval: provisión + puntaje + procedencia del pack. */
export interface LegalPassage {
  provision: LegalProvision;
  score: number;
  packId: string;
  packVersion: string;
}

/** Índice léxico derivado (no se persiste), construido sobre los packs instalados. */
export interface LegalIndex {
  readonly versions: Readonly<Record<string, string>>;
  readonly size: number;
  has(normId: string, article: string): boolean;
  get(normId: string, article: string): LegalProvision | null;
  search(query: string, limit: number): LegalPassage[];
}

/** Entrada del gap report local: consulta que el corpus no pudo resolver. */
export interface GapReportEntry {
  id: string;
  caseId: string;
  query: string;
  missingNorm?: string;
  missingArticle?: string;
  at: number;
}

// ---------------------------------------------------------------------------
// Citation guard: existencia + fidelidad.
// ---------------------------------------------------------------------------

/** Naturaleza de una cita detectada en texto del modelo. */
export type CitationKind = 'norm' | 'article' | 'case-law' | 'doctrine' | 'docket';

/** Fidelidad de un span entrecomillado respecto de la provisión citada. */
export type CitationFidelity = 'verbatim' | 'paraphrase' | 'not-applicable';

/** Cita cruda extraída de un texto, antes de verificarla contra el índice. */
export interface CitationRef {
  /** Texto original tal como apareció en la respuesta. */
  raw: string;
  kind: CitationKind;
  /** Id de norma normalizado (`CCyC`), o `null` si no se pudo inferir. */
  normId: string | null;
  /** Artículo normalizado (`2560`, `52 bis`), o `null`. */
  article: string | null;
}

/** Cita embebida en el análisis adversarial, con el resultado del guard. */
export interface AnalysisCitation {
  raw: string;
  normId: string | null;
  article: string | null;
  packId: string | null;
  packVersion: string | null;
  status: 'verified' | 'unverified';
  fidelity: CitationFidelity;
}

/** Veredicto del guard para una cita: verificada, no verificada o malformada. */
export type CitationVerdict =
  | {
      status: 'verified';
      citation: CitationRef;
      provision: LegalProvision;
      fidelity: CitationFidelity;
      packId: string;
      packVersion: string;
    }
  | {
      status: 'unverified';
      citation: CitationRef;
      reason: 'no-index' | 'article-missing' | 'not-a-norm' | 'external-kind' | 'paraphrase';
    }
  | { status: 'malformed'; raw: string };

/** Resultado completo del guard sobre un texto. */
export interface CitationGuardResult {
  /** Un veredicto por cita detectada, en orden de aparición. */
  verdicts: CitationVerdict[];
  verified: number;
  unverified: number;
  /** Citas cuyo formato no pudo clasificarse. */
  malformed: number;
}

// ---------------------------------------------------------------------------
// Análisis adversarial: personas, postura del juez y resultado consolidado.
// ---------------------------------------------------------------------------

/** Perspectiva del análisis adversarial; el ataque es siempre una simulación interna. */
export type AdversarialPerspective = 'defense' | 'attack' | 'judge' | 'risk';

/** Ítem del análisis adversarial. */
export interface AnalysisItem {
  id: string;
  perspective: AdversarialPerspective;
  kind: 'attack' | 'defense' | 'counter' | 'judge-lean' | 'risk' | 'question';
  statement: string;
  basis: AnalysisCitation[];
  evidenceRefs: string[];
  strength: 'high' | 'medium' | 'low';
  confidence: number;
}

/** Postura estimada del juez sobre una tesis. */
export interface JudgePostureItem {
  id: string;
  thesis: string;
  leaning: 'favorable' | 'unfavorable' | 'unclear';
  basis: AnalysisCitation[];
  confidence: number;
}

/** Presupuesto local del análisis adversarial. */
export interface LegalAnalysisBudget {
  maxCalls: number;
  maxTotalTokens: number;
  maxWallClockMs: number;
  maxParallel: number;
  maxOutputTokensPerPersona: number;
}

/** Resultado persistido de un análisis adversarial (4 personas + síntesis). */
export interface CaseAnalysis {
  id: string;
  caseId: string;
  createdAt: number;
  providerId: string;
  modelId: string;
  packs: { id: string; version: string }[];
  attacks: AnalysisItem[];
  defenses: AnalysisItem[];
  judgePosture: JudgePostureItem[];
  risks: AnalysisItem[];
  openQuestions: AnalysisItem[];
  synthesis: string;
  citations: LegalCitationCounters;
  /** `true` si degradó a menos de 4 personas. */
  incomplete: boolean;
  raw: Record<AdversarialPerspective, string>;
}

/** Reconocimiento de citas no verificadas exigido antes de exportar (append-only). */
export interface AcknowledgmentRecord {
  id: string;
  caseId: string;
  documentId: string;
  at: number;
  unverifiedCount: number;
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Plazos: reglas versionadas, calendario y vencimientos calculados.
// ---------------------------------------------------------------------------

/** Unidad de cómputo de un plazo. */
export type DeadlineUnit = 'calendar-days' | 'business-days' | 'months' | 'years';

/** Hito desde el que empieza a correr el plazo. */
export type DeadlineStart = 'notification' | 'service' | 'filing' | 'breach' | 'due-date';

/** Regla de plazo verificada contra fuente oficial (o marcada `verified:false`). */
export interface DeadlineRule {
  id: string;
  jurisdiction: LegalJurisdiction;
  /** Ámbito de aplicación (p. ej. `prescription`). */
  scope: string;
  /** Norma que fija el plazo (p. ej. `CCyC-2560`). */
  normRef: string;
  days: number;
  unit: DeadlineUnit;
  from: DeadlineStart;
  verified: boolean;
  sourceUrl: string;
  label: string;
}

/** Calendario de feriados y ferias judiciales de una jurisdicción. */
export interface HolidayCalendar {
  jurisdiction: LegalJurisdiction;
  year: number;
  /** Feriados en ISO `YYYY-MM-DD`. */
  holidays: string[];
  /** Ferias judiciales como rangos inclusivos en ISO `YYYY-MM-DD`. */
  judicialRecess: { from: string; to: string; label?: string }[];
  verified: boolean;
  sourceUrl?: string;
}

/** Vencimiento calculado a partir de una regla; derivado, no persistido. */
export interface DeadlineItem {
  id: string;
  caseId: string;
  ruleId: string;
  label: string;
  /** Inicio del cómputo (ISO `YYYY-MM-DD`). */
  startDate: string;
  /** Vencimiento calculado (ISO `YYYY-MM-DD`). */
  dueDate: string;
  unit: DeadlineUnit;
  amount: number;
  /** Días efectivamente contados (excluye feriados y ferias). */
  countedDays: number;
  verified: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Plantillas y brief (tipos consumidos por generación/prompt).
// ---------------------------------------------------------------------------

/** Sección de una plantilla de documento. */
export interface LegalTemplateSection {
  id: string;
  heading: string;
  /** Guía para el modelo sobre el contenido esperado; nunca texto final. */
  guidance: string;
  /** Claves del expediente que la sección resuelve. */
  slots: string[];
  required: boolean;
}

/** Requisito de la checklist procesal, con la norma que lo exige. */
export interface LegalTemplateChecklistItem {
  id: string;
  label: string;
  /** Norma que exige el requisito (p. ej. `CPCCN-330`). */
  normRef: string;
  /** Provisiones del pack que respaldan el requisito. */
  packProvisions: string[];
}

/** Plantilla de documento como data pura. */
export interface LegalTemplate {
  id: string;
  kind: DocumentKind;
  title: string;
  /** Jurisdicciones donde aplica; vacío = todas. */
  jurisdictions: LegalJurisdiction[];
  sections: LegalTemplateSection[];
  checklist: LegalTemplateChecklistItem[];
  /** Referencias normativas base que la plantilla espera en el pack. */
  packProvisions: string[];
}

/** Forma del brief efímero: par tool-call/tool-result o bloque de texto. */
export type LegalBriefKind = 'tool-pair' | 'text-block';

/**
 * Brief del expediente listo para el wire efímero.
 * Nunca entra al historial persistido ni al `system`.
 */
export interface LegalBrief {
  kind: LegalBriefKind;
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Settings legal (defaults de expedientes nuevos; sin `packs`).
// ---------------------------------------------------------------------------

/** Presupuesto de recuperación léxica del brief. */
export interface LegalRetrievalBudget {
  maxPassages: number;
  maxPassageChars: number;
  maxBriefTokens: number;
}

/** Preferencias del modo legal; no decide el modo de conversaciones existentes. */
export interface LegalSettings {
  enabled: boolean;
  defaultJurisdiction: LegalJurisdiction;
  defaultCourt: string;
  defaultMatter: LegalMatter;
  retrieval: LegalRetrievalBudget;
  analysis: LegalAnalysisBudget;
  anonymization: 'required' | 'optional';
  /** Personas adversariales activas por defecto. */
  perspectives: AdversarialPerspective[];
  /** Plantilla por defecto para cada tipo de documento. */
  defaultTemplates: Partial<Record<DocumentKind, string>>;
  setupCompleted: boolean;
}
