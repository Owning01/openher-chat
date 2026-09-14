import { applyCitationMarkers, extractCitations, verifyCitations } from '../legal/citation';
import { DOCUMENT_SOURCE_DISCLAIMER, DOCUMENT_WATERMARK } from '../legal/document';
import type { CitationGuardResult, CitationVerdict, LegalIndex } from '../types/legal';
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
    /** Vínculo caso↔conversación; ausente = general (round-trip del modo legal). */
    legalCaseId?: string | null;
  };
  messages: ChatMessage[];
}

/** Opciones de exportación a Markdown (el índice es opcional y nunca se persiste). */
export interface ConversationMarkdownOptions {
  /** Índice para verificar citas; ausente/`null` = guard conservador `[VERIFICAR]`. */
  index?: LegalIndex | null;
}

/**
 * Markdown legible para compartir/archivar (no round-trip).
 *
 * En conversaciones legales (`legalCaseId != null`) aplica el guard de citas a
 * los bloques de texto, impone el watermark de borrador y el disclaimer de
 * fuente. El texto guardado queda crudo: las marcas son de presentación y se
 * recalculan en cada exportación (re-verificables tras actualizar un pack).
 *
 * Límites conocidos del guard:
 * - La paráfrasis sin entrecomillar no se detecta: la existencia puede quedar
 *   `verified` aunque el texto no sea textual (cotejo humano obligatorio).
 * - Sin índice se marca conservadoramente toda cita detectada con `[VERIFICAR]`.
 * - Fallos, doctrina y expedientes siempre quedan `[VERIFICAR]` (nunca se
 *   redistribuye ni se valida jurisprudencia).
 */
export function conversationToMarkdown(
  conversation: Conversation,
  messages: ChatMessage[],
  options: ConversationMarkdownOptions = {},
): string {
  const isLegal = conversation.legalCaseId != null;
  const title = conversation.title.trim() === '' ? 'Conversation' : conversation.title.trim();
  const lines: string[] = [`# ${title}`, ''];
  if (isLegal) {
    lines.push(`> ${DOCUMENT_WATERMARK}`, '');
  }
  const meta: string[] = [`Messages: ${messages.length}`];
  if (conversation.modelId !== null && conversation.modelId !== '') meta.push(`Model: ${conversation.modelId}`);
  if (conversation.researchMode) meta.push('Research mode: on');
  if (isLegal) meta.push('Legal mode: on');
  lines.push(meta.join(' · '), '');

  for (const message of messages) {
    lines.push(`## ${message.role === 'user' ? 'User' : 'Assistant'}`, '');
    if (message.status === 'error' && message.error !== undefined) {
      lines.push(`> Error (${message.error.code}): ${message.error.message}`, '');
    }
    for (const block of message.content) {
      appendBlock(lines, block, isLegal ? options.index ?? null : null, isLegal);
    }
    lines.push('');
  }

  if (isLegal) {
    lines.push('---', '');
    lines.push(`> ${DOCUMENT_SOURCE_DISCLAIMER}`, '');
    lines.push('> Borrador para revisión profesional: las citas marcadas [VERIFICAR] no están confirmadas.', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function appendBlock(lines: string[], block: MessageContent, index: LegalIndex | null, guard: boolean): void {
  switch (block.type) {
    case 'text':
      lines.push(guard ? guardLegalText(block.text, index).trim() : block.text.trim(), '');
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

/** Aplica el guard a un texto: con índice verifica, sin índice marca conservador. */
function guardLegalText(text: string, index: LegalIndex | null): string {
  if (index !== null) {
    try {
      return applyCitationMarkers(text, verifyCitations(text, index));
    } catch {
      return conservativeMark(text);
    }
  }
  return conservativeMark(text);
}

/** Sin índice: toda cita detectada se marca `[VERIFICAR]` (nunca `verified`). */
function conservativeMark(text: string): string {
  try {
    const refs = extractCitations(text);
    if (refs.length === 0) return text;
    const verdicts: CitationVerdict[] = refs.map((citation) => ({
      status: 'unverified',
      citation,
      reason: 'no-index',
    }));
    const result: CitationGuardResult = {
      verdicts,
      verified: 0,
      unverified: verdicts.length,
      malformed: 0,
    };
    return applyCitationMarkers(text, result);
  } catch {
    return text;
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
      ...(conversation.legalCaseId != null ? { legalCaseId: conversation.legalCaseId } : {}),
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
 * `legalCaseId` se restaura sólo si es un string no vacío (ausente = general).
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
  const legalCaseId = readLegalCaseId(convo.legalCaseId);
  return {
    version: 1,
    exportedAt: typeof root.exportedAt === 'number' ? root.exportedAt : 0,
    conversation: {
      title: asString(convo.title) ?? '',
      providerId: asNullableString(convo.providerId),
      modelId: asNullableString(convo.modelId),
      systemPromptOverride: asNullableString(convo.systemPromptOverride),
      researchMode: convo.researchMode === true,
      ...(legalCaseId === undefined ? {} : { legalCaseId }),
    },
    messages,
  };
}

/** Lee el vínculo legal: string no vacío ⇒ caso; cualquier otra cosa ⇒ ausente (general). */
function readLegalCaseId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() !== '' ? value : undefined;
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
