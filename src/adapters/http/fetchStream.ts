import type { HttpError, StreamResult } from '@/domain/ports/HttpClient';
import { buildRequestHeaders, createHttpError, defaultFetch, serializeRequestBody } from './FetchHttpClient';
import type { FetchLike, FetchResponseLike } from './FetchHttpClient';

export interface StreamPostRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
}

/**
 * POST con `fetch` orientado a SSE: devuelve `{mode:'sse', stream}` cuando la
 * respuesta 2xx trae body, y `{mode:'buffered', status, text}` en cualquier otro
 * caso (status no 2xx o body ausente) para que el adapter decida. Solo lanza
 * `HttpError` (`network`/`aborted`) por fallo de red o abort.
 */
export async function postStream(r: StreamPostRequest, fetchImpl: FetchLike = defaultFetch): Promise<StreamResult> {
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(r.url, {
      method: 'POST',
      headers: buildRequestHeaders(r.headers, r.body !== undefined),
      body: serializeRequestBody(r.body),
      signal: r.signal,
    });
  } catch (error) {
    throw toStreamError(error, r.signal);
  }

  if (!response.ok || response.body === null) {
    let text = '';
    try {
      text = await response.text();
    } catch (error) {
      throw toStreamError(error, r.signal);
    }
    return { mode: 'buffered', status: response.status, text };
  }

  return { mode: 'sse', stream: response.body };
}

function toStreamError(error: unknown, signal: AbortSignal): HttpError {
  if (signal.aborted) return createHttpError('aborted', 'stream request aborted');
  if (error instanceof Error && error.name === 'AbortError') return createHttpError('aborted', 'stream request aborted');
  return createHttpError('network', error instanceof Error ? error.message : 'network request failed');
}
