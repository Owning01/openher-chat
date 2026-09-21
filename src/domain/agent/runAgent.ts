import { buildWireMessages } from '../chat/buildWireMessages';
import { estimateMessagesTokens, estimateToolsTokens } from '../chat/estimateTokens';
import { createAssistantMessage, finalizeMessage } from '../chat/messageFactory';
import { selectHistoryByBudget } from '../chat/selectHistoryByBudget';
import { truncateText } from '../chat/truncateText';
import type { ChatCompletionRequest, ProviderAdapter } from '../ports/ProviderAdapter';
import type { ToolPermissionGate } from '../ports/ToolPermission';
import { inferThinkingSupport } from '../providers/thinking';
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
import type { ModelInfo, ThinkingLevel } from '../types/provider';
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
  /** Si existe, cada tool pide aprobación antes de ejecutarse (permisos). */
  permissions?: ToolPermissionGate;
}

export interface RunAgentParams {
  providerId: string;
  modelId: string;
  conversationId: string;
  systemPrompt: string;
  history: ChatMessage[];
  userMessage: ChatMessage;
  defaults: { temperature: number; maxOutputTokens: number | null; thinking: ThinkingLevel };
  budget: AgentBudget;
  historyBudget: HistoryBudget;
  researchMode: boolean;
  signal: AbortSignal;
  /**
   * AMEND §A2 (aditivo): habilita el loop de tools sin sobrecargar `researchMode`.
   * Gate efectivo: `(enableTools ?? researchMode) && capabilities.toolCalling
   * && model?.supportsTools !== false`. Ausente = comportamiento previo.
   */
  enableTools?: boolean;
  /**
   * AMEND §A6 (aditivo): mensajes efímeros que se anexan **solo al wire**, después
   * de la selección de historial y antes del user actual. Nunca entran a
   * `loopHistory` ni a `systemPrompt`, por lo que no se persisten ni invalidan el
   * prefijo cacheado. Sirven al brief legal (par atómico assistant(tool-call) +
   * tool-result). Su tamaño se reserva vía `SelectHistoryByBudgetInput.reservedTokens`.
   */
  ephemeralSuffix?: ChatMessage[];
  /**
   * AMEND aditivo sobre §7 (compatible con la firma congelada): §7 exige el gate
   * `model.supportsTools !== false`, pero la firma no transportaba el modelo.
   * El caller resuelve aquí el `ModelInfo` activo; si falta, el modelo se
   * considera compatible con tools. `contextWindow` alimenta a
   * `selectHistoryByBudget`.
   */
  model?: ModelInfo;
  /** Habilita la ejecución concurrente / especulativa de herramientas de solo lectura. */
  speculativeExecution?: boolean;
  /** Habilita rescate cognitivo coercitivo ante fallos reiterados o thrashing de herramientas. */
  cognitiveRescue?: boolean;
}

const CACHED_CALL_NOTE = '[note: identical call already executed; reusing cached result]';

/** Causa por la que un tool-call emitido no llegó a ejecutarse (C1). */
type NotExecutedReason = 'aborted' | 'budget' | 'failed' | 'skipped';

/** Set vacío reutilizable para cerrar tool-calls de intentos que nunca ejecutaron tools. */
const EMPTY_EXECUTED_IDS: ReadonlySet<string> = new Set<string>();

const NOT_EXECUTED_DETAIL: Record<NotExecutedReason, string> = {
  aborted: 'was not executed because the run was aborted',
  budget: 'was not executed because the run budget was exhausted',
  failed: 'was not executed because the run stopped after repeated tool failures',
  skipped: 'was not executed in this run',
};

export const COGNITIVE_RESCUE_DIRECTIVE =
  '[SISTEMA DE RESCATE COGNITIVO DEL AGENTE]\n' +
  'Se ha detectado un bucle improductivo o fallo reiterado en la invocación de herramientas (thrashing/doom-loop).\n' +
  'La ejecución de herramientas ha sido suspendida para preservar el objetivo. ' +
  'Reflexiona críticamente sobre los obstáculos encontrados y sintetiza la mejor respuesta final posible con la información disponible.';

const READ_ONLY_TOOLS = new Set([
  'web_search',
  'fetch_page',
  'open_url',
  'read_document',
  'search_document_chunks',
  'audit_document',
  'summarize_document',
]);

function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

