/** Error de transporte HTTP normalizado (lo lanzan los HttpClient concretos). */
export class HttpError extends Error {
  kind!: 'network' | 'timeout' | 'aborted';
  status?: number;
}

/** Política de seguimiento de redirects que puede pedir el caller (default `'follow'`). */
export type RedirectMode = 'follow' | 'error' | 'manual';

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** `'manual'` permite inspeccionar 3xx/opaque en vez de seguirlos. Default `'follow'`. */
  redirect?: RedirectMode;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface HttpClient {
  request(r: HttpRequest): Promise<HttpResponse>;
  /**
   * `true` si el transporte respeta `HttpRequest.redirect`; `false` si sigue
   * redirects sin control (Capacitor nativo). `undefined` = capacidad no declarada.
   */
  readonly supportsRedirectControl?: boolean;
}

export type StreamResult =
  | { mode: 'sse'; stream: ReadableStream<Uint8Array> }
  | { mode: 'buffered'; status: number; text: string };

export interface StreamTransport {
  post(r: { url: string; headers: Record<string, string>; body: unknown; signal: AbortSignal }): Promise<StreamResult>;
}
