/**
 * Fixtures y fakes para los tests del adapter OpenAI Responses. Reutiliza los
 * helpers genéricos del fixture de openaiCompatible y añade builders de los
 * eventos `response.*`. Sin red: todo se inyecta por `AdapterDeps`.
 */

import type { AdapterDeps, ChatCompletionRequest } from '@/domain/ports/ProviderAdapter';
import type { HttpClient, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderConfig } from '@/domain/types/provider';
import { FIXED_NOW, TEST_API_KEY } from './openaiCompatible';

export {
  bufferedResult,
  erroringStream,
  fakeHttp,
  fakeTransport,
  jsonResponse,
  sseFrame,
  sseResult,
  stalledStream,
  FIXED_NOW,
  TEST_API_KEY,
} from './openaiCompatible';

export type { FakeHttpClient, FakeTransport, RecordedPost } from './openaiCompatible';

export function responsesConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test-responses',
    label: 'Test Responses',
    kind: 'openai-responses',
    baseUrl: 'https://api.example.com/v1',
    requiresKey: true,
    keyRef: 'provider:test-responses',
    models: [],
    defaultModelId: 'test-model',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function responsesChatRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
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

export function makeResponsesDeps(
  transport: StreamTransport,
  http: HttpClient,
  overrides: Partial<Omit<AdapterDeps, 'transport' | 'http'>> = {},
): AdapterDeps {
  return { transport, http, now: () => FIXED_NOW, apiKey: TEST_API_KEY, ...overrides };
}

// ---------------------------------------------------------------------------
// Builders de eventos SSE de Responses
// ---------------------------------------------------------------------------

/** Frame con `event:` nombrado y `payload.type` (como el gateway real). */
export function responsesFrame(type: string, payload: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

/** Frame sin `event:` (el tipo viaja solo en `payload.type`). */
export function responsesData(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function textDelta(delta: string): string {
  return responsesFrame('response.output_text.delta', { delta });
}

export function reasoningDelta(delta: string): string {
  return responsesFrame('response.reasoning_summary_text.delta', { delta });
}

export function reasoningTextDelta(delta: string): string {
  return responsesFrame('response.reasoning_text.delta', { delta });
}

export function functionCallArgsDelta(itemId: string, outputIndex: number, delta: string): string {
  return responsesFrame('response.function_call_arguments.delta', {
    item_id: itemId,
    output_index: outputIndex,
    delta,
  });
}

export function outputItemDone(item: Record<string, unknown>, outputIndex = 0): string {
  return responsesFrame('response.output_item.done', { output_index: outputIndex, item });
}

export function responseCompleted(payload: Record<string, unknown> = {}): string {
  return responsesFrame('response.completed', { response: { output: [], ...payload } });
}

export function responseFailed(message: string, type = 'server_error'): string {
  return responsesFrame('response.failed', { response: { error: { type, message } } });
}

/** Stream de texto completo: deltas + response.completed (end_turn). */
export function textResponse(...parts: string[]): string {
  return parts.map((part) => textDelta(part)).join('') + responseCompleted();
}
