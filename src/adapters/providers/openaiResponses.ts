/**
 * Adapter de la OpenAI Responses API (`/responses`). Construye el payload con
 * `instructions`/`input` (function_call + function_call_output), consume SSE de
 * eventos `response.*` acumulando argumentos de tool-calls por `output_index` y
 * tolera el fallback buffered del transporte nativo (JSON completo o
 * transcripción SSE). Lo usan los modelos GPT/Grok/Muse de OpenCode Zen.
 */

import type { AdapterDeps, ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import { HttpError } from '@/domain/ports/HttpClient';
import type { StreamResult } from '@/domain/ports/HttpClient';
import type { ThinkingLevel } from '@/domain/types/provider';
import type { MessageError, MessageErrorCode, TokenUsage } from '@/domain/types/chat';
import type { ModelInfo, ProviderCapabilities, ProviderConfig } from '@/domain/types/provider';
import type { StopReason, StreamEvent, WireMessage } from '@/domain/types/stream';
import type { JsonSchema, ToolDefinition } from '@/domain/types/tools';
import { ProviderError, mapHttpStatus } from './errors';
import { parseOpenAIModelList } from './modelList';
import { parseSseStream, parseSseText } from './sse';
import type { SseEvent } from './sse';

const LIST_MODELS_TIMEOUT_MS = 10_000;

export function createOpenAIResponsesAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter {
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
    return parseOpenAIModelList(response.text);
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
        url: `${baseUrl}/responses`,
        headers: buildHeaders(config, deps.apiKey, 'text/event-stream', request.extraHeaders),
        body: buildResponsesPayload(request),
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
    kind: 'openai-responses',
    capabilities(): ProviderCapabilities {
      return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: true };
    },
    listModels,
    streamChat,
  };
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function buildHeaders(
  config: ProviderConfig,
  apiKey: string | undefined,
  accept: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...config.extraHeaders, ...extraHeaders };
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
// Payload de /responses
// ---------------------------------------------------------------------------

interface ResponseUserInput {
  role: 'user';
  content: string | (ResponseInputTextPart | ResponseInputImagePart)[];
}

interface ResponseInputTextPart {
  type: 'input_text';
  text: string;
}

interface ResponseInputImagePart {
  type: 'input_image';
  image_url: string;
  detail: 'auto';
}

interface ResponseAssistantInput {
  role: 'assistant';
  content: string;
}

interface ResponseFunctionCallInput {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponseFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type ResponseInputItem =
  | ResponseUserInput
  | ResponseAssistantInput
  | ResponseFunctionCallInput
  | ResponseFunctionCallOutput;

interface ResponseFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: JsonSchema;
}

interface ResponsesPayload {
  model: string;
  input: ResponseInputItem[];
  instructions?: string;
  prompt_cache_key?: string;
  tools?: ResponseFunctionTool[];
  tool_choice?: 'auto';
  temperature?: number;
  max_output_tokens?: number;
  reasoning?: { effort: 'low' | 'medium' | 'high'; summary: 'auto' };
  stream: true;
}

/** `max` no existe en todos los modelos: se degrada a `high` en vez de arriesgar un 400. */
function toReasoningEffort(level: ThinkingLevel): 'low' | 'medium' | 'high' {
  if (level === 'low') return 'low';
  if (level === 'medium') return 'medium';
  return 'high';
}

function buildResponsesPayload(request: ChatCompletionRequest): ResponsesPayload {
  const payload: ResponsesPayload = {
    model: request.modelId,
    input: request.messages.flatMap(toResponseInputItems),
    stream: true,
  };
  const system = resolveSystem(request);
  if (system !== undefined && system !== '') payload.instructions = system;
  if (request.cache?.cacheControl === true && request.sessionId !== undefined && request.sessionId !== '') {
    payload.prompt_cache_key = request.sessionId;
  }
  if (request.temperature !== undefined) payload.temperature = request.temperature;
  if (request.maxOutputTokens !== undefined && request.maxOutputTokens !== null) {
    payload.max_output_tokens = request.maxOutputTokens;
  }
  if (request.thinking !== undefined && request.thinking !== 'off') {
    payload.reasoning = { effort: toReasoningEffort(request.thinking), summary: 'auto' };
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    payload.tools = request.tools.map(toResponseTool);
    payload.tool_choice = 'auto';
  }
  return payload;
}

