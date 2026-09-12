import { HttpError } from '@/domain/ports/HttpClient';
import type { ToolErrorCode } from '@/domain/types/chat';

/** Error tipado de ejecución de tools; el registry lo traduce a `ToolResult.error`. */
export class ToolExecutionError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
  }
}

export const CORS_BLOCKED_MESSAGE =
  'The browser blocked the request (CORS). Configure a search proxy in Settings, or use the Android app where direct requests are allowed.';
export const PROXY_UNREACHABLE_MESSAGE =
  'Could not reach the configured search proxy. Check the proxy URL and that it is running.';
export const PROXY_CORS_MESSAGE = `${PROXY_UNREACHABLE_MESSAGE} If the proxy is online, the browser may be blocking it with CORS.`;
export const NETWORK_FAILURE_MESSAGE = 'The network request failed. Check the connection and try again.';

export interface TransportErrorContext {
  browser: boolean;
  proxied: boolean;
}

/** Traduce errores de transporte a `{ code, message }` accionable para el modelo. */
export function mapTransportError(error: unknown, context: TransportErrorContext): { code: ToolErrorCode; message: string } {
  if (error instanceof ToolExecutionError) return { code: error.code, message: error.message };
  if (error instanceof HttpError) {
    if (error.kind === 'timeout') return { code: 'timeout', message: 'The request timed out. Try again.' };
    if (error.kind === 'network') {
      if (context.proxied) {
        return context.browser
          ? { code: 'cors_blocked', message: PROXY_CORS_MESSAGE }
          : { code: 'network', message: PROXY_UNREACHABLE_MESSAGE };
      }
      if (context.browser) return { code: 'cors_blocked', message: CORS_BLOCKED_MESSAGE };
      return { code: 'network', message: NETWORK_FAILURE_MESSAGE };
    }
    return { code: 'network', message: 'The request was aborted.' };
  }
  if (error instanceof Error) return { code: 'network', message: error.message };
  return { code: 'network', message: NETWORK_FAILURE_MESSAGE };
}
