import { HttpError } from '@/domain/ports/HttpClient';
import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { ToolExecutionContext } from '@/domain/types/tools';

export const FIXED_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

export type HttpResponder = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export interface FakeHttpClient extends HttpClient {
  readonly requests: HttpRequest[];
}

export function fakeHttp(responder: HttpResponder): FakeHttpClient {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      return responder(request);
    },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, text: JSON.stringify(body) };
}

export function textResponse(text: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, text };
}

export function httpError(kind: 'network' | 'timeout' | 'aborted', message: string = kind): HttpError {
  const error = new HttpError(message);
  error.kind = kind;
  return error;
}

export class MemoryKeyVault implements KeyVault {
  private readonly store = new Map<string, string>();

  has(ref: string): Promise<boolean> {
    return Promise.resolve(this.store.has(ref));
  }

  get(ref: string): Promise<string | null> {
    return Promise.resolve(this.store.get(ref) ?? null);
  }

  set(ref: string, secret: string): Promise<void> {
    this.store.set(ref, secret);
    return Promise.resolve();
  }

  remove(ref: string): Promise<void> {
    this.store.delete(ref);
    return Promise.resolve();
  }
}

export function keyVaultWith(entries: Record<string, string>): MemoryKeyVault {
  const vault = new MemoryKeyVault();
  for (const [ref, secret] of Object.entries(entries)) {
    void vault.set(ref, secret);
  }
  return vault;
}

export function toolContext(): ToolExecutionContext {
  return { signal: new AbortController().signal, conversationId: 'conv-test' };
}
