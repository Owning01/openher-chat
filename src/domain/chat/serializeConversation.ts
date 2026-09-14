import type { ChatMessage, MessageContent, TokenUsage } from '../types/chat';
import type { Conversation } from '../types/conversation';

/** Formato portable de una conversación (round-trip JSON). */
export interface ConversationArchive {
  version: 1;
  exportedAt: number;
  conversation: {
    title: string;
    providerId: string | null;
    modelId: string | null;
    systemPromptOverride: string | null;
    researchMode: boolean;
  };
  messages: ChatMessage[];
}

/** Markdown legible para compartir/archivar (no round-trip). */
export function conversationToMarkdown(conversation: Conversation, messages: ChatMessage[]): string {
  const title = conversation.title.trim() === '' ? 'Conversation' : conversation.title.trim();
  const lines: string[] = [`# ${title}`, ''];
  const meta: string[] = [`Messages: ${messages.length}`];
  if (conversation.modelId !== null && conversation.modelId !== '') meta.push(`Model: ${conversation.modelId}`);
  if (conversation.researchMode) meta.push('Research mode: on');
  lines.push(meta.join(' · '), '');

  for (const message of messages) {
    lines.push(`## ${message.role === 'user' ? 'User' : 'Assistant'}`, '');
    if (message.status === 'error' && message.error !== undefined) {
      lines.push(`> Error (${message.error.code}): ${message.error.message}`, '');
    }
    for (const block of message.content) {
      appendBlock(lines, block);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function appendBlock(lines: string[], block: MessageContent): void {
  switch (block.type) {
    case 'text':
      lines.push(block.text.trim(), '');
      break;
    case 'reasoning':
      lines.push('> Reasoning:', ...block.text.split('\n').map((line) => `> ${line}`), '');
      break;
    case 'tool-call':
      lines.push(`- Tool \`${block.toolCall.name}\` \`${block.toolCall.argumentsText}\``);
      break;
    case 'tool-result': {
      const status = block.result.ok ? 'ok' : `error:${block.result.error?.code ?? 'unknown'}`;
      lines.push(`- Tool result \`${block.toolName}\` (${status}):`, '', block.result.content.trim(), '');
      if (block.result.sources !== undefined && block.result.sources.length > 0) {
        lines.push('Sources:');
        block.result.sources.forEach((source, index) => {
          lines.push(`${index + 1}. [${source.title}](${source.url})`);
        });
        lines.push('');
      }
      break;
    }
  }
}

/** JSON portable para backup/restore; el llamador remapea ids al importar. */
export function conversationToArchive(conversation: Conversation, messages: ChatMessage[], now: number): ConversationArchive {
  return {
    version: 1,
    exportedAt: now,
    conversation: {
      title: conversation.title,
      providerId: conversation.providerId,
      modelId: conversation.modelId,
      systemPromptOverride: conversation.systemPromptOverride,
      researchMode: conversation.researchMode,
    },
    messages: messages.map(cloneMessage),
  };
}

export function conversationToJson(conversation: Conversation, messages: ChatMessage[], now: number): string {
  return JSON.stringify(conversationToArchive(conversation, messages, now), null, 2);
}

/**
 * Parser tolerante de un archivo importado (JSON). Devuelve `null` si no es un
 * archivo válido; el llamador asigna ids nuevos de conversación/mensajes.
 */
export function parseConversationArchive(text: string): ConversationArchive | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  const convo = root === null ? null : asRecord(root.conversation);
  if (root === null || convo === null || !Array.isArray(root.messages)) return null;
  const messages: ChatMessage[] = [];
  for (const entry of root.messages) {
    const message = normalizeMessage(asRecord(entry));
    if (message !== null) messages.push(message);
  }
  if (messages.length === 0) return null;
  return {
    version: 1,
    exportedAt: typeof root.exportedAt === 'number' ? root.exportedAt : 0,
    conversation: {
      title: asString(convo.title) ?? '',
      providerId: asNullableString(convo.providerId),
      modelId: asNullableString(convo.modelId),
      systemPromptOverride: asNullableString(convo.systemPromptOverride),
      researchMode: convo.researchMode === true,
    },
    messages,
  };
}

function normalizeMessage(record: Record<string, unknown> | null): ChatMessage | null {
  if (record === null) return null;
  const role = record.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const content = Array.isArray(record.content) ? record.content.filter(isContentBlock) : [];
  if (content.length === 0) return null;
  return {
    id: asString(record.id) ?? '',
    conversationId: asString(record.conversationId) ?? '',
    role,
    status: 'complete',
    content,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    ...(asString(record.providerId) !== null ? { providerId: asString(record.providerId) as string } : {}),
    ...(asString(record.modelId) !== null ? { modelId: asString(record.modelId) as string } : {}),
    ...(isUsage(record.usage) ? { usage: record.usage } : {}),
  };
}

function isContentBlock(value: unknown): value is MessageContent {
  const block = asRecord(value);
  if (block === null) return false;
  return block.type === 'text' || block.type === 'reasoning' || block.type === 'tool-call' || block.type === 'tool-result';
}

function isUsage(value: unknown): value is TokenUsage {
  return asRecord(value) !== null;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return JSON.parse(JSON.stringify(message)) as ChatMessage;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text !== null && text !== '' ? text : null;
}