function resolveSystem(request: ChatCompletionRequest): string | undefined {
  if (request.system !== undefined) return request.system;
  for (const message of request.messages) {
    if (message.role === 'system') return message.content;
  }
  return undefined;
}

function toResponseInputItems(message: WireMessage): ResponseInputItem[] {
  switch (message.role) {
    case 'system':
      return [];
    case 'user': {
      if (message.images === undefined || message.images.length === 0) {
        return [{ role: 'user', content: message.content }];
      }
      const parts: (ResponseInputTextPart | ResponseInputImagePart)[] = [];
      if (message.content !== '') parts.push({ type: 'input_text', text: message.content });
      for (const image of message.images) {
        parts.push({ type: 'input_image', image_url: image.dataUrl, detail: 'auto' });
      }
      return [{ role: 'user', content: parts }];
    }
    case 'assistant': {
      const items: ResponseInputItem[] = [];
      if (message.content !== '') items.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls ?? []) {
        items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.argumentsText });
      }
      return items;
    }
    case 'tool':
      return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
  }
}

function toResponseTool(tool: ToolDefinition): ResponseFunctionTool {
  return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters };
}

// ---------------------------------------------------------------------------
// Estado del stream SSE de Responses
// ---------------------------------------------------------------------------

interface PendingFunctionCall {
  itemId: string;
  callId: string;
  name: string;
  argumentsText: string;
  emitted: boolean;
}

interface ResponsesStreamState {
  done: boolean;
  terminal: boolean;
  stopReason: StopReason;
  emittedDelta: boolean;
  hasToolCalls: boolean;
  accept(event: SseEvent): StreamEvent[];
  flushToolCalls(): StreamEvent[];
}

function createResponsesStreamState(): ResponsesStreamState {
  const pending = new Map<string, PendingFunctionCall>();
  const emittedCallIds = new Set<string>();
  const state: ResponsesStreamState = {
    done: false,
    terminal: false,
    stopReason: 'end_turn',
    emittedDelta: false,
    hasToolCalls: false,
    accept(event) {
      const payload = parseJsonRecord(event.data);
      if (payload === null) return [];
      const type = resolveEventType(event.event, payload);
      switch (type) {
        case 'response.output_text.delta':
          return acceptTextDelta(payload, state);
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta':
          return acceptReasoningDelta(payload, state);
        case 'response.function_call_arguments.delta':
          return acceptFunctionCallArgumentsDelta(pending, payload);
        case 'response.output_item.done':
          return acceptOutputItemDone(pending, emittedCallIds, payload, state);
        case 'response.completed':
          return acceptResponseCompleted(pending, emittedCallIds, payload, state);
        case 'response.failed':
        case 'response.error':
        case 'error':
          return acceptStreamError(payload, state);
        default:
          return [];
      }
    },
    flushToolCalls() {
      return drainPendingCalls(pending, emittedCallIds, state);
    },
  };
  return state;
}

function resolveEventType(eventName: string | undefined, payload: Record<string, unknown>): string {
  if (eventName !== undefined && eventName !== '') return eventName;
  return typeof payload.type === 'string' ? payload.type : '';
}

function acceptTextDelta(payload: Record<string, unknown>, state: ResponsesStreamState): StreamEvent[] {
  const delta = payload.delta;
  if (typeof delta !== 'string' || delta === '') return [];
  state.emittedDelta = true;
  return [{ type: 'text-delta', delta }];
}

function acceptReasoningDelta(payload: Record<string, unknown>, state: ResponsesStreamState): StreamEvent[] {
  const delta = payload.delta;
  if (typeof delta !== 'string' || delta === '') return [];
  state.emittedDelta = true;
  return [{ type: 'reasoning-delta', delta }];
}

