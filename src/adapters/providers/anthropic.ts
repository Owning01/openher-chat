/**
 * Adapter del proveedor Anthropic (Claude). Construye el payload canónico de
 * `/v1/messages` (system top-level, `max_tokens` obligatorio, tools con
 * `input_schema` y tool_result dentro de un mensaje de usuario) y consume SSE
 * con eventos nombrados, acumulando `input_json_delta` por índice y emitiendo
 * cada tool-call al ver `content_block_stop`. Tolera el fallback buffered del
 * transporte nativo (JSON completo o transcripción SSE).
 */

import type { AdapterDeps, ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import { HttpError } from '@/domain/ports/HttpClient';
import type { StreamResult } from '@/domain/ports/HttpClient';
import { thinkingBudgetTokens } from '@/domain/providers/thinking';
import type { MessageError, MessageErrorCode, TokenUsage } from '@/domain/types/chat';
import type { ModelInfo, ProviderCapabilities, ProviderConfig } from '@/domain/types/provider';
import type { StopReason, StreamEvent, WireMessage } from '@/domain/types/stream';
import type { JsonSchema, ToolDefinition } from '@/domain/types/tools';
import { ProviderError, mapHttpStatus } from './errors';
import { parseSseStream, parseSseText } from './sse';
import type { SseEvent } from './sse';

const ANTHROPIC_VERSION = '2023-06-01';
const BROWSER_DIRECT_HEADER = 'anthropic-dangerous-direct-browser-access';
const LIST_MODELS_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Catálogo local de respaldo para entornos que no exponen `GET /v1/models`
 * (proxies o claves restringidas). El usuario puede editarlo en ajustes.
 */
export const ANTHROPIC_FALLBACK_MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    source: 'manual',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    source: 'manual',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    source: 'manual',
  },
];

export function createAnthropicAdapter(config: ProviderConfig, deps: AdapterDeps): ProviderAdapter {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  async function listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = await deps.http.request({
      url: `${baseUrl}/v1/models?limit=1000`,
      method: 'GET',
      headers: buildHeaders(config, deps.apiKey),
      timeoutMs: LIST_MODELS_TIMEOUT_MS,
      signal,
    });
    if (response.status === 404) return ANTHROPIC_FALLBACK_MODELS.map((model) => ({ ...model }));
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
        url: `${baseUrl}/v1/messages`,
        headers: buildHeaders(config, deps.apiKey, request.extraHeaders),
        body: buildChatPayload(request),
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
    kind: 'anthropic',
    capabilities(): ProviderCapabilities {
      return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: true };
    },
    listModels,
    streamChat,
  };
}

// ---------------------------------------------------------------------------
// URL y headers
// ---------------------------------------------------------------------------

/** Quita slashes finales y el segmento `/v1` opcional para no duplicarlo. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function buildHeaders(
  config: ProviderConfig,
  apiKey: string | undefined,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...config.extraHeaders, ...extraHeaders };
  removeHeader(headers, 'x-api-key');
  removeHeader(headers, 'anthropic-version');
  removeHeader(headers, BROWSER_DIRECT_HEADER);
  removeHeader(headers, 'content-type');
  headers['content-type'] = 'application/json';
  headers['anthropic-version'] = ANTHROPIC_VERSION;
  headers[BROWSER_DIRECT_HEADER] = 'true';
  if (apiKey !== undefined && apiKey !== '') headers['x-api-key'] = apiKey;
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
  if (!Array.isArray(parsed.data)) {
    throw new ProviderError('unexpected models response shape', 'unknown', { retryable: false });
  }

  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = record.id;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    const name = record.display_name;
    models.push({ id, label: typeof name === 'string' && name !== '' ? name : id, source: 'api' });
  }
  return models;
}

// ---------------------------------------------------------------------------
// Payload de /v1/messages
// ---------------------------------------------------------------------------

interface AnthropicCacheControl {
  type: 'ephemeral';
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  cache_control?: AnthropicCacheControl;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: AnthropicCacheControl;
}

/** TTL por defecto de Anthropic (5 min); suficiente para el loop de chat. */
const EPHEMERAL: AnthropicCacheControl = { type: 'ephemeral' };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicToolPayload {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

interface AnthropicMessagesPayload {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream: true;
  system?: string | AnthropicSystemBlock[];
  temperature?: number;
  thinking?: { type: 'enabled'; budget_tokens: number };
  tools?: AnthropicToolPayload[];
}

type NonSystemWireMessage = Exclude<WireMessage, { role: 'system' }>;

function buildChatPayload(request: ChatCompletionRequest): AnthropicMessagesPayload {
  const caching = request.cache?.cacheControl === true;
  const messages = request.messages.filter(
    (message): message is NonSystemWireMessage => message.role !== 'system',
  );
  const maxTokens = request.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const payload: AnthropicMessagesPayload = {
    model: request.modelId,
    // El breakpoint del system ya cubre tools+system (van antes en el prefijo);
    // los dos últimos mensajes forman la escalera móvil de la cola.
    messages: messages.map((message, index) => toAnthropicMessage(message, caching && index >= messages.length - 2)),
    max_tokens: maxTokens,
    stream: true,
  };
  const system = resolveSystem(request);
  if (system !== undefined && system !== '') {
    payload.system = caching ? [{ type: 'text', text: system, cache_control: EPHEMERAL }] : system;
  }
  const thinkingBudget = thinkingBudgetTokens(request.thinking ?? 'off', maxTokens);
  if (thinkingBudget !== null) {
    // Thinking exige `temperature: 1` y presupuesto menor que `max_tokens`.
    payload.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    payload.temperature = 1;
  } else if (request.temperature !== undefined) {
    payload.temperature = request.temperature;
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    payload.tools = request.tools.map(toAnthropicTool);
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

function toAnthropicMessage(message: NonSystemWireMessage, mark: boolean): AnthropicMessage {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: [withCacheControl({ type: 'text', text: message.content }, mark)] };
    case 'assistant': {
      const content: AnthropicContentBlock[] = [];
      if (message.content !== '') content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: parseToolInput(call.argumentsText) });
      }
      markLastBlock(content, mark);
      return { role: 'assistant', content };
    }
    case 'tool':
      return {
        role: 'user',
        content: [
          withCacheControl({ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }, mark),
        ],
      };
  }
}

