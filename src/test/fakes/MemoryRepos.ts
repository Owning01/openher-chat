import { searchMessages as searchInMessages } from '@/domain/chat/messageSearch';
import type { MessageSearchHit } from '@/domain/chat/messageSearch';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { CreateLegalCaseInput, LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type { LegalPackStore } from '@/domain/ports/LegalPackStore';
import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import type { SkillRepository } from '@/domain/ports/SkillRepository';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { ChatMessage } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import type {
  AcknowledgmentRecord,
  CaseAnalysis,
  GapReportEntry,
  InstalledPack,
  LegalCase,
  LegalDocument,
  LegalPack,
} from '@/domain/types/legal';
import type { AppSettings } from '@/domain/types/settings';
import type { Skill, SkillDraft } from '@/domain/types/skill';
import { newId as defaultNewId } from '@/shared/utils/ids';

export interface MemoryConversationRepositoryDeps {
  newId?: () => string;
  now?: () => number;
}

/** Doble en memoria de `ConversationRepository` con las mismas semánticas (cascada, orden, recover). */
export class MemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, ChatMessage>();
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(deps: MemoryConversationRepositoryDeps = {}) {
    this.newId = deps.newId ?? (() => defaultNewId());
    this.now = deps.now ?? (() => Date.now());
  }

  async list(): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .map(cloneConversation)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation === undefined ? null : cloneConversation(conversation);
  }

  async create(input: { title?: string; providerId?: string | null; modelId?: string | null } = {}): Promise<Conversation> {
    const now = this.now();
    const conversation: Conversation = {
      id: this.newId(),
      title: input.title ?? '',
      createdAt: now,
      updatedAt: now,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      systemPromptOverride: null,
      researchMode: false,
      messageCount: 0,
      lastMessagePreview: '',
      status: 'active',
    };
    this.conversations.set(conversation.id, conversation);
    return cloneConversation(conversation);
  }

  async update(id: string, patch: Partial<Omit<Conversation, 'id' | 'createdAt'>>): Promise<Conversation> {
    const existing = this.conversations.get(id);
    if (existing === undefined) throw new Error(`Conversation not found: ${id}`);
    const updated: Conversation = { ...existing, ...patch, updatedAt: this.now() };
    this.conversations.set(id, updated);
    return cloneConversation(updated);
  }

  async remove(id: string): Promise<void> {
    this.conversations.delete(id);
    for (const [messageId, message] of this.messages) {
      if (message.conversationId === id) this.messages.delete(messageId);
    }
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .map(cloneMessage)
      .sort(compareMessages);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    this.messages.set(message.id, cloneMessage(message));
  }

  async updateMessage(
    id: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>>,
  ): Promise<void> {
    const existing = this.messages.get(id);
    if (existing === undefined) throw new Error(`Message not found: ${id}`);
    this.messages.set(id, { ...existing, ...patch });
  }

  async deleteMessagesFrom(conversationId: string, messageId: string): Promise<void> {
    const target = this.messages.get(messageId);
    if (target === undefined || target.conversationId !== conversationId) return;
    const ordered = [...this.messages.values()]
      .filter((message) => message.conversationId === conversationId)
      .sort(compareMessages);
    const targetIndex = ordered.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) return;
    for (const message of ordered.slice(targetIndex)) this.messages.delete(message.id);
  }

  async recoverInterrupted(): Promise<string[]> {
    const affected = new Set<string>();
    for (const [id, message] of this.messages) {
      if (message.status === 'streaming') {
        affected.add(message.conversationId);
        this.messages.set(id, {
          ...message,
          status: 'aborted',
          finishReason: message.finishReason ?? 'aborted',
        });
      }
    }
    return Array.from(affected);
  }

  async searchMessages(query: string, limit: number): Promise<MessageSearchHit[]> {
    return searchInMessages([...this.messages.values()], query, limit);
  }

  /** Vacía conversaciones y mensajes para aislar tests del arnés. */
  clear(): void {
    this.conversations.clear();
    this.messages.clear();
  }
}

export interface MemoryLegalCaseRepositoryDeps {
  newId?: () => string;
  now?: () => number;
}

/** Doble en memoria de `LegalCaseRepository` con la misma semántica que `IndexedDbLegalCases` (cascada, orden, timestamps). */
export class MemoryLegalCaseRepository implements LegalCaseRepository {
  private readonly cases = new Map<string, LegalCase>();
  private readonly documents = new Map<string, LegalDocument>();
  private readonly analyses = new Map<string, CaseAnalysis>();
  private readonly acknowledgments = new Map<string, AcknowledgmentRecord>();
  private readonly gaps = new Map<string, GapReportEntry>();
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(deps: MemoryLegalCaseRepositoryDeps = {}) {
    this.newId = deps.newId ?? (() => defaultNewId());
    this.now = deps.now ?? (() => Date.now());
  }

