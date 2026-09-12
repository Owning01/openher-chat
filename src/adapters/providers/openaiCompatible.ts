/**
 * Adapter de proveedores OpenAI-compatible. Construye el payload canónico de
 * `/chat/completions`, consume SSE chunked acumulando tool-calls y tolera el
 * fallback buffered del transporte nativo (JSON completo o transcripción SSE).
 */

import type { AdapterDeps, ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import { HttpError } from '@/domain/ports/HttpClient';
import type { StreamResult } from '@/domain/ports/HttpClient';
import type { TokenUsage } from '@/domain/types/chat';
import type { ModelInfo, ProviderCapabilities, ProviderConfig } from '@/domain/types/provider';
import type { StopReason, StreamEvent, WireMessage } from '@/domain/types/stream';
import type { JsonSchema, ToolDefinition } from '@/domain/types/tools';
import { ProviderError, mapHttpStatus } from './errors';
import { parseSseStream, parseSseText } from './sse';

/**
 * Alias retrocompatible del contrato de dominio: `apiKey` ya viaja dentro de
 * `AdapterDeps` (AMEND spec §6). La key solo se usa aquí; nunca se persiste en
 * `ProviderConfig`.
 */
export type ProviderAdapterDeps = AdapterDeps;

const LIST_MODELS_TIMEOUT_MS = 10_000;
const DONE_SENTINEL = '[DONE]';

export function createOpenAICompatibleAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await deps.http.request({
      url: `${baseUrl}/models`,
      method: 'GET',
      headers: buildHeaders(config, deps.apiKey, 'application/json'),
      timeoutMs: LIST_MODELS_TIMEOUT_MS,
      signal,
    });
    if (response.status < 200 || response.status >= 300) {
      throw mapHttpStatus(response.status, response.text, findHeader(response.headers, 'retry-after'), deps.now());
    }
    return parseModelList(response.text);
  }

  async function* streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    const { signal } = request;
    if (signal.aborted) {
      yield { type: 'stop', reason: 'aborted' };
      return;
    }

    let result: StreamResult;
    try {
      result = await deps.transport.post({
        url: `${baseUrl}/chat/completions`,
        headers: buildHeaders(config, deps.apiKey, 'text/event-stream'),
        body: buildChatPayload(config, request),
        signal,
      });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }
      throw error;
    }

    if (signal.aborted) {
      yield { type: 'stop', reason: 'aborted' };
      return;
    }

    if (result.mode === 'buffered') {
      if (result.status < 200 || result.status >= 300) {
        throw mapHttpStatus(result.status, result.text, undefined, deps.now());
      }
      yield { type: 'start' };
      yield { type: 'transport-fallback', reason: 'cors' };
      yield* parseBufferedResponse(result.text, signal);
      return;
    }

    yield { type: 'start' };
    yield* parseSseResponse(result.stream, signal);
  }

  return {
    providerId: config.id,
    kind: 'openai-compatible',
    capabilities(): ProviderCapabilities {
      return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: false };
    },
    listModels,
    streamChat,
  };
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function buildHeaders(config: ProviderConfig, apiKey: string | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = { ...config.extraHeaders };
  removeHeader(headers, 'accept');
  headers.Accept = accept;
  if (config.requiresKey && apiKey !== undefined && apiKey !== '') {
    removeHeader(headers, 'authorization');
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function removeHeader(headers: Record<string, string>, name: string): void {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) delete headers[key];
  }
}

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

function parseModelList(text: string): ModelInfo[] {
  const parsed = parseJsonRecord(text);
  if (parsed === null) {
    throw new ProviderError('invalid JSON in models response', 'unknown', { retryable: false });
  }
  const rawList = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : null;
  if (rawList === null) {
    throw new ProviderError('unexpected models response shape', 'unknown', { retryable: false });
  }

  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of rawList) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = record.id;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    const name = record.name;
    models.push({ id, label: typeof name === 'string' && name !== '' ? name : id, source: 'api' });
  }
  return models;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

interface OpenAIToolCallPayload {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCallPayload[];
  tool_call_id?: string;
}

