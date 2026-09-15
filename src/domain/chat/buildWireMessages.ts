import type { ChatMessage, MessageContent } from '../types/chat';
import type { WireImage, WireMessage } from '../types/stream';

export interface BuildWireMessagesInput {
  system?: string;
  history: ChatMessage[];
  userMessage: ChatMessage;
}

export interface BuildWireMessagesOptions {
  /**
   * El transporte/modelo acepta imágenes. Con `false` las imágenes se
   * degradan a descriptor de texto (`[imagen no soportada…]`) para no romper
   * al proveedor con un 400. Default `true` (comportamiento multimodal).
   */
  imagesSupported?: boolean;
}

/** Descriptor honesto cuando el modelo no acepta visión: conserva el nombre. */
export function unsupportedImageText(name: string): string {
  return `[imagen no soportada por este modelo: ${name}]`;
}

/**
 * Contenido sintético con el que se repara un `tool-call` sin su `tool-result`.
 * No simula ejecución: sólo declara que la tool no se ejecutó, para que el wire
 * siga siendo válido en proveedores que exigen una respuesta por cada call.
 */
export const ORPHAN_TOOL_RESULT_CONTENT = '[tool not executed: no result available]';

/**
 * Expande mensajes del dominio a `WireMessage[]` listos para cualquier adapter.
 * - system primero (si existe y no está vacío)
 * - assistant: texto + `toolCalls`; los bloques `tool-result` se emiten como rol `tool`
 * - `reasoning` se omite del wire (decisión: no todos los proveedores lo aceptan y
 *   no debe realimentar el contexto del modelo)
 * - el userMessage va siempre al final
 *
 * C1 (contrato del wire): la secuencia emitida es válida en AMBOS sentidos, incluso
 * para historiales ya corruptos persistidos en disco:
 * 1. Un `tool-call` sin `tool-result` se **repara** inyectando un mensaje `tool`
 *    sintético (`ORPHAN_TOOL_RESULT_CONTENT`) inmediatamente después del assistant
 *    que lo emitió. Descartar el call perdería información del turno y podría
 *    cambiar su semántica; el placeholder mantiene el par completo.
 * 2. Un mensaje `tool` cuyo `toolCallId` no tenga un `tool-call` precedente se
 *    **descarta**: no se puede fabricar un assistant call sin falsear la
 *    conversación ni el `toolCallId`.
 * 3. Respuestas duplicadas al mismo `tool-call` se descartan a partir de la segunda,
 *    porque también son inválidas para el proveedor.
 */
export function buildWireMessages(input: BuildWireMessagesInput, options: BuildWireMessagesOptions = {}): WireMessage[] {
  return sanitizeToolPairs(expandWireMessages(input, options.imagesSupported !== false));
}

function expandWireMessages(input: BuildWireMessagesInput, imagesSupported: boolean): WireMessage[] {
  const wires: WireMessage[] = [];
  if (input.system !== undefined && input.system.trim().length > 0) {
    wires.push({ role: 'system', content: input.system });
  }
  for (const message of input.history) appendMessage(wires, message, imagesSupported);
  appendMessage(wires, input.userMessage, imagesSupported);
  return wires;
}

/**
 * Garantiza el pairing `tool-call` ↔ `tool` en ambos sentidos. Recorre una sola vez:
 * los `tool-call` emitidos por wires assistant se recuerdan en orden; un wire `tool`
 * sólo se conserva si su id ya fue emitido y aún no estaba respondido. Al assistant
 * que emite un call sin respuesta disponible más adelante se le inyecta el
 * placeholder justo después.
 */
function sanitizeToolPairs(wires: WireMessage[]): WireMessage[] {
  const emittedCallIds = new Set<string>();
  const answeredCallIds = new Set<string>();
  const remainingResults = countToolResults(wires);
  const sanitized: WireMessage[] = [];

  for (const wire of wires) {
    if (wire.role === 'assistant' && wire.toolCalls !== undefined && wire.toolCalls.length > 0) {
      sanitized.push(wire);
      for (const call of wire.toolCalls) {
        emittedCallIds.add(call.id);
        if ((remainingResults.get(call.id) ?? 0) === 0) {
          answeredCallIds.add(call.id);
          sanitized.push({ role: 'tool', content: ORPHAN_TOOL_RESULT_CONTENT, toolCallId: call.id, toolName: call.name });
        }
      }
      continue;
    }

    if (wire.role === 'tool') {
      const remaining = remainingResults.get(wire.toolCallId) ?? 0;
      if (remaining > 0) remainingResults.set(wire.toolCallId, remaining - 1);
      if (emittedCallIds.has(wire.toolCallId) && !answeredCallIds.has(wire.toolCallId)) {
        answeredCallIds.add(wire.toolCallId);
        sanitized.push(wire);
      }
      continue;
    }

    sanitized.push(wire);
  }

  return sanitized;
}

function countToolResults(wires: WireMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const wire of wires) {
    if (wire.role === 'tool') counts.set(wire.toolCallId, (counts.get(wire.toolCallId) ?? 0) + 1);
  }
  return counts;
}

function appendMessage(wires: WireMessage[], message: ChatMessage, imagesSupported: boolean): void {
  if (message.role === 'assistant') {
    appendAssistant(wires, message.content);
    return;
  }
  const images = message.role === 'user' && imagesSupported ? collectImages(message.content) : [];
  const text = collectText(message.content, imagesSupported ? null : 'unsupported');
  if (text.length > 0 || images.length > 0) {
    wires.push(images.length > 0 ? { role: 'user', content: text, images } : { role: message.role, content: text });
  }
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

function collectText(blocks: MessageContent[], imageFallback: 'unsupported' | null): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') texts.push(block.text);
    else if (block.type === 'image' && imageFallback === 'unsupported') texts.push(unsupportedImageText(block.name));
  }
  // En degradación los bloques de texto vacíos ensuciarían el descriptor.
  const meaningful = imageFallback === 'unsupported' ? texts.filter((text) => text.trim() !== '') : texts;
  return meaningful.join('\n\n');
}

/** Imágenes del mensaje en orden; los bloques de asistente nunca las aportan. */
function collectImages(blocks: MessageContent[]): WireImage[] {
  const images: WireImage[] = [];
  for (const block of blocks) {
    if (block.type === 'image') images.push({ dataUrl: block.dataUrl, mime: block.mime, name: block.name });
  }
  return images;
}