/** Coeficiente de Sørensen-Dice sobre bigramas para detectar thrashing de argumentos (> 0.85). */
export function computeArgumentSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.slice(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
    }
    return bigrams;
  };

  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);

  let intersection = 0;
  for (const [bigram, countA] of bigramsA.entries()) {
    const countB = bigramsB.get(bigram) ?? 0;
    intersection += Math.min(countA, countB);
  }

  const total = a.length - 1 + (b.length - 1);
  return (2 * intersection) / total;
}

export interface ToolHistoryEntry {
  name: string;
  argsText: string;
  ok: boolean;
  step: number;
}

export function detectThrashing(history: readonly ToolHistoryEntry[]): boolean {
  if (history.length < 2) return false;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  if (!last || !prev) return false;

  if (last.name === prev.name) {
    if (!last.ok && computeArgumentSimilarity(last.argsText, prev.argsText) >= 0.85) {
      return true;
    }
    if (history.length >= 3) {
      const prev2 = history[history.length - 3];
      if (
        prev2 &&
        prev2.name === last.name &&
        computeArgumentSimilarity(last.argsText, prev.argsText) >= 0.85 &&
        computeArgumentSimilarity(prev.argsText, prev2.argsText) >= 0.85
      ) {
        return true;
      }
    }
  }
  return false;
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /gsk_[a-zA-Z0-9_-]{20,}/g,
  /csk-[a-zA-Z0-9_-]{20,}/g,
  /AIza[0-9A-Za-z-_]{35}/g,
  /bearer\s+[a-zA-Z0-9_.-]{20,}/gi,
];

