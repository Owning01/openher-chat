import type { MessageSearchHit } from '../chat/messageSearch';
import type { ChatMessage } from '../types/chat';
import type { Conversation } from '../types/conversation';

export interface ConversationRepository {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | null>;
  create(input?: { title?: string; providerId?: string | null; modelId?: string | null }): Promise<Conversation>;
  update(id: string, patch: Partial<Omit<Conversation, 'id' | 'createdAt'>>): Promise<Conversation>;
  remove(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  updateMessage(id: string, patch: Partial<Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>>): Promise<void>;
  deleteMessagesFrom(conversationId: string, messageId: string): Promise<void>;
  recoverInterrupted(): Promise<string[]>;
  /** Búsqueda full-text en el contenido de los mensajes, más recientes primero. */
  searchMessages(query: string, limit: number): Promise<MessageSearchHit[]>;
}
