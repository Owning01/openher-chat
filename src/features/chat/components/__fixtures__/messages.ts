import type { ChatMessage, MessageContent, MessageError, MessageFinishReason, MessageStatus } from '@/domain/types/chat';

export interface MessageOverrides {
  status?: MessageStatus;
  finishReason?: MessageFinishReason;
  error?: MessageError;
  conversationId?: string;
  createdAt?: number;
  updatedAt?: number;
  providerId?: string;
  modelId?: string;
}

export function userMessage(id: string, text: string, overrides: MessageOverrides = {}): ChatMessage {
  return buildMessage(id, 'user', [{ type: 'text', text }], overrides);
}

export function assistantMessage(id: string, content: MessageContent[], overrides: MessageOverrides = {}): ChatMessage {
  return buildMessage(id, 'assistant', content, overrides);
}

function buildMessage(
  id: string,
  role: ChatMessage['role'],
  content: MessageContent[],
  overrides: MessageOverrides,
): ChatMessage {
  const message: ChatMessage = {
    id,
    conversationId: overrides.conversationId ?? 'conversation-1',
    role,
    status: overrides.status ?? 'complete',
    content,
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
  };
  if (overrides.finishReason !== undefined) message.finishReason = overrides.finishReason;
  if (overrides.error !== undefined) message.error = overrides.error;
  if (overrides.providerId !== undefined) message.providerId = overrides.providerId;
  if (overrides.modelId !== undefined) message.modelId = overrides.modelId;
  return message;
}