function redactSecrets(text: string): string {
  let sanitized = text;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }
  return sanitized;
}

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
  /** Ids ya vistos en este intento: sostiene la unicidad ante providers que repiten ids (B2). */
  seenToolCallIds: Map<string, number>;
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
  let cognitiveRescueAttempted = false;
  const toolCallHistory: Array<{ name: string; argsText: string; ok: boolean; step: number }> = [];
  let contextLengthRetried = false;
  let runUsage: TokenUsage | undefined;
  let finalStatus: AgentRunStatus = 'complete';
  let finalError: MessageError | undefined;
  let stepIndex = 0;
  // AMEND §A6: tokens del sufijo efímero, reservados en cada selección para que el
  // wire (historial + sufijo + user) no desborde la ventana. La ventana queda
  // protegida por esa reserva (`reservedTokens` achica el historial elegible);
  // el estimado de costo, en cambio, SÍ los incluye (ver cálculo abajo), porque
  // el proveedor factura el prompt real con el sufijo adentro (B4).
  const ephemeralTokens = p.ephemeralSuffix === undefined ? 0 : estimateMessagesTokens(p.ephemeralSuffix);
  // Cuando se agota el presupuesto blando (pasos o tool-calls) se reserva un paso
  // final SIN tools para que el modelo sintetice en vez de terminar en blanco.
  let answerForced = false;
  /** Algún paso cortó por `max_tokens`: la respuesta puede reanudarse. */
  let truncated = false;

  try {
    const capabilities = d.provider.capabilities();
    const toolsEnabled =
      (p.enableTools ?? p.researchMode) && capabilities.toolCalling && p.model?.supportsTools !== false;
    // Visión: transporte Y modelo. Sin ella las imágenes degradan a descriptor
    // de texto en el wire (nunca se envían bytes que el proveedor rechazaría).
    const imagesSupported = capabilities.images && p.model?.supportsImages !== false;
    // Prompt Caching: ordenamiento canónico determinista de schemas por nombre de herramienta.
    const rawTools = toolsEnabled ? d.tools.list() : [];
    const toolDefinitions = [...rawTools].sort((a, b) => a.name.localeCompare(b.name));
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
          reservedTokens: ephemeralTokens,
        });
        const stepTools = answerForced ? undefined : requestTools;
        // B4: el estimado de costo cubre el prompt real completo (historial
        // seleccionado + tools + sufijo efímero). La reserva de ventana vive en
        // la selección (`reservedTokens`); aquí se mide costo, no ventana.
        estimatedPromptTokens =
          selection.estimatedPromptTokens +
          (stepTools === undefined ? 0 : estimateToolsTokens(stepTools)) +
          ephemeralTokens;

        const limit = findBudgetLimit(
          budgetState,
          p.budget,
          d.clock(),
          estimatedPromptTokens,
          toolsEnabled && !answerForced,
          answerForced,
        );
        if (limit !== null) {
          if (!answerForced && toolsEnabled && (limit === 'toolCalls' || limit === 'steps')) {
            answerForced = true;
            continue attempts;
          }
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
          messages: buildWireMessages({
            system: p.systemPrompt,
            history: withEphemeralSuffix(selection.messages, p.ephemeralSuffix),
            userMessage: p.userMessage,
          }, { imagesSupported }),
          tools: stepTools,
          toolChoice: stepTools === undefined ? undefined : 'auto',
          temperature: p.defaults.temperature,
          maxOutputTokens: p.defaults.maxOutputTokens,
          thinking: p.defaults.thinking,
          thinkingSupported: p.model?.supportsThinking ?? inferThinkingSupport(p.modelId),
          signal: p.signal,
          sessionId: p.conversationId,
          cache: { cacheControl: true },
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
              const uniqueCall = uniqueToolCall(event.toolCall, attempt.seenToolCallIds);
              attempt.toolCalls.push(uniqueCall);
              attempt.blocks.push({ type: 'tool-call', toolCall: uniqueCall });
            } else if (event.type === 'usage') {
              attempt.usage = accumulateUsage(attempt.usage, event.usage);
            } else if (event.type === 'stop') {
              attempt.stopReason = event.reason;
              if (event.reason === 'max_tokens') truncated = true;
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
          yield* closeToolCalls(runBlocks, attempt.toolCalls, EMPTY_EXECUTED_IDS, 'aborted', stepIndex);
          finalStatus = 'aborted';
          break steps;
        }
        const failure = attempt.failure;
        if (failure !== undefined && failure.aborted) {
          runBlocks.push(...attempt.blocks);
          yield* closeToolCalls(runBlocks, attempt.toolCalls, EMPTY_EXECUTED_IDS, 'aborted', stepIndex);
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
              yield* closeToolCalls(runBlocks, attempt.toolCalls, EMPTY_EXECUTED_IDS, 'aborted', stepIndex);
              finalStatus = 'aborted';
              break steps;
            }
            continue attempts;
          }
          runBlocks.push(...attempt.blocks);
          yield* closeToolCalls(runBlocks, attempt.toolCalls, EMPTY_EXECUTED_IDS, 'failed', stepIndex);
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

      const shouldRunTools = !answerForced && toolsEnabled && attempt.toolCalls.length > 0;
      let abortedDuringTools = false;
      let budgetDuringTools = false;
      let failedTwice = false;
      let lastToolFailure: ToolResult | undefined;
      /** Tool-calls que sí emitieron su `tool-result` en este paso. */
      const executedToolCallIds = new Set<string>();
      /** Tool-calls que ya emitieron su `tool-start`: el cierre sintético no lo repite (B1/B3). */
      const startedToolCallIds = new Set<string>();

      if (shouldRunTools) {
        try {
          const isSpeculative =
            p.speculativeExecution === true &&
            attempt.toolCalls.length > 1 &&
            attempt.toolCalls.every((c) => isReadOnlyTool(c.name));

          if (isSpeculative) {
            if (elapsedWallClock(budgetState, d.clock()) >= p.budget.maxWallClockMs) {
              budgetDuringTools = true;
            } else {
              const maxAllowed = Math.max(0, p.budget.maxToolCalls - budgetState.toolCalls);
              const toExecute = attempt.toolCalls.slice(0, maxAllowed);
              if (toExecute.length < attempt.toolCalls.length) {
                budgetDuringTools = true;
              }

              const preparedList = toExecute.map((call) => {
                const prep = prepareToolCall(call, d.tools, toolResultCache);
                startedToolCallIds.add(prep.call.id);
                return prep;
              });

              for (const prep of preparedList) {
                yield { type: 'tool-start', stepIndex, toolCall: prep.call };
              }

              const executions = await Promise.all(
                preparedList.map(async (prep) => {
                  if (prep.kind === 'immediate') {
                    return { prep, exec: { kind: 'result' as const, result: prep.result } };
                  }
                  const execution = await executePreparedTool(prep, p, d);
                  if (execution.kind === 'result') {
                    toolResultCache.set(prep.cacheKey, execution.result);
                  }
                  return { prep, exec: execution };
                }),
              );

              for (const { prep, exec } of executions) {
                if (exec.kind === 'aborted' || p.signal.aborted) {
                  abortedDuringTools = true;
                  break;
                }
                budgetState.toolCalls += 1;
                const limitedResult = truncateToolResult(exec.result, prep.def, p.budget.maxToolResultChars);
                executedToolCallIds.add(prep.call.id);
                runBlocks.push({
                  type: 'tool-result',
                  toolCallId: prep.call.id,
                  toolName: prep.call.name,
                  result: limitedResult,
                });

                const argsText = prep.kind === 'ready' ? stableStringify(prep.args) : prep.call.argumentsText;
                toolCallHistory.push({
                  name: prep.call.name,
                  argsText,
                  ok: limitedResult.ok,
                  step: stepIndex,
                });

                if (limitedResult.ok) {
                  consecutiveToolFailures = 0;
                } else {
                  consecutiveToolFailures += 1;
                  lastToolFailure = limitedResult;
                }
                yield { type: 'tool-end', stepIndex, toolCall: prep.call, result: limitedResult };

                const shouldRescue = p.cognitiveRescue === true && !cognitiveRescueAttempted;
                const thrashing = detectThrashing(toolCallHistory);
                if (consecutiveToolFailures >= 2 || (p.cognitiveRescue === true && thrashing)) {
                  if (shouldRescue) {
                    cognitiveRescueAttempted = true;
                    answerForced = true;
                    consecutiveToolFailures = 0;
                    runBlocks.push({
                      type: 'text',
                      text: COGNITIVE_RESCUE_DIRECTIVE,
                    });
                    break;
                  } else {
                    failedTwice = true;
                    break;
                  }
                }
              }
            }
          } else {
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
              startedToolCallIds.add(prepared.call.id);

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
              executedToolCallIds.add(prepared.call.id);
              runBlocks.push({
                type: 'tool-result',
                toolCallId: prepared.call.id,
                toolName: prepared.call.name,
                result: limitedResult,
              });

              const argsText = prepared.kind === 'ready' ? stableStringify(prepared.args) : prepared.call.argumentsText;
              toolCallHistory.push({
                name: prepared.call.name,
                argsText,
                ok: limitedResult.ok,
                step: stepIndex,
              });

              if (limitedResult.ok) {
                consecutiveToolFailures = 0;
              } else {
                consecutiveToolFailures += 1;
                lastToolFailure = limitedResult;
              }
              yield { type: 'tool-end', stepIndex, toolCall: prepared.call, result: limitedResult };

              const shouldRescue = p.cognitiveRescue === true && !cognitiveRescueAttempted;
              const thrashing = detectThrashing(toolCallHistory);
              if (consecutiveToolFailures >= 2 || (p.cognitiveRescue === true && thrashing)) {
                if (shouldRescue) {
                  cognitiveRescueAttempted = true;
                  answerForced = true;
                  consecutiveToolFailures = 0;
                  runBlocks.push({
                    type: 'text',
                    text: COGNITIVE_RESCUE_DIRECTIVE,
                  });
                  break;
                } else {
                  failedTwice = true;
                  break;
                }
              }
            }
          }
        } catch (cause) {
          // Un throw del registry o de la preparación no debe dejar tool-calls abiertos.
          yield* closeToolCalls(runBlocks, attempt.toolCalls, executedToolCallIds, 'failed', stepIndex, startedToolCallIds);
          throw cause;
        }
      }

      // C1: todo tool-call emitido en el assistant debe tener su tool-result antes de
      // finalizar el paso. Los no ejecutados se cierran con un resultado sintético
      // `not_executed` (sin simular ejecución) para no romper proveedores
      // OpenAI-compatible con `No tool output found for function call`.
      const cutoffReason: NotExecutedReason = abortedDuringTools
        ? 'aborted'
        : budgetDuringTools
          ? 'budget'
          : failedTwice
            ? 'failed'
            : 'skipped';
      yield* closeToolCalls(runBlocks, attempt.toolCalls, executedToolCallIds, cutoffReason, stepIndex, startedToolCallIds);

      if (abortedDuringTools) {
        finalStatus = 'aborted';
        break;
      }
      if (budgetDuringTools) {
        // Se cortó el batch de tools: reserva el paso final sin tools para sintetizar.
        answerForced = true;
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
      truncated,
      error: finalError,
      now: d.clock(),
    },
  );
  yield { type: 'run-end', status: finalStatus, message: finalMessage, error: finalError };
}

