import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { ChatMessage } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import { newId } from '@/shared/utils/ids';
import { getDb } from './idb';

export interface ConversationStorageDeps {
  newId: () => string;
  now: () => number;
}

const DEFAULT_DEPS: ConversationStorageDeps = { newId, now: () => Date.now() };

export type CreateConversationInput = { title?: string; providerId?: string | null; modelId?: string | null };

export class IndexedDbConversations implements ConversationRepository {
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(deps: Partial<ConversationStorageDeps> = {}) {
    this.newId = deps.newId ?? DEFAULT_DEPS.newId;
    this.now = deps.now ?? DEFAULT_DEPS.now;
  }

  async list(): Promise<Conversation[]> {
    const db = await getDb();
    const conversations = await db.getAllFromIndex('conversations', 'updatedAt');
    return conversations.reverse();
  }

  async get(id: string): Promise<Conversation | null> {
    const db = await getDb();
    return (await db.get('conversations', id)) ?? null;
  }

  async create(input: CreateConversationInput = {}): Promise<Conversation> {
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
    const db = await getDb();
    await db.put('conversations', conversation);
    return conversation;
  }

  async update(id: string, patch: Partial<Omit<Conversation, 'id' | 'createdAt'>>): Promise<Conversation> {
    const db = await getDb();
    const tx = db.transaction('conversations', 'readwrite');
    const existing = await tx.store.get(id);
    if (existing === undefined) throw new Error(`Conversation not found: ${id}`);
    const updated: Conversation = { ...existing, ...patch, updatedAt: this.now() };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(['conversations', 'messages'], 'readwrite');
    const messages = tx.objectStore('messages');
    const keys = await messages.index('byConversation').getAllKeys(conversationRange(id));
    await Promise.all(keys.map((key) => messages.delete(key)));
    await tx.objectStore('conversations').delete(id);
    await tx.done;
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    const db = await getDb();
    const messages = await db.getAllFromIndex('messages', 'byConversation', conversationRange(conversationId));
    return messages.sort(compareMessages);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const db = await getDb();
    await db.put('messages', message);
  }

  async updateMessage(
    id: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>>,
  ): Promise<void> {
    const db = await getDb();
    const tx = db.transaction('messages', 'readwrite');
    const existing = await tx.store.get(id);
    if (existing === undefined) throw new Error(`Message not found: ${id}`);
    await tx.store.put({ ...existing, ...patch });
    await tx.done;
  }

  /**
   * Borra el mensaje indicado y todos los posteriores (mismo `conversationId`,
   * orden determinista por `(createdAt, id)` ascendente). Si el target no
   * existe o pertenece a otra conversación es no-op. Todo en una transacción.
   */
  async deleteMessagesFrom(conversationId: string, messageId: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const messages = (
      await store.index('byConversation').getAll(conversationRange(conversationId))
    ).sort(compareMessages);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex !== -1) {
      await Promise.all(messages.slice(targetIndex).map((message) => store.delete(message.id)));
    }
    await tx.done;
  }

  async recoverInterrupted(): Promise<string[]> {
    const db = await getDb();
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const affected = new Set<string>();
    let cursor = await store.openCursor();
    while (cursor !== null) {
      const message = cursor.value;
      if (message.status === 'streaming') {
        affected.add(message.conversationId);
        await cursor.update({
          ...message,
          status: 'aborted',
          finishReason: message.finishReason ?? 'aborted',
        });
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return Array.from(affected);
  }
}

function conversationRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound([conversationId, -Infinity], [conversationId, Infinity]);
}

/** Orden canónico de mensajes dentro de una conversación (paridad con el fake en memoria). */
function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}
