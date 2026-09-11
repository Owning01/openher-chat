import type { FetchHeadersLike, FetchResponseLike } from './FetchHttpClient';

export interface FakeResponseInit {
  status?: number;
  headers?: Array<[string, string]>;
  body?: ReadableStream<Uint8Array> | null;
  text?: string;
}

/** Respuesta estructural compatible con `FetchResponseLike` sin depender de `Response`. */
export function fakeResponse(init: FakeResponseInit = {}): FetchResponseLike {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersLike(init.headers ?? []),
    body: init.body ?? null,
    text: async () => init.text ?? '',
  };
}

export function headersLike(entries: Array<[string, string]>): FetchHeadersLike {
  return {
    forEach(callback) {
      for (const [key, value] of entries) callback(value, key);
    },
  };
}

/** Stream con chunks arbitrarios; los strings se codifican UTF-8. */
export function readableFrom(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}
