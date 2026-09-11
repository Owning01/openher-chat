import type { MessageErrorCode } from '@/domain/types/chat';

export interface ProviderErrorOptions {
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
}

/** Error normalizado de un proveedor LLM, listo para mapear a `MessageError`. */
export class ProviderError extends Error {
  readonly code: MessageErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, code: MessageErrorCode, options: ProviderErrorOptions) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Mapea un status HTTP de proveedor a `ProviderError`. `now` permite tests
 * deterministas del `Retry-After` en formato fecha HTTP.
 */
export function mapHttpStatus(status: number, bodyText: string, retryAfterHeader?: string | null, now = Date.now()): ProviderError {
  const detail = extractErrorMessage(bodyText);

  if (status === 401 || status === 403) {
    return new ProviderError(detail ?? `HTTP ${status}`, 'auth', { retryable: false, status });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader, now);
    return new ProviderError(detail ?? 'HTTP 429', 'rate_limit', { retryable: true, status, retryAfterMs });
  }
  if (status === 408) {
    return new ProviderError(detail ?? 'HTTP 408', 'timeout', { retryable: true, status });
  }
  if (status === 400) {
    const lower = bodyText.toLowerCase();
    if (lower.includes('context_length_exceeded') || lower.includes('context length')) {
      return new ProviderError(detail ?? 'HTTP 400', 'context_length', { retryable: false, status });
    }
    return new ProviderError(detail ?? 'HTTP 400', 'invalid_request', { retryable: false, status });
  }
  if (status === 404) {
    return new ProviderError(detail ?? 'HTTP 404', 'invalid_request', { retryable: false, status });
  }
  if (status >= 500 && status <= 599) {
    return new ProviderError(detail ?? `HTTP ${status}`, 'server', { retryable: true, status });
  }
  if (status >= 400 && status <= 499) {
    return new ProviderError(detail ?? `HTTP ${status}`, 'invalid_request', { retryable: false, status });
  }
  return new ProviderError(detail ?? `HTTP ${status}`, 'unknown', { retryable: false, status });
}

/** Acepta segundos (`"30"`) o fecha HTTP (`"Wed, 21 Oct 2015 07:28:00 GMT"`). */
function parseRetryAfterMs(header: string | null | undefined, now: number): number | undefined {
  if (header === null || header === undefined) return undefined;
  const value = header.trim();
  if (value === '') return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

/** Extrae `error.message`/`message`/`error` de un body JSON; si no, el texto crudo. */
function extractErrorMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  return pickMessage(parsed) ?? trimmed;
}

function pickMessage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object') {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }
  return null;
}
