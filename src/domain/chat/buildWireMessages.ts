import type { ChatMessage, MessageContent } from '../types/chat';
import type { WireMessage } from '../types/stream';

export interface BuildWireMessagesInput {
  system?: string;
  history: ChatMessage[];
  userMessage: ChatMessage;
}

/**
 * Expande mensajes del dominio a `WireMessage[]` listos para cualquier adapter.
 * - system primero (si existe y no está vacío)
 * - assistant: texto + `toolCalls`; los bloques `tool-result` se emiten como rol `tool`
 * - `reasoning` se omite del wire (decisión: no todos los proveedores lo aceptan y
 *   no debe realimentar el contexto del modelo)
 * - el userMessage va siempre al final
 */
export function buildWireMessages(input: BuildWireMessagesInput): WireMessage[] {
  const wires: WireMessage[] = [];
  if (input.system !== undefined && input.system.trim().length > 0) {
    wires.push({ role: 'system', content: input.system });
  }
  for (const message of input.history) appendMessage(wires, message);
  appendMessage(wires, input.userMessage);
  return wires;
}

function appendMessage(wires: WireMessage[], message: ChatMessage): void {
  if (message.role === 'assistant') {
    appendAssistant(wires, message.content);
    return;
  }
  const text = collectText(message.content);
  if (text.length > 0) wires.push({ role: message.role, content: text });
  appendToolResults(wires, message.content);
}

function appendAssistant(wires: WireMessage[], blocks: MessageContent[]): void {
  let texts: string[] = [];
  let toolCalls: { id: string; name: string; argumentsText: string }[] = [];

  const flush = (): void => {
    if (texts.length === 0 && toolCalls.length === 0) return;
    const wire: WireMessage = { role: 'assistant', content: texts.join('\n\n') };
    if (toolCalls.length > 0) wire.toolCalls = toolCalls;
    wires.push(wire);
    texts = [];
    toolCalls = [];
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        texts.push(block.text);
        break;
      case 'tool-call':
        toolCalls.push({ id: block.toolCall.id, name: block.toolCall.name, argumentsText: block.toolCall.argumentsText });
        break;
      case 'tool-result':
        flush();
        wires.push({ role: 'tool', content: block.result.content, toolCallId: block.toolCallId, toolName: block.toolName });
        break;
      case 'reasoning':
        // Omitido del wire a propósito.
        break;
    }
  }
  flush();
}

function appendToolResults(wires: WireMessage[], blocks: MessageContent[]): void {
  for (const block of blocks) {
    if (block.type === 'tool-result') {
      wires.push({ role: 'tool', content: block.result.content, toolCallId: block.toolCallId, toolName: block.toolName });
    }
  }
}

function collectText(blocks: MessageContent[]): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') texts.push(block.text);
  }
  return texts.join('\n\n');
}
