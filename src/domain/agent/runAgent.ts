import { buildWireMessages } from '../chat/buildWireMessages';
import { estimateToolsTokens } from '../chat/estimateTokens';
import { createAssistantMessage, finalizeMessage } from '../chat/messageFactory';
import { selectHistoryByBudget } from '../chat/selectHistoryByBudget';
import { truncateText } from '../chat/truncateText';
import type { ChatCompletionRequest, ProviderAdapter } from '../ports/ProviderAdapter';
import type { AgentBudget, AgentEvent, AgentRunStatus } from '../types/agent';
import type {
  ChatMessage,
  MessageContent,
  MessageError,
  MessageErrorCode,
  MessageStatus,
  TokenUsage,
  ToolCall,
  ToolErrorCode,
  ToolResult,
} from '../types/chat';
import type { ModelInfo } from '../types/provider';
import type { HistoryBudget } from '../types/settings';
import type { StopReason } from '../types/stream';
import type { ToolDefinition, ToolRegistry } from '../types/tools';
import {
  accumulateUsage,
  computeRetryDelay,
  createBudgetState,
  elapsedWallClock,
  findBudgetLimit,
  registerStepUsage,
  sleepAbortable,
  withTimeout,
} from './budget';
import { parseToolArguments, type ToolArguments } from './parseToolArguments';

export interface RunAgentDeps {
  provider: ProviderAdapter;
  tools: ToolRegistry;
  clock: () => number;
  newId: () => string;
}

export interface RunAgentParams {
  providerId: string;
  modelId: string;
  conversationId: string;
  systemPrompt: string;
  history: ChatMessage[];
  userMessage: ChatMessage;
  defaults: { temperature: number; maxOutputTokens: number | null };
  budget: AgentBudget;
  historyBudget: HistoryBudget;
  researchMode: boolean;
  signal: AbortSignal;
  /**
   * AMEND aditivo sobre §7 (compatible con la firma congelada): §7 exige el gate
   * `model.supportsTools !== false`, pero la firma no transportaba el modelo.
   * El caller resuelve aquí el `ModelInfo` activo; si falta, el modelo se
   * considera compatible con tools. `contextWindow` alimenta a
   * `selectHistoryByBudget`.
   */
  model?: ModelInfo;
}

const CACHED_CALL_NOTE = '[note: identical call already executed; reusing cached result]';

const MESSAGE_ERROR_CODES: readonly MessageErrorCode[] = [
  'auth',
  'rate_limit',
  'network',
  'timeout',
  'server',
  'invalid_request',
  'context_length',
  'aborted',
  'unknown',
];

type StreamFailure =
  | { aborted: true }
  | { aborted: false; code: MessageErrorCode; message: string; retryable: boolean; retryAfterMs?: number };

interface AttemptState {
  blocks: MessageContent[];
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  stopReason: StopReason;
  sawOutput: boolean;
  aborted: boolean;
  failure?: StreamFailure;
}

interface PreparedToolCallReady {
  kind: 'ready';
  call: ToolCall;
  def: ToolDefinition;
  args: ToolArguments;
  cacheKey: string;
}

interface PreparedToolCallImmediate {
  kind: 'immediate';
  call: ToolCall;
  def?: ToolDefinition;
  result: ToolResult;
}

type PreparedToolCall = PreparedToolCallReady | PreparedToolCallImmediate;

type ToolExecution = { kind: 'result'; result: ToolResult } | { kind: 'aborted' };

/**
 * Loop del agente en pasos: reconstruye contexto por paso, consume el stream,
 * ejecuta tools en serie con timeout/dedupe y cierra con un `ChatMessage`
 * parcial o final según presupuesto, aborto o error. Reglas completas en spec §7.
 */