function acceptFunctionCallArgumentsDelta(
  pending: Map<string, PendingFunctionCall>,
  payload: Record<string, unknown>,
): StreamEvent[] {
  const delta = payload.delta;
  if (typeof delta !== 'string' || delta === '') return [];
  ensurePendingCall(pending, payload).argumentsText += delta;
  return [];
}

function acceptOutputItemDone(
  pending: Map<string, PendingFunctionCall>,
  emittedCallIds: Set<string>,
  payload: Record<string, unknown>,
  state: ResponsesStreamState,
): StreamEvent[] {
  const item = asRecord(payload.item);
  if (item === null || item.type !== 'function_call') return [];
  const event = finalizeFunctionCall(pending, emittedCallIds, item, resolveItemKey(payload), state);
  return event === null ? [] : [event];
}

function acceptResponseCompleted(
  pending: Map<string, PendingFunctionCall>,
  emittedCallIds: Set<string>,
  payload: Record<string, unknown>,
  state: ResponsesStreamState,
): StreamEvent[] {
  const events: StreamEvent[] = [];
  const response = asRecord(payload.response) ?? payload;
  const output = response.output;
  if (Array.isArray(output)) {
    for (let index = 0; index < output.length; index += 1) {
      const item = asRecord(output[index]);
      if (item === null || item.type !== 'function_call') continue;
      const event = finalizeFunctionCall(pending, emittedCallIds, item, `#${index}`, state);
      if (event !== null) events.push(event);
    }
  }
  events.push(...drainPendingCalls(pending, emittedCallIds, state));
  const usage = mapResponsesUsage(asRecord(response.usage));
  if (usage !== null) events.push({ type: 'usage', usage });
  state.stopReason = resolveStopReason(response, state.hasToolCalls);
  state.done = true;
  return events;
}

function acceptStreamError(payload: Record<string, unknown>, state: ResponsesStreamState): StreamEvent[] {
  const info = mapResponsesStreamError(payload);
  const error = new ProviderError(info.message, info.code, { retryable: info.retryable });
  if (!state.emittedDelta) throw error;
  state.terminal = true;
  return [{ type: 'error', error: toMessageError(error) }];
}

function ensurePendingCall(
  pending: Map<string, PendingFunctionCall>,
  payload: Record<string, unknown>,
): PendingFunctionCall {
  const key = resolveItemKey(payload);
  let entry = pending.get(key);
  if (entry === undefined) {
    entry = { itemId: '', callId: '', name: '', argumentsText: '', emitted: false };
    pending.set(key, entry);
  }
  if (entry.itemId === '' && typeof payload.item_id === 'string') entry.itemId = payload.item_id;
  if (entry.callId === '' && typeof payload.call_id === 'string') entry.callId = payload.call_id;
  if (entry.name === '' && typeof payload.name === 'string') entry.name = payload.name;
  return entry;
}

function finalizeFunctionCall(
  pending: Map<string, PendingFunctionCall>,
  emittedCallIds: Set<string>,
  item: Record<string, unknown>,
  key: string,
  state: ResponsesStreamState,
): StreamEvent | null {
  const entry = takePendingCall(pending, key, item);
  const name = typeof item.name === 'string' && item.name !== '' ? item.name : entry !== undefined ? entry.name : '';
  if (name === '') return null;

  const callId = pickFirstString(
    typeof item.call_id === 'string' ? item.call_id : '',
    typeof item.id === 'string' ? item.id : '',
    entry !== undefined ? entry.callId : '',
    `call_${sanitizeKey(key)}`,
  );
  const argumentsText =
    entry !== undefined && entry.argumentsText !== ''
      ? entry.argumentsText
      : stringifyArguments(item.arguments);

  if (emittedCallIds.has(callId)) return null;
  emittedCallIds.add(callId);
  state.hasToolCalls = true;
  state.emittedDelta = true;
  return { type: 'tool-call', toolCall: { id: callId, name, argumentsText } };
}

