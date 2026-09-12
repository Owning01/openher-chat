import { usageTokens } from '@/domain/agent/budget';
import type { AgentBudget, AgentEvent, AgentStep } from '@/domain/types/agent';
import type { ChatMessage, SourceRef, ToolCall, ToolResult } from '@/domain/types/chat';
import type { ProxySettings, SearchSettings } from '@/domain/types/settings';

/** Presencia de API keys de búsqueda (el valor real vive en el KeyVault). */
export interface SearchKeyPresence {
  brave: boolean;
  tavily: boolean;
}

export interface BudgetUsage {
  steps: number;
  maxSteps: number;
  toolCalls: number;
  maxToolCalls: number;
  tokens: number;
  maxTotalTokens: number;
  wallClockMs: number;
  maxWallClockMs: number;
}

export type ResearchWarning =
  | { kind: 'missingKey'; provider: 'brave' | 'tavily' }
  | { kind: 'missingProxyUrl' }
  | { kind: 'invalidProxyUrl' }
  | { kind: 'browserWithoutProxy' };

export interface ResearchWarningInput {
  search: SearchSettings;
  proxy: ProxySettings;
  keys: SearchKeyPresence;
  browser: boolean;
}

const TOOL_ARG_MAX_CHARS = 90;

/** Clave canónica de una fuente: sin fragmento, para deduplicar la misma página. */
export function canonicalSourceKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** Deduplica fuentes por URL conservando el orden y la primera aparición. */
export function dedupeSources(sources: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const unique: SourceRef[] = [];
  for (const source of sources) {
    const key = canonicalSourceKey(source.url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
}

/** Fuentes de una lista de mensajes: bloques `tool-result` con `sources`, deduplicadas por URL. */
export function sourcesFromMessages(messages: readonly ChatMessage[]): SourceRef[] {
  const collected: SourceRef[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool-result') continue;
      // Persistencia corrupta/probes pueden traer `result: null`; el panel no debe tumbar.
      const result: ToolResult | null | undefined = block.result;
      if (result == null) continue;
      const sources = result.sources;
      if (!Array.isArray(sources)) continue;
      collected.push(...sources);
    }
  }
  return dedupeSources(collected);
}

/** Consumo observable de un run frente al presupuesto del agente (spec §4). */
export function budgetUsage(steps: readonly AgentStep[], budget: AgentBudget): BudgetUsage {
  let toolCalls = 0;
  let tokens = 0;
  let wallClockMs = 0;
  for (const step of steps) {
    toolCalls += step.toolCalls.length;
    tokens += usageTokens(step.usage);
    if (step.endedAt !== undefined) wallClockMs += Math.max(0, step.endedAt - step.startedAt);
  }
  return {
    steps: steps.length,
    maxSteps: budget.maxSteps,
    toolCalls,
    maxToolCalls: budget.maxToolCalls,
    tokens,
    maxTotalTokens: budget.maxTotalTokens,
    wallClockMs,
    maxWallClockMs: budget.maxWallClockMs,
  };
}

/** Resumen legible de los argumentos de una tool para el timeline. */
export function summarizeToolCall(call: ToolCall): string {
  const parsed = asRecord(call.arguments) ?? parseJsonRecord(call.argumentsText);
  if (parsed === null) return clip(call.argumentsText, TOOL_ARG_MAX_CHARS);

  const query = parsed.query;
  if (typeof query === 'string' && query.trim() !== '') return clip(query.trim(), TOOL_ARG_MAX_CHARS);
  const url = parsed.url;
  if (typeof url === 'string' && url.trim() !== '') return clip(url.trim(), TOOL_ARG_MAX_CHARS);
  const serialized = JSON.stringify(parsed);
  return serialized === undefined ? clip(call.argumentsText, TOOL_ARG_MAX_CHARS) : clip(serialized, TOOL_ARG_MAX_CHARS);
}

/** Reduce una secuencia de `AgentEvent` a pasos de timeline (reducer puro, fuente única). */
export function applyAgentEvent(steps: readonly AgentStep[], event: AgentEvent, now: number): AgentStep[] {
  switch (event.type) {
    case 'run-start':
      return [];
    case 'step-start':
      return steps.some((step) => step.index === event.stepIndex)
        ? [...steps]
        : [
            ...steps,
            { index: event.stepIndex, status: 'running', startedAt: now, text: '', toolCalls: [], toolResults: [] },
          ];
    case 'text-delta':
      return patchStep(steps, event.stepIndex, (step) => ({ ...step, text: step.text + event.delta }));
    case 'reasoning-delta':
      return [...steps];
    case 'tool-start':
      return patchStep(steps, event.stepIndex, (step) => ({ ...step, toolCalls: [...step.toolCalls, event.toolCall] }));
    case 'tool-end':
      return patchStep(steps, event.stepIndex, (step) => ({
        ...step,
        toolResults: [...step.toolResults, event.result],
      }));
    case 'step-end':
      return patchStep(steps, event.stepIndex, (step) => {
        const next: AgentStep = { ...step, status: 'complete', endedAt: now, stopReason: event.stopReason };
        if (event.usage !== undefined) next.usage = event.usage;
        return next;
      });
    case 'run-end':
      return closeRunningSteps(steps, event.status === 'error' ? 'error' : 'complete', now);
  }
}

/** Cierra los pasos en curso del run; compartido por `run-end` y por el store de chat. */
export function closeRunningSteps(
  steps: readonly AgentStep[],
  status: 'complete' | 'error',
  endedAt: number,
): AgentStep[] {
  return steps.map((step) => (step.status === 'running' ? { ...step, status, endedAt } : step));
}

export function stepsFromEvents(events: readonly AgentEvent[], clock: () => number = () => 0): AgentStep[] {
  let steps: AgentStep[] = [];
  for (const event of events) steps = applyAgentEvent(steps, event, clock());
  return steps;
}

/** Primer aviso accionable de configuración de búsqueda; `null` si está lista. */
export function researchWarning(input: ResearchWarningInput): ResearchWarning | null {
  if (input.proxy.mode === 'custom') {
    const baseUrl = (input.proxy.baseUrl ?? '').trim();
    if (baseUrl === '') return { kind: 'missingProxyUrl' };
    if (!isValidProxyUrl(baseUrl)) return { kind: 'invalidProxyUrl' };
  }
  if (input.search.mode === 'brave' && !input.keys.brave) return { kind: 'missingKey', provider: 'brave' };
  if (input.search.mode === 'tavily' && !input.keys.tavily) return { kind: 'missingKey', provider: 'tavily' };
  if (input.proxy.mode !== 'custom' && input.browser) {
    if (input.search.mode === 'duckduckgo') return { kind: 'browserWithoutProxy' };
    if (input.search.mode === 'auto' && !input.keys.brave && !input.keys.tavily) return { kind: 'browserWithoutProxy' };
  }
  return null;
}

function patchStep(steps: readonly AgentStep[], index: number, patch: (step: AgentStep) => AgentStep): AgentStep[] {
  return steps.map((step) => (step.index === index ? patch(step) : step));
}

/** URL absoluta http(s): evita que un valor corrupto derive en un bypass directo silencioso. */
function isValidProxyUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function clip(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 1)}…`;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