export async function* runAgent(p: RunAgentParams, d: RunAgentDeps): AsyncGenerator<AgentEvent, void, void> {
  const runId = d.newId();
  yield { type: 'run-start', runId };

  const startedAt = d.clock();
  const budgetState = createBudgetState(startedAt);

  const loopHistory: ChatMessage[] = [...p.history];
  const runBlocks: MessageContent[] = [];
  const toolResultCache = new Map<string, ToolResult>();
  let consecutiveToolFailures = 0;
  let contextLengthRetried = false;
  let runUsage: TokenUsage | undefined;
  let finalStatus: AgentRunStatus = 'complete';
  let finalError: MessageError | undefined;
  let stepIndex = 0;

  try {
    const capabilities = d.provider.capabilities();
    const toolsEnabled = p.researchMode && capabilities.toolCalling && p.model?.supportsTools !== false;
    const toolDefinitions = toolsEnabled ? d.tools.list() : [];
    const requestTools = toolDefinitions.length > 0 ? toolDefinitions : undefined;

    steps: for (;;) {
      if (p.signal.aborted) {
        finalStatus = 'aborted';
        break;
      }

      let stepHistory = loopHistory;
      let attempt = createAttempt();
      let estimatedPromptTokens = 0;
      let retriesUsed = 0;
      let stepStarted = false;

      attempts: for (;;) {
        const selection = selectHistoryByBudget({
          history: stepHistory,
          userMessage: p.userMessage,
          system: p.systemPrompt,
          budget: p.historyBudget,
          contextWindow: p.model?.contextWindow,
        });
        estimatedPromptTokens =
          selection.estimatedPromptTokens + (requestTools === undefined ? 0 : estimateToolsTokens(requestTools));

        if (findBudgetLimit(budgetState, p.budget, d.clock(), estimatedPromptTokens, toolsEnabled) !== null) {
          finalStatus = 'budget_exceeded';
          break steps;
        }

        if (!stepStarted) {
          stepStarted = true;
          yield { type: 'step-start', stepIndex };
        }

        const request: ChatCompletionRequest = {
          modelId: p.modelId,
          system: p.systemPrompt !== '' ? p.systemPrompt : undefined,
          messages: buildWireMessages({ system: p.systemPrompt, history: selection.messages, userMessage: p.userMessage }),
          tools: requestTools,
          toolChoice: requestTools === undefined ? undefined : 'auto',
          temperature: p.defaults.temperature,
          maxOutputTokens: p.defaults.maxOutputTokens,
          signal: p.signal,
        };

        attempt = createAttempt();
        const iterator = d.provider.streamChat(request)[Symbol.asyncIterator]();
        try {
          for (;;) {
            if (p.signal.aborted) {
              attempt.aborted = true;
              break;
            }
            const next = await iterator.next();
            if (next.done === true) break;
            const event = next.value;
            if (event.type === 'text-delta') {
              if (event.delta === '') continue;
              attempt.sawOutput = true;
              appendBlockDelta(attempt.blocks, 'text', event.delta);
              yield { type: 'text-delta', stepIndex, delta: event.delta };
            } else if (event.type === 'reasoning-delta') {
              if (event.delta === '') continue;
              attempt.sawOutput = true;
              appendBlockDelta(attempt.blocks, 'reasoning', event.delta);
              yield { type: 'reasoning-delta', stepIndex, delta: event.delta };
            } else if (event.type === 'tool-call') {
              attempt.sawOutput = true;
              attempt.toolCalls.push(event.toolCall);
              attempt.blocks.push({ type: 'tool-call', toolCall: event.toolCall });
            } else if (event.type === 'usage') {
              attempt.usage = accumulateUsage(attempt.usage, event.usage);
            } else if (event.type === 'stop') {
              attempt.stopReason = event.reason;
              if (event.reason === 'aborted') {
                attempt.aborted = true;
                break;
              }
            } else if (event.type === 'error') {
              attempt.failure = normalizeStreamError(event.error, p.signal.aborted);
            }
            if (attempt.aborted || attempt.failure !== undefined) break;
          }
        } catch (cause) {
          attempt.failure = normalizeStreamError(cause, p.signal.aborted);
        } finally {
          await closeIterator(iterator);
        }

        if (attempt.aborted) {
          runBlocks.push(...attempt.blocks);
          finalStatus = 'aborted';
          break steps;
        }
        const failure = attempt.failure;
        if (failure !== undefined && failure.aborted) {
          runBlocks.push(...attempt.blocks);
          finalStatus = 'aborted';
          break steps;
        }
        if (failure !== undefined) {
          if (failure.code === 'context_length' && stepIndex === 0 && !contextLengthRetried && stepHistory.length > 0) {
            contextLengthRetried = true;
            stepHistory = stepHistory.slice(Math.ceil(stepHistory.length / 2));
            continue attempts;
          }
          if (!attempt.sawOutput && failure.retryable && retriesUsed < p.budget.maxRetriesPerStep) {
            retriesUsed += 1;
            const slept = await sleepAbortable(computeRetryDelay(retriesUsed - 1, failure.retryAfterMs), p.signal);
            if (slept === 'aborted') {
              runBlocks.push(...attempt.blocks);
              finalStatus = 'aborted';
              break steps;
            }
            continue attempts;
          }
          runBlocks.push(...attempt.blocks);
          finalStatus = 'error';
          finalError = { code: failure.code, message: failure.message, retryable: failure.retryable };
          break steps;
        }

        break;
      }

      registerStepUsage(budgetState, attempt.usage, estimatedPromptTokens);
      runUsage = accumulateUsage(runUsage, attempt.usage);
      budgetState.steps += 1;

      const stepRunStart = runBlocks.length;
      runBlocks.push(...attempt.blocks);

      const shouldRunTools = toolsEnabled && attempt.toolCalls.length > 0;
      let abortedDuringTools = false;
      let budgetDuringTools = false;
      let failedTwice = false;
      let lastToolFailure: ToolResult | undefined;

      if (shouldRunTools) {
        for (const call of attempt.toolCalls) {
          if (p.signal.aborted) {
            abortedDuringTools = true;
            break;
          }
          if (elapsedWallClock(budgetState, d.clock()) >= p.budget.maxWallClockMs) {
            budgetDuringTools = true;
            break;
          }
          if (budgetState.toolCalls >= p.budget.maxToolCalls) {
            budgetDuringTools = true;
            break;
          }

          const prepared = prepareToolCall(call, d.tools, toolResultCache);
          yield { type: 'tool-start', stepIndex, toolCall: prepared.call };

          let result: ToolResult;
          if (prepared.kind === 'immediate') {
            result = prepared.result;
          } else {
            const execution = await executePreparedTool(prepared, p, d);
            if (execution.kind === 'aborted') {
              abortedDuringTools = true;
              break;
            }
            result = execution.result;
            toolResultCache.set(prepared.cacheKey, result);
          }

          budgetState.toolCalls += 1;
          const limitedResult = truncateToolResult(result, prepared.def, p.budget.maxToolResultChars);
          runBlocks.push({
            type: 'tool-result',
            toolCallId: prepared.call.id,
            toolName: prepared.call.name,
            result: limitedResult,
          });

          if (limitedResult.ok) {
            consecutiveToolFailures = 0;
          } else {
            consecutiveToolFailures += 1;
            lastToolFailure = limitedResult;
          }
          yield { type: 'tool-end', stepIndex, toolCall: prepared.call, result: limitedResult };

          if (consecutiveToolFailures >= 2) {
            failedTwice = true;
            break;
          }
        }
      }

      if (abortedDuringTools) {
        finalStatus = 'aborted';
        break;
      }
      if (budgetDuringTools) {
        finalStatus = 'budget_exceeded';
        break;
      }
      if (failedTwice) {
        finalStatus = 'error';
        finalError = toolFailureToMessageError(lastToolFailure);
        break;
      }

      const stepMessage = finalizeMessage(
        {
          ...createAssistantMessage({
            id: d.newId(),
            conversationId: p.conversationId,
            providerId: p.providerId,
            modelId: p.modelId,
            now: d.clock(),
          }),
          content: runBlocks.slice(stepRunStart),
        },
        { status: 'complete', usage: attempt.usage, now: d.clock() },
      );
      loopHistory.push(stepMessage);
      yield { type: 'step-end', stepIndex, stopReason: attempt.stopReason, usage: attempt.usage };

      if (!shouldRunTools) {
        finalStatus = 'complete';
        break;
      }
      stepIndex += 1;
    }
  } catch (cause) {
    const failure = normalizeStreamError(cause, p.signal.aborted);
    if (failure.aborted) {
      finalStatus = 'aborted';
    } else {
      finalStatus = 'error';
      finalError = { code: failure.code, message: failure.message, retryable: failure.retryable };
    }
  }

  const finalMessage = finalizeMessage(
    {
      ...createAssistantMessage({
        id: d.newId(),
        conversationId: p.conversationId,
        providerId: p.providerId,
        modelId: p.modelId,
        now: startedAt,
      }),
      content: runBlocks,
    },
    {
      status: messageStatusFor(finalStatus),
      finishReason: finalStatus,
      usage: runUsage,
      error: finalError,
      now: d.clock(),
    },
  );
  yield { type: 'run-end', status: finalStatus, message: finalMessage, error: finalError };
}