interface OpenAIToolPayload {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

interface OpenAIChatPayload {
  model: string;
  messages: OpenAIMessagePayload[];
  stream: true;
  stream_options?: { include_usage: true };
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAIToolPayload[];
  tool_choice?: 'auto';
}

function buildChatPayload(config: ProviderConfig, request: ChatCompletionRequest): OpenAIChatPayload {
  const payload: OpenAIChatPayload = {
    model: request.modelId,
    messages: request.messages.map(toOpenAIMessage),
    stream: true,
  };
  if (config.quirks?.includeUsage === true) payload.stream_options = { include_usage: true };
  if (request.temperature !== undefined) payload.temperature = request.temperature;
  if (request.maxOutputTokens !== undefined && request.maxOutputTokens !== null) payload.max_tokens = request.maxOutputTokens;
  if (request.tools !== undefined && request.tools.length > 0) {
    payload.tools = request.tools.map(toOpenAITool);
    // `tool_choice` sin tools hace fallar a las APIs OpenAI-compatible (400).
    if (config.quirks?.sendToolChoice === true) payload.tool_choice = 'auto';
  }
  return payload;
}

function toOpenAIMessage(message: WireMessage): OpenAIMessagePayload {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant': {
      const payload: OpenAIMessagePayload = {
        role: 'assistant',
        content: message.content.length > 0 ? message.content : null,
      };
      if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
        payload.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsText },
        }));
      }
      return payload;
    }
    case 'tool':
      return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
  }
}

