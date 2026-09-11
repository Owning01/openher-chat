import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { ChatMessage } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import type { AppSettings } from '@/domain/types/settings';
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

  /** Vacía conversaciones y mensajes para aislar tests del arnés. */
  clear(): void {
    this.conversations.clear();
    this.messages.clear();
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
