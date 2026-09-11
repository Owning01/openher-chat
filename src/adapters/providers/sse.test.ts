import { describe, expect, it } from 'vitest';
import { parseSseStream, parseSseText } from './sse';
import type { SseEvent } from './sse';

const encoder = new TextEncoder();

function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of parseSseStream(stream)) events.push(event);
  return events;
}

describe('parseSseStream', () => {
  it('parsea un evento simple en un solo chunk', async () => {
    await expect(collect(streamOf(['data: hola\n\n']))).resolves.toEqual([{ data: 'hola' }]);
  });

  it('une una línea partida a mitad entre chunks', async () => {
    await expect(collect(streamOf(['data: ho', 'la mun', 'do\n\n']))).resolves.toEqual([{ data: 'hola mundo' }]);
  });

  it('soporta finales CRLF y CR solo', async () => {
    await expect(collect(streamOf(['data: uno\r\ndata: dos\r\r']))).resolves.toEqual([{ data: 'uno\ndos' }]);
  });

  it('ignora comentarios y líneas de campos desconocidos', async () => {
    await expect(collect(streamOf([': keep-alive\nid: 7\nretry: 1000\ndata: ok\n\n']))).resolves.toEqual([{ data: 'ok' }]);
  });

  it('une varios campos data con salto de línea', async () => {
    await expect(collect(streamOf(['data: linea 1\ndata: linea 2\ndata: linea 3\n\n']))).resolves.toEqual([
      { data: 'linea 1\nlinea 2\nlinea 3' },
    ]);
  });

  it('decodifica emoji partido a mitad de bytes entre chunks', async () => {
    const bytes = encoder.encode('data: 😀\n\n');
    await expect(collect(streamOf([bytes.slice(0, 8), bytes.slice(8)]))).resolves.toEqual([{ data: '😀' }]);
  });

  it('captura el campo event y lo resetea tras cada dispatch', async () => {
    await expect(collect(streamOf(['event: message\ndata: uno\n\ndata: dos\n\n']))).resolves.toEqual([
      { event: 'message', data: 'uno' },
      { data: 'dos' },
    ]);
  });

  it('hace flush del último evento al cerrar sin línea en blanco', async () => {
    await expect(collect(streamOf(['data: ultimo']))).resolves.toEqual([{ data: 'ultimo' }]);
  });

  it('procesa varios eventos dentro de un mismo chunk', async () => {
    await expect(collect(streamOf(['data: 1\n\ndata: 2\n\nevent: x\ndata: 3\n\n']))).resolves.toEqual([
      { data: '1' },
      { data: '2' },
      { event: 'x', data: '3' },
    ]);
  });

  it('conserva dos puntos y espacios internos del valor', async () => {
    await expect(collect(streamOf(['data: {"a":"b:c","d":" e "}\n\n']))).resolves.toEqual([
      { data: '{"a":"b:c","d":" e "}' },
    ]);
  });

  it('ignora bloques sin data (solo event o comentario)', async () => {
    await expect(collect(streamOf(['event: ping\n\n: nada\n\n']))).resolves.toEqual([]);
  });

  it('propaga el error del stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: x\n\n'));
        controller.error(new Error('boom'));
      },
    });
    await expect(collect(stream)).rejects.toThrow('boom');
  });

  it('cancela el stream si el consumidor corta la iteración', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: 1\n\n'));
        controller.enqueue(encoder.encode('data: 2\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    let count = 0;
    for await (const event of parseSseStream(stream)) {
      expect(event.data).toBe('1');
      count += 1;
      break;
    }
    expect(count).toBe(1);
    expect(cancelled).toBe(true);
  });
});

describe('parseSseText', () => {
  it('parsea texto completo con eventos múltiples y flush final', () => {
    expect(parseSseText('event: a\ndata: 1\n\ndata: 2\n\ndata: 3')).toEqual([
      { event: 'a', data: '1' },
      { data: '2' },
      { data: '3' },
    ]);
  });

  it('soporta CRLF, comentarios y data multilínea', () => {
    expect(parseSseText(': ping\r\ndata: x\r\ndata: y\r\n\r\n')).toEqual([{ data: 'x\ny' }]);
  });

  it('devuelve [] para texto vacío o sin data', () => {
    expect(parseSseText('')).toEqual([]);
    expect(parseSseText(': solo comentario\n\nevent: ping\n\n')).toEqual([]);
  });

  it('ignora un BOM inicial sin perder el primer evento', () => {
    expect(parseSseText('\uFEFFdata: primero\n\ndata: segundo\n\n')).toEqual([
      { data: 'primero' },
      { data: 'segundo' },
    ]);
  });
});
