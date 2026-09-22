import type { ChatMessage, MessageContent } from '../types/chat';
import type { ToolDefinition } from '../types/tools';

/** Overhead fijo por mensaje (rol + delimitadores). */
export const TOKENS_PER_MESSAGE = 4;
/** Overhead fijo por bloque de contenido. */
export const TOKENS_PER_BLOCK = 4;
/**
 * Estimación fija por imagen comprimida (~1568px): los proveedores cobran la
 * visión por tiles, no por bytes del dataUrl; 1200 es una cota conservadora
 * documentada para el presupuesto de contexto (nunca exacta).
 */
export const TOKENS_PER_IMAGE = 1200;

/**
 * Longitud en bytes UTF-8 calculada sin APIs de entorno (puro JS), para que el
 * dominio funcione igual en Node, jsdom y nativo.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Heurística de tokens: max(1, ceil(bytes UTF-8 / 4)). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(utf8ByteLength(text) / 4));
}

/** Estimación de un bloque: texto/razonamiento, args de tool-call o contenido de tool-result. */
export function estimateBlockTokens(block: MessageContent): number {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return estimateTokens(block.text) + TOKENS_PER_BLOCK;
    case 'tool-call':
      return estimateTokens(block.toolCall.name) + estimateTokens(block.toolCall.argumentsText) + TOKENS_PER_BLOCK;
    case 'tool-result':
      return estimateTokens(block.result.content) + TOKENS_PER_BLOCK;
    case 'image':
      return TOKENS_PER_IMAGE + TOKENS_PER_BLOCK;
  }
}

export function estimateMessageTokens(message: ChatMessage): number {
  let total = TOKENS_PER_MESSAGE;
  for (const block of message.content) total += estimateBlockTokens(block);
  return total;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}

/** Estimación del bloque de tools: JSON de los schemas / 4 (0 si no hay tools). */
export function estimateToolsTokens(tools: ToolDefinition[]): number {
  if (tools.length === 0) return 0;
  let bytes = 0;
  for (const tool of tools) {
    bytes += utf8ByteLength(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  }
  return Math.ceil(bytes / 4);
}

export interface ContextBreakdown {
  totalTokens: number;
  userTokens: number;
  assistantTokens: number;
  toolTokens: number;
  summaryTokens: number;
  systemTokens: number;
  messageCount: number;
  userCount: number;
  assistantCount: number;
  autocompactThreshold: number;
  percentage: number;
}

/** Desglose detallado del contexto activo y consumo respecto al umbral de 250k. */
export function computeContextBreakdown(input: {
  messages: readonly ChatMessage[];
  systemTokens?: number;
  summary?: string;
  tools?: readonly ToolDefinition[];
  autocompactThreshold?: number;
}): ContextBreakdown {
  const threshold = input.autocompactThreshold ?? 250_000;
  let userTokens = 0;
  let assistantTokens = 0;
  let toolTokens = 0;
  let userCount = 0;
  let assistantCount = 0;

  for (const msg of input.messages) {
    if (msg.role === 'user') {
      userCount += 1;
      userTokens += estimateMessageTokens(msg);
    } else if (msg.role === 'assistant') {
      assistantCount += 1;
      let regularTokens = 0;
      for (const block of msg.content) {
        const bTokens = estimateBlockTokens(block);
        if (block.type === 'tool-call' || block.type === 'tool-result') {
          toolTokens += bTokens;
        } else {
          regularTokens += bTokens;
        }
      }
      assistantTokens += regularTokens + TOKENS_PER_MESSAGE;
    }
  }

  const systemTokens = (input.systemTokens ?? 0) + estimateToolsTokens([...(input.tools ?? [])]);
  const summaryTokens =
    input.summary && input.summary.trim() !== ''
      ? estimateTokens(input.summary) + TOKENS_PER_MESSAGE
      : 0;

  const totalTokens = userTokens + assistantTokens + toolTokens + summaryTokens + systemTokens;
  const percentage = Math.min(100, Math.round((totalTokens / threshold) * 100));

  return {
    totalTokens,
    userTokens,
    assistantTokens,
    toolTokens,
    summaryTokens,
    systemTokens,
    messageCount: input.messages.length,
    userCount,
    assistantCount,
    autocompactThreshold: threshold,
    percentage,
  };
}