function createAttempt(): AttemptState {
  return { blocks: [], toolCalls: [], seenToolCallIds: new Map<string, number>(), stopReason: 'end_turn', sawOutput: false, aborted: false };
}

/**
 * Anexa el sufijo efímero (AMEND §A6) a la selección de historial que recibe
 * `buildWireMessages`: viaja al wire después del historial seleccionado y antes
 * del user actual, pero nunca entra a `loopHistory` (se recompone en cada paso).
 */
function withEphemeralSuffix(history: ChatMessage[], suffix: ChatMessage[] | undefined): ChatMessage[] {
  if (suffix === undefined || suffix.length === 0) return history;
  return [...history, ...suffix];
}

/**
 * Cierra los tool-calls de `calls` que no registraron resultado en `executedIds`
 * (C1). Emite un `tool-result` sintético `not_executed` y su evento `tool-end`,
 * coherente con el camino feliz, para que el wire nunca quede con un call abierto.
 * B1: cada `tool-end` sintético va precedido de su `tool-start` (salvo que el
 * start real ya se haya emitido —ver `startedIds`—, para no duplicarlo cuando la
 * ejecución falla después del start). Invariante del módulo: exactamente un
 * `tool-start` y un `tool-end` por cada tool-call emitido.
 */
async function* closeToolCalls(
  runBlocks: MessageContent[],
  calls: readonly ToolCall[],
  executedIds: ReadonlySet<string>,
  reason: NotExecutedReason,
  stepIndex: number,
  startedIds: ReadonlySet<string> = EMPTY_EXECUTED_IDS,
): AsyncGenerator<AgentEvent, void, void> {
  for (const call of calls) {
    if (executedIds.has(call.id)) continue;
    if (!startedIds.has(call.id)) {
      yield { type: 'tool-start', stepIndex, toolCall: call };
    }
    const result = notExecutedResult(call.name, reason);
    runBlocks.push({ type: 'tool-result', toolCallId: call.id, toolName: call.name, result });
    yield { type: 'tool-end', stepIndex, toolCall: call, result };
  }
}

