/** Error de transporte HTTP normalizado (lo lanzan los HttpClient concretos). */
export class HttpError extends Error {
  kind!: 'network' | 'timeout' | 'aborted';
  status?: number;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface HttpClient {
  request(r: HttpRequest): Promise<HttpResponse>;
}

export type StreamResult =
  | { mode: 'sse'; stream: ReadableStream<Uint8Array> }
  | { mode: 'buffered'; status: number; text: string };

export interface StreamTransport {
  post(r: { url: string; headers: Record<string, string>; body: unknown; signal: AbortSignal }): Promise<StreamResult>;
}