function toOpenAITool(tool: ToolDefinition): OpenAIToolPayload {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

// ---------------------------------------------------------------------------
// Streaming SSE
// ---------------------------------------------------------------------------

interface PendingToolCall {
  index: number;
  id: string;
  name: string;
  argumentsText: string;
}

interface ChunkState {
  finishReason: StopReason;
  accept(chunk: Record<string, unknown>): StreamEvent[];
  flushToolCalls(): StreamEvent[];
}

/**
 * Acumula los chunks de OpenAI: deltas de texto/razonamiento, tool-calls por
 * `index` y `usage`. Los tool-calls se drenan al ver `finish_reason` o al
 * cerrar el stream (una sola vez por llamada).
 */
function createChunkState(): ChunkState {
  const pending = new Map<number, PendingToolCall>();
  const state: ChunkState = {
    finishReason: 'end_turn',
    accept(chunk) {
      const events: StreamEvent[] = [];
      const choice = firstChoice(chunk);
      if (choice !== null) {
        const delta = asRecord(choice.delta);
        if (delta !== null) {
          appendDeltaEvents(events, delta);
          if (Array.isArray(delta.tool_calls)) mergeToolCallDeltas(pending, delta.tool_calls);
        }
        if (typeof choice.finish_reason === 'string') {
          state.finishReason = mapFinishReason(choice.finish_reason);
          events.push(...drainToolCalls(pending));
        }
      }
      const usage = mapUsage(asRecord(chunk.usage));
      if (usage !== null) events.push({ type: 'usage', usage });
      return events;
    },
    flushToolCalls() {
      return drainToolCalls(pending);
    },
  };
  return state;
}

async function* parseSseResponse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void, void> {
  const state = createChunkState();
  const cancelOnAbort = (): void => {
    void stream.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });

  try {
    for await (const sse of parseSseStream(stream)) {
      if (signal.aborted) break;
      if (sse.data.trim() === DONE_SENTINEL) break;
      const chunk = parseJsonRecord(sse.data);
      if (chunk === null) continue;
      for (const event of state.accept(chunk)) yield event;
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      yield { type: 'stop', reason: 'aborted' };
      return;
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
  }

  if (signal.aborted) {
    yield { type: 'stop', reason: 'aborted' };
    return;
  }
  for (const event of state.flushToolCalls()) yield event;
  yield { type: 'stop', reason: state.finishReason };
}

// ---------------------------------------------------------------------------
// Buffered (fallback nativo): JSON completo o transcripción SSE completa
// ---------------------------------------------------------------------------

async function* parseBufferedResponse(text: string, signal: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
  const completion = tryParseCompletion(text);
  if (completion !== null) {
    const { events, stopReason } = completionToEvents(completion);
    for (const event of events) {
      if (signal.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }
      yield event;
    }
    if (signal.aborted) {
      yield { type: 'stop', reason: 'aborted' };
      return;
    }
    yield { type: 'stop', reason: stopReason };
    return;
  }

  const state = createChunkState();
  for (const sse of parseSseText(text)) {
    if (signal.aborted) {
      yield { type: 'stop', reason: 'aborted' };
      return;
    }
    if (sse.data.trim() === DONE_SENTINEL) break;
    const chunk = parseJsonRecord(sse.data);
    if (chunk === null) continue;
    for (const event of state.accept(chunk)) yield event;
  }
  if (signal.aborted) {
    yield { type: 'stop', reason: 'aborted' };
    return;
  }
  for (const event of state.flushToolCalls()) yield event;
  yield { type: 'stop', reason: state.finishReason };
}

function completionToEvents(completion: Record<string, unknown>): { events: StreamEvent[]; stopReason: StopReason } {
  const events: StreamEvent[] = [];
  let stopReason: StopReason = 'end_turn';
  const choice = firstChoice(completion);
  if (choice !== null) {
    const message = asRecord(choice.message) ?? asRecord(choice.delta);
    if (message !== null) {
      appendDeltaEvents(events, message);
      if (Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((raw, index) => {
          const event = toCompleteToolCallEvent(raw, index);
          if (event !== null) events.push(event);
        });
      }
    }
    if (typeof choice.finish_reason === 'string') stopReason = mapFinishReason(choice.finish_reason);
  }
  const usage = mapUsage(asRecord(completion.usage));
  if (usage !== null) events.push({ type: 'usage', usage });
  return { events, stopReason };
}

function tryParseCompletion(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = parseJsonRecord(trimmed);
  return parsed !== null && Array.isArray(parsed.choices) ? parsed : null;
}

function toCompleteToolCallEvent(raw: unknown, index: number): StreamEvent | null {
  const call = asRecord(raw);
  if (call === null) return null;
  const fn = asRecord(call.function);
  if (fn === null) return null;
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (name === '') return null;
  const id = typeof call.id === 'string' && call.id !== '' ? call.id : `call_${index}`;
  return { type: 'tool-call', toolCall: { id, name, argumentsText: stringifyArguments(fn.arguments) } };
}

// ---------------------------------------------------------------------------
// Chunk helpers
// ---------------------------------------------------------------------------

function firstChoice(chunk: Record<string, unknown>): Record<string, unknown> | null {
  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  return asRecord(choices[0]);
}

function appendDeltaEvents(events: StreamEvent[], delta: Record<string, unknown>): void {
  const reasoning = delta.reasoning_content;
  if (typeof reasoning === 'string' && reasoning !== '') {
    events.push({ type: 'reasoning-delta', delta: reasoning });
  }
  const content = delta.content;
  if (typeof content === 'string' && content !== '') {
    events.push({ type: 'text-delta', delta: content });
  }
}

function mergeToolCallDeltas(pending: Map<number, PendingToolCall>, rawCalls: unknown[]): void {
  for (const raw of rawCalls) {
    const call = asRecord(raw);
    if (call === null) continue;
    const index = typeof call.index === 'number' && Number.isInteger(call.index) ? call.index : 0;
    let pendingCall = pending.get(index);
    if (pendingCall === undefined) {
      pendingCall = { index, id: '', name: '', argumentsText: '' };
      pending.set(index, pendingCall);
    }
    if (typeof call.id === 'string') pendingCall.id += call.id;
    const fn = asRecord(call.function);
    if (fn === null) continue;
    if (typeof fn.name === 'string') pendingCall.name += fn.name;
    pendingCall.argumentsText += stringifyArguments(fn.arguments);
  }
}

function drainToolCalls(pending: Map<number, PendingToolCall>): StreamEvent[] {
  if (pending.size === 0) return [];
  const calls = [...pending.values()].sort((left, right) => left.index - right.index);
  pending.clear();
  const events: StreamEvent[] = [];
  for (const call of calls) {
    if (call.name === '') continue;
    events.push({
      type: 'tool-call',
      toolCall: {
        id: call.id === '' ? `call_${call.index}` : call.id,
        name: call.name,
        argumentsText: call.argumentsText,
      },
    });
  }
  return events;
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
    default:
      return 'end_turn';
  }
}

function mapUsage(usage: Record<string, unknown> | null): TokenUsage | null {
  if (usage === null) return null;
  const mapped: TokenUsage = {};
  if (typeof usage.prompt_tokens === 'number') mapped.promptTokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') mapped.completionTokens = usage.completion_tokens;
  if (typeof usage.total_tokens === 'number') mapped.totalTokens = usage.total_tokens;
  return Object.keys(mapped).length === 0 ? null : mapped;
}

function stringifyArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  const serialized = JSON.stringify(value);
  return serialized === undefined ? '' : serialized;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof HttpError) return error.kind === 'aborted';
  return error instanceof Error && error.name === 'AbortError';
}