function takePendingCall(
  pending: Map<string, PendingFunctionCall>,
  key: string,
  item: Record<string, unknown>,
): PendingFunctionCall | undefined {
  const direct = pending.get(key);
  if (direct !== undefined) {
    pending.delete(key);
    return direct;
  }
  const itemId = typeof item.id === 'string' ? item.id : '';
  if (itemId !== '') {
    for (const [entryKey, entry] of pending) {
      if (entry.itemId === itemId) {
        pending.delete(entryKey);
        return entry;
      }
    }
  }
  const callId = typeof item.call_id === 'string' ? item.call_id : '';
  if (callId !== '') {
    for (const [entryKey, entry] of pending) {
      if (entry.callId === callId) {
        pending.delete(entryKey);
        return entry;
      }
    }
  }
  return undefined;
}

function drainPendingCalls(
  pending: Map<string, PendingFunctionCall>,
  emittedCallIds: Set<string>,
  state: ResponsesStreamState,
): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const entry of pending.values()) {
    if (entry.emitted || entry.name === '') continue;
    const callId = entry.callId !== '' ? entry.callId : `call_${sanitizeKey(entry.itemId)}`;
    if (emittedCallIds.has(callId)) continue;
    emittedCallIds.add(callId);
    entry.emitted = true;
    state.hasToolCalls = true;
    state.emittedDelta = true;
    events.push({ type: 'tool-call', toolCall: { id: callId, name: entry.name, argumentsText: entry.argumentsText } });
  }
  pending.clear();
  return events;
}

function resolveItemKey(payload: Record<string, unknown>): string {
  const index = payload.output_index;
  if (typeof index === 'number' && Number.isInteger(index)) return `#${index}`;
  const itemId = payload.item_id;
  if (typeof itemId === 'string' && itemId !== '') return itemId;
  return '#unknown';
}

function sanitizeKey(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'item' : cleaned;
}