function withCacheControl(block: AnthropicContentBlock, mark: boolean): AnthropicContentBlock {
  if (mark) block.cache_control = EPHEMERAL;
  return block;
}

function markLastBlock(blocks: AnthropicContentBlock[], mark: boolean): void {
  const last = blocks[blocks.length - 1];
  if (mark && last !== undefined) last.cache_control = EPHEMERAL;
}

function toAnthropicTool(tool: ToolDefinition): AnthropicToolPayload {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

function parseToolInput(argumentsText: string): Record<string, unknown> {
  if (argumentsText.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Estado del stream SSE
// ---------------------------------------------------------------------------

type BlockKind = 'text' | 'thinking' | 'tool_use' | 'other';

interface PendingBlock {
  kind: BlockKind;
  id: string;
  name: string;
  argumentsText: string;
  initialInput: Record<string, unknown> | null;
}

interface AnthropicStreamState {
  done: boolean;
  terminal: boolean;
  stopReason: StopReason;
  emittedDelta: boolean;
  /** Evita contar dos veces el prompt si `message_start` y `message_delta` lo traen. */
  promptUsageEmitted: boolean;
  accept(event: SseEvent): StreamEvent[];
}

function createStreamState(): AnthropicStreamState {
  const blocks = new Map<number, PendingBlock>();
  const state: AnthropicStreamState = {
    done: false,
    terminal: false,
    stopReason: 'end_turn',
    emittedDelta: false,
    promptUsageEmitted: false,
    accept(event) {
      const payload = parseJsonRecord(event.data);
      if (payload === null) return [];
      const type = event.event !== undefined && event.event !== '' ? event.event : typeof payload.type === 'string' ? payload.type : '';
      switch (type) {
        case 'message_start':
          return acceptMessageStart(payload, state);
        case 'content_block_start':
          return acceptContentBlockStart(blocks, payload);
        case 'content_block_delta':
          return acceptContentBlockDelta(blocks, payload, state);
        case 'content_block_stop':
          return acceptContentBlockStop(blocks, payload, state);
        case 'message_delta':
          return acceptMessageDelta(payload, state);
        case 'message_stop':
          state.done = true;
          return [];
        case 'error':
          return acceptError(payload, state);
        default:
          return [];
      }
    },
  };
  return state;
}

function acceptMessageStart(payload: Record<string, unknown>, state: AnthropicStreamState): StreamEvent[] {
  const message = asRecord(payload.message);
  // `message_start` solo trae el lado del prompt; el output autoritativo llega
  // en `message_delta` (el `output_tokens` de aquí es un placeholder).
  const usage = message === null ? null : mapAnthropicPromptUsage(asRecord(message.usage));
  if (usage === null) return [];
  state.promptUsageEmitted = true;
  return [{ type: 'usage', usage }];
}

function acceptContentBlockStart(blocks: Map<number, PendingBlock>, payload: Record<string, unknown>): StreamEvent[] {
  const index = readIndex(payload);
  if (index === null) return [];
  const block = asRecord(payload.content_block);
  if (block === null) return [];
  const type = typeof block.type === 'string' ? block.type : '';
  const kind: BlockKind = type === 'text' ? 'text' : type === 'thinking' ? 'thinking' : type === 'tool_use' ? 'tool_use' : 'other';
  blocks.set(index, {
    kind,
    id: typeof block.id === 'string' ? block.id : '',
    name: typeof block.name === 'string' ? block.name : '',
    argumentsText: '',
    initialInput: kind === 'tool_use' ? asRecord(block.input) : null,
  });
  return [];
}

function acceptContentBlockDelta(
  blocks: Map<number, PendingBlock>,
  payload: Record<string, unknown>,
  state: AnthropicStreamState,
): StreamEvent[] {
  const index = readIndex(payload);
  const delta = asRecord(payload.delta);
  if (index === null || delta === null) return [];

  switch (delta.type) {
    case 'text_delta': {
      const text = delta.text;
      if (typeof text !== 'string' || text === '') return [];
      state.emittedDelta = true;
      return [{ type: 'text-delta', delta: text }];
    }
    case 'thinking_delta': {
      const thinking = delta.thinking;
      if (typeof thinking !== 'string' || thinking === '') return [];
      state.emittedDelta = true;
      return [{ type: 'reasoning-delta', delta: thinking }];
    }
    case 'input_json_delta': {
      const partial = delta.partial_json;
      if (typeof partial !== 'string' || partial === '') return [];
      ensureToolBlock(blocks, index).argumentsText += partial;
      return [];
    }
    default:
      return [];
  }
}

function acceptContentBlockStop(
  blocks: Map<number, PendingBlock>,
  payload: Record<string, unknown>,
  state: AnthropicStreamState,
): StreamEvent[] {
  const index = readIndex(payload);
  if (index === null) return [];
  const block = blocks.get(index);
  if (block === undefined) return [];
  blocks.delete(index);
  if (block.kind !== 'tool_use' || block.name === '') return [];
  state.emittedDelta = true;
  return [
    {
      type: 'tool-call',
      toolCall: {
        id: block.id !== '' ? block.id : `toolu_${index}`,
        name: block.name,
        argumentsText: resolveToolArguments(block),
      },
    },
  ];
}

function acceptMessageDelta(payload: Record<string, unknown>, state: AnthropicStreamState): StreamEvent[] {
  const events: StreamEvent[] = [];
  const delta = asRecord(payload.delta);
  if (delta !== null && typeof delta.stop_reason === 'string') {
    state.stopReason = mapStopReason(delta.stop_reason);
  }
  const usage = asRecord(payload.usage);
  if (usage !== null) {
    // Algunos proxies solo reportan el prompt/caché en el evento final; si
    // `message_start` no lo trajo, se recupera aquí (una sola vez).
    if (!state.promptUsageEmitted && typeof usage.input_tokens === 'number') {
      const promptUsage = mapAnthropicPromptUsage(usage);
      if (promptUsage !== null) {
        state.promptUsageEmitted = true;
        events.push({ type: 'usage', usage: promptUsage });
      }
    }
    if (typeof usage.output_tokens === 'number') {
      events.push({ type: 'usage', usage: { completionTokens: usage.output_tokens } });
    }
  }
  return events;
}

function acceptError(payload: Record<string, unknown>, state: AnthropicStreamState): StreamEvent[] {
  const record = asRecord(payload.error);
  const type = record !== null && typeof record.type === 'string' ? record.type : '';
  const message =
    record !== null && typeof record.message === 'string' && record.message !== '' ? record.message : 'Anthropic stream error';
  const mapped = mapStreamError(type);
  const error = new ProviderError(message, mapped.code, { retryable: mapped.retryable });
  if (!state.emittedDelta) throw error;
  state.terminal = true;
  return [{ type: 'error', error: toMessageError(error) }];
}

function ensureToolBlock(blocks: Map<number, PendingBlock>, index: number): PendingBlock {
  let block = blocks.get(index);
  if (block === undefined) {
    block = { kind: 'tool_use', id: '', name: '', argumentsText: '', initialInput: null };
    blocks.set(index, block);
  }
  return block;
}

function resolveToolArguments(block: PendingBlock): string {
  if (block.argumentsText !== '') return block.argumentsText;
  if (block.initialInput !== null && Object.keys(block.initialInput).length > 0) {
    return JSON.stringify(block.initialInput);
  }
  return '';
}

function readIndex(payload: Record<string, unknown>): number | null {
  const index = payload.index;
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

function mapStopReason(reason: string): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'end_turn':
    default:
      return 'end_turn';
  }
}

function mapStreamError(type: string): { code: MessageErrorCode; retryable: boolean } {
  switch (type) {
    case 'authentication_error':
    case 'permission_error':
      return { code: 'auth', retryable: false };
    case 'rate_limit_error':
      return { code: 'rate_limit', retryable: true };
    case 'timeout_error':
      return { code: 'timeout', retryable: true };
    case 'overloaded_error':
    case 'api_error':
      return { code: 'server', retryable: true };
    case 'invalid_request_error':
    case 'not_found_error':
    case 'request_too_large':
      return { code: 'invalid_request', retryable: false };
    default:
      return { code: 'unknown', retryable: false };
  }
}

function toMessageError(error: ProviderError): MessageError {
  return { code: error.code, message: error.message, retryable: error.retryable };
}

// ---------------------------------------------------------------------------
// Streaming SSE
// ---------------------------------------------------------------------------

async function* parseSseResponse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void, void> {
  const state = createStreamState();
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

  const message = tryParseMessage(text);
  if (message !== null) {
    for (const event of messageToEvents(message)) {
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
    yield { type: 'stop', reason: mapStopReason(readStopReason(message)) };
    return;
  }

  const state = createStreamState();
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
  yield { type: 'stop', reason: state.stopReason };
}

function tryParseMessage(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = parseJsonRecord(trimmed);
  return parsed !== null && Array.isArray(parsed.content) ? parsed : null;
}

function messageToEvents(message: Record<string, unknown>): StreamEvent[] {
  const events: StreamEvent[] = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (let index = 0; index < content.length; index += 1) {
      const block = asRecord(content[index]);
      if (block === null) continue;
      if (block.type === 'text') {
        if (typeof block.text === 'string' && block.text !== '') {
          events.push({ type: 'text-delta', delta: block.text });
        }
      } else if (block.type === 'thinking') {
        if (typeof block.thinking === 'string' && block.thinking !== '') {
          events.push({ type: 'reasoning-delta', delta: block.thinking });
        }
      } else if (block.type === 'tool_use') {
        const name = typeof block.name === 'string' ? block.name : '';
        if (name === '') continue;
        const id = typeof block.id === 'string' && block.id !== '' ? block.id : `toolu_${index}`;
        events.push({ type: 'tool-call', toolCall: { id, name, argumentsText: stringifyInput(block.input) } });
      }
    }
  }

  const usage = mapAnthropicUsage(asRecord(message.usage));
  if (usage !== null) events.push({ type: 'usage', usage });
  return events;
}

function readStopReason(message: Record<string, unknown>): string {
  return typeof message.stop_reason === 'string' ? message.stop_reason : '';
}

function stringifyInput(value: unknown): string {
  const record = asRecord(value);
  if (record === null || Object.keys(record).length === 0) return '';
  return JSON.stringify(record);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Normaliza el usage de Anthropic. `input_tokens` EXCLUYE lo cacheado, así que
 * el prompt real (y la calibración del presupuesto) es la suma de input +
 * cache_read + cache_creation. Los campos de caché se exponen aparte.
 */
function mapAnthropicPromptUsage(usage: Record<string, unknown> | null): TokenUsage | null {
  if (usage === null) return null;
  const mapped: TokenUsage = {};
  const input = finiteNumber(usage.input_tokens);
  const cacheRead = finiteNumber(usage.cache_read_input_tokens);
  const cacheWrite = finiteNumber(usage.cache_creation_input_tokens);
  if (input !== undefined || cacheRead !== undefined || cacheWrite !== undefined) {
    mapped.promptTokens = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  }
  if (cacheRead !== undefined) mapped.cachedPromptTokens = cacheRead;
  if (cacheWrite !== undefined) mapped.cacheWritePromptTokens = cacheWrite;
  return Object.keys(mapped).length === 0 ? null : mapped;
}

function mapAnthropicUsage(usage: Record<string, unknown> | null): TokenUsage | null {
  const mapped = mapAnthropicPromptUsage(usage) ?? {};
  const output = finiteNumber(usage?.output_tokens);
  if (output !== undefined) mapped.completionTokens = output;
  return Object.keys(mapped).length === 0 ? null : mapped;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof HttpError) return error.kind === 'aborted';
  return error instanceof Error && error.name === 'AbortError';
}