/**
 * Garantiza ids únicos por intento (B2): el protocolo exige aparear cada
 * `tool-result` con su `tool-call` por id, y el sanitizador del wire
 * (`buildWireMessages`, fuera del alcance de este fix) cuenta resultados por id.
 * Si el proveedor repite un id, el duplicado se reescribe como `<id>__dup<N>`
 * (se conserva la llamada y su ejecución; sólo cambia el id de apareo local).
 * Primera ocurrencia: se conserva tal cual.
 */
function uniqueToolCall(call: ToolCall, seen: Map<string, number>): ToolCall {
  const count = seen.get(call.id) ?? 0;
  seen.set(call.id, count + 1);
  if (count === 0) return call;
  let attempt = count + 1;
  let candidate = `${call.id}__dup${attempt}`;
  while (seen.has(candidate)) {
    attempt += 1;
    candidate = `${call.id}__dup${attempt}`;
  }
  seen.set(candidate, 1);
  return { ...call, id: candidate };
}

/** Resultado sintético de cierre: declara que la tool no se ejecutó, sin fingir salida. */
function notExecutedResult(toolName: string, reason: NotExecutedReason): ToolResult {
  const message = `The "${toolName}" tool ${NOT_EXECUTED_DETAIL[reason]}. Continue without its result.`;
  return { ok: false, content: message, error: { code: 'not_executed', message }, durationMs: 0 };
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

  if (d.permissions !== undefined) {
    const allowed = await d.permissions.request({ tool: def.name, arguments: args });
    if (p.signal.aborted) return { kind: 'aborted' };
    if (!allowed) {
      return {
        kind: 'result',
        result: errorResult(
          'denied',
          `The user denied execution of the "${def.name}" tool. Do not retry it; continue without it.`,
          Math.max(0, d.clock() - startedAt),
        ),
      };
    }
  }

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
  const sanitized = redactSecrets(result.content);
  const limit = def === undefined ? maxToolResultChars : Math.min(def.maxResultChars, maxToolResultChars);
  const content = truncateToLimit(sanitized, limit);
  return content === result.content && sanitized === result.content ? result : { ...result, content };
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
  denied: 'unknown',
  not_executed: 'unknown',
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
