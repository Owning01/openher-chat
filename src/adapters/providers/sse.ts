/**
 * Parser SSE (text/event-stream) tolerante a chunks y a UTF-8 partido.
 * API elegida: `parseSseStream` es un async generator (consumible con
 * `for await`) y `parseSseText` devuelve un array para respuestas buffered.
 */

export interface SseEvent {
  /** Campo `event:` del bloque, solo si estaba presente. */
  event?: string;
  /** Campos `data:` del bloque unidos con `\n`. */
  data: string;
}

interface SseState {
  push(line: string): SseEvent | null;
  flush(): SseEvent | null;
}

interface ExtractedLine {
  line: string;
  rest: string;
}

/** Parser de un stream SSE byte a byte; nunca bufferiza más de una línea. */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state = createSseState();
  let buffer = '';
  let finished = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let extracted = extractLine(buffer);
      while (extracted !== null) {
        const event = state.push(extracted.line);
        if (event !== null) yield event;
        buffer = extracted.rest;
        extracted = extractLine(buffer);
      }
    }

    buffer += decoder.decode();
    if (buffer.endsWith('\r')) buffer = `${buffer.slice(0, -1)}\n`;
    let extracted = extractLine(buffer);
    while (extracted !== null) {
      const event = state.push(extracted.line);
      if (event !== null) yield event;
      buffer = extracted.rest;
      extracted = extractLine(buffer);
    }
    if (buffer !== '') {
      const event = state.push(buffer);
      if (event !== null) yield event;
    }
    const pending = state.flush();
    if (pending !== null) yield pending;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Parsea un texto SSE completo (p. ej. la respuesta buffered del fallback nativo). */
export function parseSseText(text: string): SseEvent[] {
  const state = createSseState();
  const events: SseEvent[] = [];
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  for (const line of normalized.split(/\r\n|\r|\n/)) {
    const event = state.push(line);
    if (event !== null) events.push(event);
  }
  const pending = state.flush();
  if (pending !== null) events.push(pending);
  return events;
}

function createSseState(): SseState {
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const dispatch = (): SseEvent | null => {
    const event = eventName;
    eventName = undefined;
    if (dataLines.length === 0) return null;
    const data = dataLines.join('\n');
    dataLines = [];
    return event === undefined ? { data } : { event, data };
  };

  return {
    push(line) {
      if (line === '') return dispatch();
      if (line.startsWith(':')) return null;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') dataLines.push(value);
      else if (field === 'event') eventName = value === '' ? undefined : value;
      return null;
    },
    flush: dispatch,
  };
}

/**
 * Extrae la primera línea completa (terminada en `\n`, `\r\n` o `\r`). Devuelve
 * `null` si no hay línea completa; un `\r` final espera al siguiente chunk para
 * no partir un `\r\n`.
 */
function extractLine(buffer: string): ExtractedLine | null {
  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (char === '\n') return { line: buffer.slice(0, index), rest: buffer.slice(index + 1) };
    if (char === '\r') {
      const next = buffer[index + 1];
      if (next === undefined) return null;
      return { line: buffer.slice(0, index), rest: buffer.slice(next === '\n' ? index + 2 : index + 1) };
    }
  }
  return null;
}
