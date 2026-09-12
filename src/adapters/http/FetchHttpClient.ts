import { HttpError } from '@/domain/ports/HttpClient';
import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';

/** Cabeceras con la única operación que consumen los clientes (compatible con `Headers`). */
export interface FetchHeadersLike {
  forEach(callback: (value: string, key: string) => void): void;
}

/** Respuesta mínima que necesitan los clientes; `Response` la satisface estructuralmente. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: FetchHeadersLike;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  /** Default `'follow'`; se propaga tal cual cuando el caller lo especifica. */
  redirect?: 'follow' | 'error' | 'manual';
}

/** `fetch` en forma inyectable y estructural (real o fake en tests). */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>;

/** `fetch` global resuelto en cada llamada para tolerar entornos que lo instalan tarde. */
export const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

/** Construye un `HttpError` del dominio con `kind` y `status` opcional. */
export function createHttpError(kind: HttpError['kind'], message: string, status?: number): HttpError {
  const error = new HttpError(message);
  error.kind = kind;
  if (status !== undefined) error.status = status;
  return error;
}

/** Serializa el body: strings tal cual, objetos a JSON, `undefined` sin body. */
export function serializeRequestBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/** Copia los headers y agrega `Content-Type: application/json` si hay body sin content-type. */
export function buildRequestHeaders(headers: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
  const result: Record<string, string> = { ...headers };
  if (!hasBody) return result;
  const alreadySet = Object.keys(result).some((key) => key.toLowerCase() === 'content-type');
  if (!alreadySet) result['Content-Type'] = 'application/json';
  return result;
}

export interface FetchHttpClientOptions {
  fetchImpl?: FetchLike;
}

/**
 * `HttpClient` sobre `fetch` con timeout manual combinado con el signal del caller.
 * Respeta `HttpRequest.redirect` (`supportsRedirectControl = true`). No lanza por
 * status HTTP (devuelve `HttpResponse` con status/text/headers); lanza `HttpError`
 * con `kind` `network`/`timeout`/`aborted`.
 */
export class FetchHttpClient implements HttpClient {
  readonly supportsRedirectControl = true;

  private readonly fetchImpl: FetchLike;

  constructor(options: FetchHttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  async request(r: HttpRequest): Promise<HttpResponse> {
    const callerSignal = r.signal;
    if (callerSignal?.aborted) throw createHttpError('aborted', 'request aborted');

    const bodyText = serializeRequestBody(r.body);
    const controller = new AbortController();
    const timeoutMs = r.timeoutMs !== undefined && r.timeoutMs > 0 ? r.timeoutMs : null;
    let timedOut = false;
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (callerSignal !== undefined) callerSignal.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await this.fetchImpl(r.url, {
        method: r.method,
        headers: buildRequestHeaders(r.headers, bodyText !== undefined),
        body: bodyText,
        signal: controller.signal,
        redirect: r.redirect ?? 'follow',
      });
      const text = await response.text();
      return { status: response.status, headers: collectHeaders(response.headers), text };
    } catch (error) {
      throw toTransportError(error, callerSignal, timedOut);
    } finally {
      if (timer !== null) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

function collectHeaders(headers: FetchHeadersLike): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function toTransportError(error: unknown, callerSignal: AbortSignal | undefined, timedOut: boolean): HttpError {
  if (callerSignal?.aborted) return createHttpError('aborted', 'request aborted');
  if (timedOut) return createHttpError('timeout', 'request timed out');
  if (error instanceof HttpError) return error;
  return createHttpError('network', error instanceof Error ? error.message : 'network request failed');
}
