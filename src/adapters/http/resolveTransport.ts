import { Capacitor } from '@capacitor/core';
import { HttpError } from '@/domain/ports/HttpClient';
import type { StreamResult, StreamTransport } from '@/domain/ports/HttpClient';
import { CapacitorHttpClient } from './CapacitorHttpClient';
import { postStream } from './fetchStream';
import type { StreamPostRequest } from './fetchStream';
import type { FetchLike } from './FetchHttpClient';

/** Respuesta completa del fallback nativo (CapacitorHttp no expone streaming). */
export interface BufferedStreamResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export type NativeBufferedPost = (r: StreamPostRequest) => Promise<BufferedStreamResponse>;

export interface StreamTransportDeps {
  fetchImpl?: FetchLike;
  postStreamImpl?: (r: StreamPostRequest) => Promise<StreamResult>;
  capacitorHttpImpl?: NativeBufferedPost;
  isNative?: () => boolean;
}

/**
 * Crea el `StreamTransport` de la app: intenta fetch+streaming y, en nativo,
 * reintenta la misma request con `CapacitorHttp` (buffered) solo si el intento
 * anterior falló antes de consumir un solo byte. En web no hay fallback; un
 * fallo se propaga tal cual. Nunca reintenta después del primer byte.
 */
export function createStreamTransport(deps: StreamTransportDeps = {}): StreamTransport {
  const isNative = deps.isNative ?? (() => Capacitor.isNativePlatform());
  const postStreamImpl = deps.postStreamImpl ?? ((r: StreamPostRequest) => postStream(r, deps.fetchImpl));
  const capacitorHttpImpl = deps.capacitorHttpImpl ?? createCapacitorPost();

  return {
    async post(r: StreamPostRequest): Promise<StreamResult> {
      try {
        return await postStreamImpl(r);
      } catch (error) {
        if (!isNative() || r.signal.aborted || isAbortError(error)) throw error;
        const buffered = await capacitorHttpImpl(r);
        return { mode: 'buffered', status: buffered.status, text: buffered.text };
      }
    },
  };
}

function createCapacitorPost(): NativeBufferedPost {
  const client = new CapacitorHttpClient({ isNative: () => true });
  return async (r) => client.request({ url: r.url, method: 'POST', headers: r.headers, body: r.body, signal: r.signal });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof HttpError) return error.kind === 'aborted';
  return error instanceof Error && error.name === 'AbortError';
}
