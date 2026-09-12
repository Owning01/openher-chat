/**
 * Fixtures y builders SSE de Anthropic para los tests del adapter. Reutiliza
 * los fakes estructurales de red de `openaiCompatible` (sin red real).
 */

import type { ChatCompletionRequest } from '@/domain/ports/ProviderAdapter';
import type { ProviderConfig } from '@/domain/types/provider';
import type { ToolDefinition } from '@/domain/types/tools';

export {
  FIXED_NOW,
  TEST_API_KEY,
  bufferedResult,
  erroringStream,
  fakeHttp,
  fakeTransport,
  jsonResponse,
  makeDeps,
  sseResult,
  stalledStream,
} from './openaiCompatible';
export type { FakeHttpClient, FakeTransport, RecordedPost } from './openaiCompatible';

export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export function anthropicConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    requiresKey: true,
    keyRef: 'provider:anthropic',
    models: [],
    defaultModelId: ANTHROPIC_MODEL,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function chatRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return {
    modelId: ANTHROPIC_MODEL,
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
// Builders SSE (eventos nombrados de Anthropic)
// ---------------------------------------------------------------------------

export function sseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function messageStart(inputTokens?: number): string {
  return sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: ANTHROPIC_MODEL,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      ...(inputTokens === undefined ? {} : { usage: { input_tokens: inputTokens, output_tokens: 1 } }),
    },
  });
}

export function contentBlockStart(index: number, contentBlock: Record<string, unknown>): string {
  return sseEvent('content_block_start', { type: 'content_block_start', index, content_block: contentBlock });
}

export function textDelta(index: number, text: string): string {
  return sseEvent('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
}

export function thinkingDelta(index: number, thinking: string): string {
  return sseEvent('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking },
  });
}

export function inputJsonDelta(index: number, partialJson: string): string {
  return sseEvent('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  });
}

export function contentBlockStop(index: number): string {
  return sseEvent('content_block_stop', { type: 'content_block_stop', index });
}

export function messageDelta(stopReason?: string, outputTokens?: number): string {
  return sseEvent('message_delta', {
    type: 'message_delta',
    delta: stopReason === undefined ? {} : { stop_reason: stopReason, stop_sequence: null },
    ...(outputTokens === undefined ? {} : { usage: { output_tokens: outputTokens } }),
  });
}

export function messageStop(): string {
  return sseEvent('message_stop', { type: 'message_stop' });
}

export function pingEvent(): string {
  return sseEvent('ping', { type: 'ping' });
}

export function errorEvent(type: string, message: string): string {
  return sseEvent('error', { type: 'error', error: { type, message } });
}

/** Stream de texto completo: mensaje + un bloque text + stop end_turn. */
export function textStream(...parts: string[]): string {
  let out = messageStart();
  out += contentBlockStart(0, { type: 'text', text: '' });
  for (const part of parts) out += textDelta(0, part);
  out += contentBlockStop(0);
  out += messageDelta('end_turn');
  out += messageStop();
  return out;
}
