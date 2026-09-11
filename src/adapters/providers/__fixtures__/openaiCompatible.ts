/**
 * Fixtures y fakes estructurales para los tests del adapter OpenAI-compatible.
 * Sin red: todo se inyecta a través de `AdapterDeps`.
 */

import type { HttpClient, HttpRequest, HttpResponse, StreamResult, StreamTransport } from '@/domain/ports/HttpClient';
import type { ChatCompletionRequest } from '@/domain/ports/ProviderAdapter';
import type { ProviderConfig } from '@/domain/types/provider';
import type { ToolDefinition } from '@/domain/types/tools';
import type { ProviderAdapterDeps } from '../openaiCompatible';

/** `now` determinista para mapHttpStatus (Retry-After en fecha HTTP). */
export const FIXED_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

export const TEST_API_KEY = 'test-key';

export function providerConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test-provider',
    label: 'Test Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    requiresKey: true,
    keyRef: 'provider:test-provider',
    models: [],
    defaultModelId: 'test-model',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function chatRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    modelId: 'test-model',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ],
    signal: new AbortController().signal,
    ...overrides,
  };
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  timeoutMs: 15_000,
  maxResultChars: 4_000,
  execute: async () => ({ ok: true, content: '', durationMs: 0 }),
};

// ---------------------------------------------------------------------------
// Fakes de transporte
// ---------------------------------------------------------------------------

export interface RecordedPost {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
}

export type TransportResponder = (request: RecordedPost) => StreamResult | Promise<StreamResult>;

export interface FakeTransport extends StreamTransport {
  readonly posts: RecordedPost[];
}

export function fakeTransport(responder: TransportResponder): FakeTransport {
  const posts: RecordedPost[] = [];
  return {
    posts,
    async post(request) {
      posts.push(request);
      return responder(request);
    },
  };
}

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

export function makeDeps(
  transport: StreamTransport,
  http: HttpClient,
  overrides: Partial<Omit<ProviderAdapterDeps, 'transport' | 'http'>> = {},
): ProviderAdapterDeps {
  return { transport, http, now: () => FIXED_NOW, apiKey: TEST_API_KEY, ...overrides };
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

export function sseResult(text: string): StreamResult {
  const encoder = new TextEncoder();
  return {
    mode: 'sse',
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
  };
}

export function bufferedResult(text: string, status = 200): StreamResult {
  return { mode: 'buffered', status, text };
}

/**
 * Stream que entrega un primer chunk y queda pendiente hasta que el adapter lo
 * cancele al abortar el signal (simula una conexión viva sin más datos).
 */
export function stalledStream(firstChunk: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(firstChunk));
        return;
      }
      return new Promise<void>((resolve) => {
        const settle = (): void => {
          if (!cancelled) controller.close();
          resolve();
        };
        if (signal.aborted) settle();
        else signal.addEventListener('abort', settle, { once: true });
      });
    },
    cancel() {
      cancelled = true;
    },
  });
}

export function erroringStream(chunks: string[], error: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const value = chunks[index];
      if (value === undefined) {
        controller.error(error);
        return;
      }
      controller.enqueue(encoder.encode(value));
      index += 1;
    },
  });
}

// ---------------------------------------------------------------------------
// Payloads SSE / completions
// ---------------------------------------------------------------------------

export function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const sseDone = 'data: [DONE]\n\n';

export function chunk(delta: Record<string, unknown>, finishReason: string | null = null): Record<string, unknown> {
  return { object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

export function usageChunk(usage: Record<string, number>): Record<string, unknown> {
  return { object: 'chat.completion.chunk', choices: [], usage };
}

/** Stream de texto completo: deltas + finish stop + [DONE]. */
export function textStream(...parts: string[]): string {
  return parts.map((part) => sseFrame(chunk({ content: part }))).join('') + sseFrame(chunk({}, 'stop')) + sseDone;
}