function createAttempt(): AttemptState {
  return { blocks: [], toolCalls: [], stopReason: 'end_turn', sawOutput: false, aborted: false };
}

function appendBlockDelta(blocks: MessageContent[], type: 'text' | 'reasoning', delta: string): void {
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.type === type) {
    last.text += delta;
    return;
  }
  blocks.push({ type, text: delta });
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  const close = iterator.return;
  if (close === undefined) return;
  try {
    await close.call(iterator);
  } catch {
    // Cierre best-effort: el adapter puede haberse cancelado ya.
  }
}

function prepareToolCall(call: ToolCall, registry: ToolRegistry, cache: Map<string, ToolResult>): PreparedToolCall {
  const def = registry.get(call.name);
  if (def === undefined) {
    return { kind: 'immediate', call, result: errorResult('invalid_args', `Unknown tool "${call.name}".`) };
  }

  const parsed = parseToolArguments(call.argumentsText);
  if (!parsed.ok) {
    return {
      kind: 'immediate',
      call,
      def,
      result: errorResult('invalid_args', `Invalid arguments for tool "${call.name}": ${parsed.error.message}.`),
    };
  }

  const args = parsed.value;
  const enriched: ToolCall = { ...call, arguments: args };
  const cacheKey = `${call.name}\u0000${stableStringify(args)}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return {
      kind: 'immediate',
      call: enriched,
      def,
      result: { ...cached, content: `${cached.content}\n\n${CACHED_CALL_NOTE}` },
    };
  }
  return { kind: 'ready', call: enriched, def, args, cacheKey };
}

async function executePreparedTool(
  prepared: PreparedToolCallReady,
  p: RunAgentParams,
  d: RunAgentDeps,
): Promise<ToolExecution> {
  const { def, args } = prepared;
  const startedAt = d.clock();
  const timeoutMs = effectiveToolTimeout(def, p.budget.toolTimeoutMs);
  const outcome = await withTimeout(
    (signal) => def.execute(args, { signal, conversationId: p.conversationId }),
    timeoutMs,
    p.signal,
  );
  const durationMs = Math.max(0, d.clock() - startedAt);

  if (outcome.status === 'ok') return { kind: 'result', result: outcome.value };
  if (outcome.status === 'timeout') {
    return {
      kind: 'result',
      result: errorResult('timeout', `Tool "${def.name}" timed out after ${timeoutMs}ms.`, durationMs),
    };
  }
  if (outcome.status === 'rejected') {
    return {
      kind: 'result',
      result: errorResult('parse_error', `Tool "${def.name}" failed: ${describeError(outcome.error)}`, durationMs),
    };
  }
  return { kind: 'aborted' };
}

/** Techo efectivo de una tool: el menor entre su `timeoutMs` y el del presupuesto. */
function effectiveToolTimeout(def: ToolDefinition, budgetTimeoutMs: number): number {
  const budget = Number.isFinite(budgetTimeoutMs) && budgetTimeoutMs > 0 ? budgetTimeoutMs : undefined;
  const tool = Number.isFinite(def.timeoutMs) && def.timeoutMs > 0 ? def.timeoutMs : undefined;
  if (budget === undefined) return tool ?? 0;
  if (tool === undefined) return budget;
  return Math.min(tool, budget);
}

function truncateToolResult(result: ToolResult, def: ToolDefinition | undefined, maxToolResultChars: number): ToolResult {
  const limit = def === undefined ? maxToolResultChars : Math.min(def.maxResultChars, maxToolResultChars);
  const content = truncateToLimit(result.content, limit);
  return content === result.content ? result : { ...result, content };
}

/**
 * Respeta el cap exacto en code points: `truncateText` añade el marcador fuera
 * del límite, así que se reserva su longitud (cota superior) antes de recortar.
 * Si el cap no alcanza para el marcador completo, devuelve un corte directo.
 */
function truncateToLimit(content: string, limit: number): string {
  if (!Number.isFinite(limit)) return content;
  const bounded = Math.max(0, Math.floor(limit));
  const codePoints = Array.from(content);
  if (codePoints.length <= bounded) return content;

  const markerReserve = Array.from(truncateText(content, 0)).length;
  if (bounded <= markerReserve) return codePoints.slice(0, bounded).join('');
  return truncateText(content, bounded - markerReserve);
}

function errorResult(code: ToolErrorCode, message: string, durationMs = 0): ToolResult {
  return { ok: false, content: message, error: { code, message }, durationMs };
}

const TOOL_FAILURE_MESSAGE_CODES: Record<ToolErrorCode, MessageErrorCode> = {
  timeout: 'timeout',
  network: 'network',
  cors_blocked: 'network',
  blocked_url: 'unknown',
  no_provider: 'unknown',
  invalid_args: 'unknown',
  invalid_proxy: 'unknown',
  missing_proxy: 'unknown',
  http_error: 'unknown',
  parse_error: 'unknown',
};

function toolFailureToMessageError(result: ToolResult | undefined): MessageError {
  const toolCode = result?.error?.code;
  return {
    code: toolCode === undefined ? 'unknown' : TOOL_FAILURE_MESSAGE_CODES[toolCode],
    message: result?.error?.message ?? result?.content ?? 'Tool calls failed twice in a row.',
    retryable: false,
  };
}

function messageStatusFor(status: AgentRunStatus): MessageStatus {
  if (status === 'aborted') return 'aborted';
  if (status === 'error') return 'error';
  return 'complete';
}

function normalizeStreamError(cause: unknown, signalAborted: boolean): StreamFailure {
  if (signalAborted || isAbortError(cause)) return { aborted: true };

  const record = asRecord(cause);
  const kind = record?.kind;
  if (kind === 'aborted') return { aborted: true };

  const originalMessage = cause instanceof Error ? cause.message : '';
  const recordMessage = typeof record?.message === 'string' && record.message !== '' ? record.message : undefined;
  const status = typeof record?.status === 'number' ? record.status : undefined;
  const code = pickErrorCode(record, status, kind);
  const retryable = typeof record?.retryable === 'boolean' ? record.retryable : defaultRetryable(code, status);
  const retryAfterMs =
    typeof record?.retryAfterMs === 'number' && Number.isFinite(record.retryAfterMs) ? record.retryAfterMs : undefined;

  const failure: StreamFailure = {
    aborted: false,
    code,
    message: originalMessage !== '' ? originalMessage : (recordMessage ?? 'The provider stream failed.'),
    retryable,
  };
  if (retryAfterMs !== undefined) failure.retryAfterMs = retryAfterMs;
  return failure;
}

function pickErrorCode(record: Record<string, unknown> | null, status: number | undefined, kind: unknown): MessageErrorCode {
  if (kind === 'timeout') return 'timeout';
  if (kind === 'network') return 'network';
  const code = record?.code;
  if (typeof code === 'string' && isMessageErrorCode(code)) return code;
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status !== undefined && status >= 500 && status <= 599) return 'server';
  return 'unknown';
}

function defaultRetryable(code: MessageErrorCode, status: number | undefined): boolean {
  if (status === 429 || status === 408) return true;
  if (status !== undefined && status >= 500 && status <= 599) return true;
  return code === 'rate_limit' || code === 'server' || code === 'network' || code === 'timeout';
}

function isMessageErrorCode(value: string): value is MessageErrorCode {
  return (MESSAGE_ERROR_CODES as readonly string[]).includes(value);
}

function isAbortError(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  return (cause as { name?: unknown }).name === 'AbortError';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Serialización canónica: el orden de las claves no altera la identidad de los argumentos. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