  async list(): Promise<LegalCase[]> {
    return [...this.cases.values()].map(cloneLegal).sort(compareLegalByCreatedAt);
  }

  async get(id: string): Promise<LegalCase | null> {
    const legalCase = this.cases.get(id);
    return legalCase === undefined ? null : cloneLegal(legalCase);
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
    this.cases.set(legalCase.id, cloneLegal(legalCase));
    return cloneLegal(legalCase);
  }

  async update(id: string, patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>): Promise<LegalCase> {
    const existing = this.cases.get(id);
    if (existing === undefined) throw new Error(`Legal case not found: ${id}`);
    const updated: LegalCase = { ...existing, ...patch, updatedAt: this.now() };
    this.cases.set(id, cloneLegal(updated));
    return cloneLegal(updated);
  }

  /** Baja en cascada: documentos, análisis, acknowledgments y gaps del caso; no-op si no existe. */
  async remove(id: string): Promise<void> {
    this.cases.delete(id);
    for (const [documentId, document] of this.documents) {
      if (document.caseId === id) this.documents.delete(documentId);
    }
    for (const [analysisId, analysis] of this.analyses) {
      if (analysis.caseId === id) this.analyses.delete(analysisId);
    }
    for (const [recordId, record] of this.acknowledgments) {
      if (record.caseId === id) this.acknowledgments.delete(recordId);
    }
    for (const [entryId, entry] of this.gaps) {
      if (entry.caseId === id) this.gaps.delete(entryId);
    }
  }

  async listAnalyses(caseId: string): Promise<CaseAnalysis[]> {
    return [...this.analyses.values()]
      .filter((analysis) => analysis.caseId === caseId)
      .map(cloneLegal)
      .sort(compareLegalByCreatedAt);
  }

  async appendAnalysis(analysis: CaseAnalysis): Promise<void> {
    this.analyses.set(analysis.id, cloneLegal(analysis));
  }

  async listDocuments(caseId: string): Promise<LegalDocument[]> {
    return [...this.documents.values()]
      .filter((document) => document.caseId === caseId)
      .map(cloneLegal)
      .sort(compareLegalByCreatedAt);
  }

  async appendDocument(document: LegalDocument): Promise<void> {
    this.documents.set(document.id, cloneLegal(document));
  }

  async updateDocument(
    id: string,
    patch: Partial<Omit<LegalDocument, 'id' | 'caseId' | 'createdAt'>>,
  ): Promise<LegalDocument> {
    const existing = this.documents.get(id);
    if (existing === undefined) throw new Error(`Legal document not found: ${id}`);
    const updated: LegalDocument = { ...existing, ...patch, updatedAt: this.now() };
    this.documents.set(id, cloneLegal(updated));
    return cloneLegal(updated);
  }

  async removeDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async appendAcknowledgment(record: AcknowledgmentRecord): Promise<void> {
    this.acknowledgments.set(record.id, cloneLegal(record));
  }

  async listAcknowledgments(caseId: string): Promise<AcknowledgmentRecord[]> {
    return [...this.acknowledgments.values()]
      .filter((record) => record.caseId === caseId)
      .map(cloneLegal)
      .sort(compareLegalByAt);
  }

  async appendGap(entry: GapReportEntry): Promise<void> {
    this.gaps.set(entry.id, cloneLegal(entry));
  }

  async listGaps(caseId: string): Promise<GapReportEntry[]> {
    return [...this.gaps.values()]
      .filter((entry) => entry.caseId === caseId)
      .map(cloneLegal)
      .sort(compareLegalByAt);
  }

  /** Vacía casos y todas sus colecciones derivadas para aislar tests del arnés. */
  clear(): void {
    this.cases.clear();
    this.documents.clear();
    this.analyses.clear();
    this.acknowledgments.clear();
    this.gaps.clear();
  }
}

export interface MemoryLegalPackStoreDeps {
  now?: () => number;
}

/** Doble en memoria de `LegalPackStore` con la misma semántica que `IndexedDbLegalPacks` (upsert, metadatos sin contenido). */
export class MemoryLegalPackStore implements LegalPackStore {
  private readonly stored = new Map<string, { pack: LegalPack; installedAt: number; bytes: number }>();
  private readonly now: () => number;

  constructor(deps: MemoryLegalPackStoreDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Metadatos de los packs instalados, en orden `(installedAt, id)`, sin contenido. */
  async listInstalled(): Promise<InstalledPack[]> {
    return [...this.stored.values()]
      .map(({ pack, installedAt, bytes }) => ({
        id: pack.id,
        version: pack.version,
        hash: pack.hash,
        installedAt,
        bytes,
      }))
      .sort((a, b) => a.installedAt - b.installedAt || a.id.localeCompare(b.id));
  }

  /** Pack completo por id (sin los metadatos de instalación), o `null` si no está. */
  async get(id: string): Promise<LegalPack | null> {
    const entry = this.stored.get(id);
    return entry === undefined ? null : cloneLegal(entry.pack);
  }

  /** Instala o reemplaza por `id` (upsert) y devuelve los metadatos persistidos. */
  async install(pack: LegalPack, bytes: number): Promise<InstalledPack> {
    const installedAt = this.now();
    this.stored.set(pack.id, { pack: cloneLegal(pack), installedAt, bytes });
    return { id: pack.id, version: pack.version, hash: pack.hash, installedAt, bytes };
  }

  async remove(id: string): Promise<void> {
    this.stored.delete(id);
  }

  /** Vacía los packs instalados para aislar tests del arnés. */
  clear(): void {
    this.stored.clear();
  }
}

export interface MemorySettingsRepositoryOptions {
  now?: () => number;
  initial?: AppSettings;
}

export class MemorySettingsRepository implements SettingsRepository {
  private settings: AppSettings;
  private readonly now: () => number;

  constructor(options: MemorySettingsRepositoryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.settings = cloneSettings(options.initial ?? createDefaultSettings(this.now()));
  }

  async load(): Promise<AppSettings> {
    return cloneSettings(this.settings);
  }

  async save(settings: AppSettings): Promise<void> {
    this.settings = cloneSettings(settings);
  }

  /** Restaura los defaults (misma semántica que una instancia recién construida). */
  clear(): void {
    this.settings = cloneSettings(createDefaultSettings(this.now()));
  }
}

export class MemoryKeyVault implements KeyVault {
  private readonly secrets = new Map<string, string>();

  async has(ref: string): Promise<boolean> {
    return this.secrets.has(ref);
  }

  async get(ref: string): Promise<string | null> {
    return this.secrets.get(ref) ?? null;
  }

  async set(ref: string, secret: string): Promise<void> {
    this.secrets.set(ref, secret);
  }

  async remove(ref: string): Promise<void> {
    this.secrets.delete(ref);
  }

  /** Vacía todos los secretos registrados. */
  clear(): void {
    this.secrets.clear();
  }
}

function cloneConversation(conversation: Conversation): Conversation {
  return { ...conversation };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return JSON.parse(JSON.stringify(message)) as ChatMessage;
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

/** Orden canónico de mensajes dentro de una conversación (paridad con IndexedDB). */
function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Orden canónico `(createdAt, id)` de casos, documentos y análisis (paridad con IndexedDB). */
function compareLegalByCreatedAt(
  a: { createdAt: number; id: string },
  b: { createdAt: number; id: string },
): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Orden canónico `(at, id)` del log append-only (paridad con IndexedDB). */
function compareLegalByAt(a: { at: number; id: string }, b: { at: number; id: string }): number {
  return a.at - b.at || a.id.localeCompare(b.id);
}

/** Clonado profundo defensivo de las entidades legales (evita aliasar el store). */
function cloneLegal<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface MemorySkillRepositoryDeps {
  newId?: () => string;
  now?: () => number;
}

/** Doble en memoria de `SkillRepository` con la misma semántica que `IndexedDbSkills` (upsert, orden por nombre). */
export class MemorySkillRepository implements SkillRepository {
  private readonly stored = new Map<string, Skill>();
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(deps: MemorySkillRepositoryDeps = {}) {
    this.newId = deps.newId ?? (() => defaultNewId('skill'));
    this.now = deps.now ?? (() => Date.now());
  }

  async list(): Promise<Skill[]> {
    return [...this.stored.values()]
      .map((skill) => ({ ...skill }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async save(draft: SkillDraft): Promise<Skill> {
    const existing = draft.id === undefined ? undefined : this.stored.get(draft.id);
    const now = this.now();
    const skill: Skill = {
      id: draft.id ?? this.newId(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      body: draft.body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.stored.set(skill.id, skill);
    return { ...skill };
  }

  async remove(id: string): Promise<void> {
    this.stored.delete(id);
  }

  /** Vacía las skills para aislar tests del arnés. */
  clear(): void {
    this.stored.clear();
  }
}
