import type { ChatMessage, Role } from '../types/chat';

/** Coincidencia de búsqueda full-text dentro de un mensaje. */
export interface MessageSearchHit {
  conversationId: string;
  messageId: string;
  role: Role;
  snippet: string;
  createdAt: number;
}

const SNIPPET_RADIUS = 48;

/** Texto plano buscable de un mensaje (solo bloques `text`). */
export function messagePlainText(message: ChatMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim() !== '') parts.push(block.text);
  }
  return parts.join('\n');
}

/** Busca `query` (case-insensitive) en los mensajes y devuelve los más recientes primero. */
export function searchMessages(
  messages: readonly ChatMessage[],
  query: string,
  limit: number,
): MessageSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '' || limit <= 0) return [];
  const hits: MessageSearchHit[] = [];
  for (const message of messages) {
    const text = messagePlainText(message);
    if (text === '') continue;
    const index = text.toLocaleLowerCase().indexOf(needle);
    if (index === -1) continue;
    hits.push({
      conversationId: message.conversationId,
      messageId: message.id,
      role: message.role,
      snippet: snippetAround(text, index, needle.length),
      createdAt: message.createdAt,
    });
  }
  return hits.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Recorta una ventana alrededor de la coincidencia (sin cortar palabras a media). */
export function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  const core = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${core}${end < text.length ? '…' : ''}`;
}
