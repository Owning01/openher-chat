import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { HttpError } from '@/domain/ports/HttpClient';
import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';
import { FetchHttpClient, buildRequestHeaders, createHttpError, serializeRequestBody } from './FetchHttpClient';

/** Petición aceptada por el plugin nativo `CapacitorHttp` (subconjunto que usamos). */
export interface NativeHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: string;
  responseType: 'text';
  connectTimeout?: number;
  readTimeout?: number;
}

export interface NativeHttpResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}

export interface NativeHttpPlugin {
  request(options: NativeHttpRequest): Promise<NativeHttpResponse>;
}

export interface CapacitorHttpClientOptions {
  isNative?: () => boolean;
  nativeHttp?: NativeHttpPlugin;
  fallback?: HttpClient;
}

/**
 * `HttpClient` para Capacitor: en nativo usa `CapacitorHttp.request` (sin CORS
 * del WebView); en web delega en `FetchHttpClient`. Normaliza `{status, data,
 * headers}` a `HttpResponse` (data string si no lo es) y aplica timeout manual.
 *
 * `CapacitorHttp` no permite desactivar el seguimiento de redirects, por lo que
 * el control depende del transporte activo: `false` en nativo (`open_url` directo
 * se bloquea y exige un proxy de lectura) y `true` en web, donde el fallback
 * `FetchHttpClient` sí respeta `redirect`.
 */
export class CapacitorHttpClient implements HttpClient {
  readonly supportsRedirectControl: boolean;

  private readonly isNative: () => boolean;
  private readonly nativeHttp: NativeHttpPlugin;
  private readonly fallback: HttpClient;

  constructor(options: CapacitorHttpClientOptions = {}) {
    this.isNative = options.isNative ?? (() => Capacitor.isNativePlatform());
    this.nativeHttp = options.nativeHttp ?? CapacitorHttp;
    this.fallback = options.fallback ?? new FetchHttpClient();
    this.supportsRedirectControl = !this.isNative();
  }

  async request(r: HttpRequest): Promise<HttpResponse> {
    if (!this.isNative()) return this.fallback.request(r);
    return this.requestNative(r);
  }

  private async requestNative(r: HttpRequest): Promise<HttpResponse> {
    const callerSignal = r.signal;
    if (callerSignal?.aborted) throw createHttpError('aborted', 'request aborted');

    const bodyText = serializeRequestBody(r.body);
    const options: NativeHttpRequest = {
      url: r.url,
      method: r.method,
      headers: buildRequestHeaders(r.headers, bodyText !== undefined),
      responseType: 'text',
    };
    if (bodyText !== undefined) options.data = bodyText;
    if (r.timeoutMs !== undefined && r.timeoutMs > 0) {
      options.connectTimeout = r.timeoutMs;
      options.readTimeout = r.timeoutMs;
    }

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
      const native = await abortable(this.nativeHttp.request(options), controller.signal);
      return {
        status: native.status,
        headers: { ...native.headers },
        text: normalizeNativeData(native.data),
      };
    } catch (error) {
      if (callerSignal?.aborted) throw createHttpError('aborted', 'request aborted');
      if (timedOut) throw createHttpError('timeout', 'request timed out');
      if (error instanceof HttpError) throw error;
      throw createHttpError('network', error instanceof Error ? error.message : 'network request failed');
    } finally {
      if (timer !== null) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

function normalizeNativeData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  return JSON.stringify(data) ?? '';
}

/** Corre `promise` contra `signal`: si aborta, rechaza de inmediato con `HttpError`. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createHttpError('aborted', 'request aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createHttpError('aborted', 'request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