function pickFirstString(...values: string[]): string {
  for (const value of values) {
    if (value !== '') return value;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Streaming SSE
// ---------------------------------------------------------------------------

async function* parseSseResponse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void, void> {
  const state = createResponsesStreamState();
  const cancelOnAbort = (): void => {
    void stream.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });

  try {
    for await (const sse of parseSseStream(stream)) {
      if (signal.aborted) break;
      for (const event of state.accept(sse)) yield event;
      if (state.done || state.terminal) break;
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
  if (state.terminal) return;
  for (const event of state.flushToolCalls()) yield event;
  if (state.hasToolCalls && state.stopReason === 'end_turn') state.stopReason = 'tool_use';
  yield { type: 'stop', reason: state.stopReason };
}

// ---------------------------------------------------------------------------
// Buffered (fallback nativo): JSON completo o transcripción SSE completa
// ---------------------------------------------------------------------------

async function* parseBufferedResponse(text: string, signal: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
  if (signal.aborted) {
    yield { type: 'stop', reason: 'aborted' };
    return;
  }

  const response = tryParseResponse(text);
  if (response !== null) {
    const { events, stopReason } = responseToEvents(response);
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

  const state = createResponsesStreamState();
  for (const sse of parseSseText(text)) {
    if (signal.aborted) {
      yield { type: 'stop', reason: 'aborted' };
      return;
    }
    for (const event of state.accept(sse)) yield event;
    if (state.done || state.terminal) break;
  }
  if (signal.aborted) {
    yield { type: 'stop', reason: 'aborted' };
    return;
  }
  if (state.terminal) return;
  for (const event of state.flushToolCalls()) yield event;
  if (state.hasToolCalls && state.stopReason === 'end_turn') state.stopReason = 'tool_use';
  yield { type: 'stop', reason: state.stopReason };
}

function tryParseResponse(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = parseJsonRecord(trimmed);
  return parsed !== null && Array.isArray(parsed.output) ? parsed : null;
}

function responseToEvents(response: Record<string, unknown>): { events: StreamEvent[]; stopReason: StopReason } {
  const events: StreamEvent[] = [];
  let hasToolCalls = false;
  const output = response.output;
  if (Array.isArray(output)) {
    for (let index = 0; index < output.length; index += 1) {
      const item = asRecord(output[index]);
      if (item === null) continue;
      appendBufferedItemEvents(events, item, index);
      if (item.type === 'function_call') hasToolCalls = true;
    }
  }
  const usage = mapResponsesUsage(asRecord(response.usage));
  if (usage !== null) events.push({ type: 'usage', usage });
  return { events, stopReason: resolveStopReason(response, hasToolCalls) };
}

function appendBufferedItemEvents(events: StreamEvent[], item: Record<string, unknown>, index: number): void {
  const type = item.type;
  if (type === 'message') {
    const content = item.content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const part = asRecord(raw);
      if (part === null) continue;
      const text = part.type === 'output_text' && typeof part.text === 'string' ? part.text : '';
      if (text !== '') events.push({ type: 'text-delta', delta: text });
    }
    return;
  }
  if (type === 'reasoning') {
    appendReasoningTexts(events, item.summary);
    appendReasoningTexts(events, item.content);
    return;
  }
  if (type === 'function_call') {
    const name = typeof item.name === 'string' ? item.name : '';
    if (name === '') return;
    const id = pickFirstString(
      typeof item.call_id === 'string' ? item.call_id : '',
      typeof item.id === 'string' ? item.id : '',
      `call_${index}`,
    );
    events.push({ type: 'tool-call', toolCall: { id, name, argumentsText: stringifyArguments(item.arguments) } });
  }
}

function appendReasoningTexts(events: StreamEvent[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const raw of value) {
    const part = asRecord(raw);
    if (part === null) continue;
    const text = typeof part.text === 'string' ? part.text : '';
    if (text !== '') events.push({ type: 'reasoning-delta', delta: text });
  }
}

// ---------------------------------------------------------------------------
// Mapeos
// ---------------------------------------------------------------------------

function resolveStopReason(response: Record<string, unknown>, hasToolCalls: boolean): StopReason {
  const details = asRecord(response.incomplete_details);
  if (details !== null && details.reason === 'max_output_tokens') return 'max_tokens';
  if (hasToolCalls) return 'tool_use';
  return 'end_turn';
}

function mapResponsesUsage(usage: Record<string, unknown> | null): TokenUsage | null {
  if (usage === null) return null;
  const mapped: TokenUsage = {};
  if (typeof usage.input_tokens === 'number' && Number.isFinite(usage.input_tokens)) {
    mapped.promptTokens = usage.input_tokens;
  }
  if (typeof usage.output_tokens === 'number' && Number.isFinite(usage.output_tokens)) {
    mapped.completionTokens = usage.output_tokens;
  }
  if (typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens)) {
    mapped.totalTokens = usage.total_tokens;
  }
  // `input_tokens` ya incluye los cacheados; aquí solo se exponen aparte.
  const details = asRecord(usage.input_tokens_details);
  if (details !== null && typeof details.cached_tokens === 'number' && Number.isFinite(details.cached_tokens)) {
    mapped.cachedPromptTokens = details.cached_tokens;
  }
  return Object.keys(mapped).length === 0 ? null : mapped;
}

function mapResponsesStreamError(payload: Record<string, unknown>): {
  message: string;
  code: MessageErrorCode;
  retryable: boolean;
} {
  const direct = asRecord(payload.error);
  const responseRecord = asRecord(payload.response);
  const nested = responseRecord !== null ? asRecord(responseRecord.error) : null;
  const record = direct ?? nested;
  const type = record !== null && typeof record.type === 'string' ? record.type : '';
  const message = pickFirstString(
    record !== null && typeof record.message === 'string' ? record.message : '',
    typeof payload.message === 'string' ? payload.message : '',
    'OpenAI Responses stream error',
  );
  const lower = `${type} ${message}`.toLowerCase();
  const invalid =
    lower.includes('invalid') ||
    lower.includes('unsupported') ||
    lower.includes('bad request') ||
    lower.includes('not found') ||
    lower.includes('missing') ||
    lower.includes('unexpected');
  return invalid
    ? { message, code: 'invalid_request', retryable: false }
    : { message, code: 'server', retryable: true };
}

function toMessageError(error: ProviderError): MessageError {
  return { code: error.code, message: error.message, retryable: error.retryable };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
