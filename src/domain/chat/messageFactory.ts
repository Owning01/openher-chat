import type {
  ChatMessage,
  MessageContent,
  MessageError,
  MessageFinishReason,
  MessageStatus,
  TokenUsage,
  ToolResult,
} from '../types/chat';

export interface CreateUserMessageInput {
  id: string;
  conversationId: string;
  text: string;
  now: number;
}

/** Mensaje de usuario ya completo (el texto se persiste tal cual, sin markdown implícito). */
export function createUserMessage(input: CreateUserMessageInput): ChatMessage {
  return {
    id: input.id,
    conversationId: input.conversationId,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: input.text }],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface CreateAssistantMessageInput {
  id: string;
  conversationId: string;
  providerId: string;
  modelId: string;
  now: number;
}

/** Mensaje asistente vacío en estado `streaming`; los deltas se agregan después. */
export function createAssistantMessage(input: CreateAssistantMessageInput): ChatMessage {
  return {
    id: input.id,
    conversationId: input.conversationId,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: input.now,
    updatedAt: input.now,
    providerId: input.providerId,
    modelId: input.modelId,
  };
}

export interface CreateToolResultBlockInput {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
}

export function createToolResultBlock(input: CreateToolResultBlockInput): MessageContent {
  return {
    type: 'tool-result',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    result: input.result,
  };
}

export interface FinalizeMessagePatch {
  status: MessageStatus;
  finishReason?: MessageFinishReason;
  usage?: TokenUsage;
  error?: MessageError;
  /** Timestamp inyectado; si se omite se conserva el `updatedAt` previo. */
  now?: number;
}

/**
 * Cierra un mensaje de forma pura: devuelve una copia con status/finishReason/
 * usage/error aplicados. Los campos opcionales no informados conservan su valor.
 */
export function finalizeMessage(message: ChatMessage, patch: FinalizeMessagePatch): ChatMessage {
  const finalized: ChatMessage = { ...message, status: patch.status, updatedAt: patch.now ?? message.updatedAt };
  if (patch.finishReason !== undefined) finalized.finishReason = patch.finishReason;
  if (patch.usage !== undefined) finalized.usage = patch.usage;
  if (patch.error !== undefined) finalized.error = patch.error;
  return finalized;
}
