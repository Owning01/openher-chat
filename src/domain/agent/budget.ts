import type { AgentBudget } from '../types/agent';
import type { TokenUsage } from '../types/chat';

/** Calibración inicial: el estimado heurístico se toma como bueno hasta ver usage real. */
export const INITIAL_CALIBRATION = 1;
export const MIN_CALIBRATION = 0.25;
export const MAX_CALIBRATION = 4;

/** Backoff base y techo para reintentos pre-primer-delta. */
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 8_000;
/** Techo defensivo para `Retry-After` (nunca dormir más de un minuto). */
export const RETRY_MAX_RETRY_AFTER_MS = 60_000;

export type BudgetLimit = 'steps' | 'toolCalls' | 'tokens' | 'wallClock';

/** Estado mutable del presupuesto de un run. Los contadores se incrementan al cerrar cada unidad. */
export interface BudgetState {
  startedAt: number;
  lastNow: number;
  elapsedMs: number;
  steps: number;
  toolCalls: number;
  tokensUsed: number;
  calibration: number;
}

export function createBudgetState(startedAt: number): BudgetState {
  return {
    startedAt,
    lastNow: startedAt,
    elapsedMs: 0,
    steps: 0,
    toolCalls: 0,
    tokensUsed: 0,
    calibration: INITIAL_CALIBRATION,
  };
}

/** Tolera `NaN`/`Infinity` en cualquier campo del usage: se tratan como ausentes. */
function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Tokens atribuibles a un usage: `totalTokens` si existe; si no, prompt + completion. */
export function usageTokens(usage: TokenUsage | undefined): number {
  if (usage === undefined) return 0;
  const total = finiteNumber(usage.totalTokens);
  if (total !== undefined) return total;
  const prompt = finiteNumber(usage.promptTokens);
  const completion = finiteNumber(usage.completionTokens);
  if (prompt === undefined && completion === undefined) return 0;
  return (prompt ?? 0) + (completion ?? 0);
}

/** Suma campo a campo dos usages sin inventar valores ausentes ni propagar valores no finitos. */
export function accumulateUsage(total: TokenUsage | undefined, usage: TokenUsage | undefined): TokenUsage | undefined {
  if (usage === undefined) return total;
  const prompt = finiteNumber(usage.promptTokens);
  const completion = finiteNumber(usage.completionTokens);
  const totalTokens = finiteNumber(usage.totalTokens);
  if (prompt === undefined && completion === undefined && totalTokens === undefined) return total;

  const next: TokenUsage = { ...total };
  if (prompt !== undefined) next.promptTokens = (total?.promptTokens ?? 0) + prompt;
  if (completion !== undefined) next.completionTokens = (total?.completionTokens ?? 0) + completion;
  if (totalTokens !== undefined) {
    next.totalTokens = (total?.totalTokens ?? 0) + totalTokens;
  } else if (prompt !== undefined && completion !== undefined) {
    next.totalTokens = (total?.totalTokens ?? 0) + prompt + completion;
  }
  return next;
}

/**
 * Registra el usage real de un paso: acumula tokens y recalibra la heurística con
 * `realPromptTokens / estimatedPromptTokens`, acotado para que un usage anómalo
 * no rompa el presupuesto.
 */
export function registerStepUsage(state: BudgetState, usage: TokenUsage | undefined, estimatedPromptTokens: number): void {
  state.tokensUsed += usageTokens(usage);
  const realPromptTokens = usage?.promptTokens;
  if (
    typeof realPromptTokens === 'number' &&
    Number.isFinite(realPromptTokens) &&
    realPromptTokens > 0 &&
    estimatedPromptTokens > 0
  ) {
    state.calibration = clamp(realPromptTokens / estimatedPromptTokens, MIN_CALIBRATION, MAX_CALIBRATION);
  }
}

/** Tokens proyectados del prompt siguiente: ya consumidos + estimado calibrado. */
export function projectedTokens(state: BudgetState, estimatedPromptTokens: number): number {
  const estimate = Number.isFinite(estimatedPromptTokens) ? Math.max(0, estimatedPromptTokens) : 0;
  return state.tokensUsed + Math.ceil(estimate * state.calibration);
}

/**
 * Wall-clock monótono del run: acumula solo deltas positivos, de modo que un reloj
 * que retrocede no reinicie ni desactive el tope de tiempo.
 */
export function elapsedWallClock(state: BudgetState, now: number): number {
  const delta = now - state.lastNow;
  if (Number.isFinite(delta) && delta > 0) {
    state.elapsedMs += delta;
    state.lastNow = now;
  }
  return state.elapsedMs;
}

/**
 * Primer límite agotado para iniciar (o reintentar) un paso. Se evalúa ANTES de
 * cada paso; `toolsEnabled` evita que el tope de tool calls bloquee runs sin tools.
 */
export function findBudgetLimit(
  state: BudgetState,
  budget: AgentBudget,
  now: number,
  estimatedPromptTokens: number,
  toolsEnabled: boolean,
): BudgetLimit | null {
  if (!(state.steps < budget.maxSteps)) return 'steps';
  if (toolsEnabled && !(state.toolCalls < budget.maxToolCalls)) return 'toolCalls';
  if (projectedTokens(state, estimatedPromptTokens) > budget.maxTotalTokens) return 'tokens';
  if (elapsedWallClock(state, now) >= budget.maxWallClockMs) return 'wallClock';
  return null;
}

/**
 * Backoff exponencial con jitter acotado [0.5x, 1x] del tramo, respetando
 * `Retry-After` si supera el backoff. `random` es inyectable para tests.
 */
export function computeRetryDelay(attempt: number, retryAfterMs?: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0));
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.min(exponent, 10));
  const jittered = Math.round(base * (0.5 + 0.5 * clamp(random(), 0, 1)));
  const retryAfter =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(retryAfterMs, RETRY_MAX_RETRY_AFTER_MS)
      : 0;
  return Math.max(jittered, retryAfter);
}

export type TimeoutOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'timeout' }
  | { status: 'aborted' }
  | { status: 'rejected'; error: unknown };

/**
 * Ejecuta `run(signal)` con techo de tiempo y aborto externo. Limpia timer y
 * listener en todos los caminos; nunca deja una rejection sin manejar. El signal
 * entregado al callback se aborta en timeout o aborto externo.
 */
export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal: AbortSignal,
): Promise<TimeoutOutcome<T>> {
  if (externalSignal.aborted) return Promise.resolve({ status: 'aborted' });
  return new Promise<TimeoutOutcome<T>>((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const settle = (outcome: TimeoutOutcome<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => {
      controller.abort();
      settle({ status: 'aborted' });
    };
    const timer = setTimeout(() => {
      controller.abort();
      settle({ status: 'timeout' });
    }, sanitizeDelay(timeoutMs));
    externalSignal.addEventListener('abort', onAbort, { once: true });
    try {
      run(controller.signal).then(
        (value) => settle({ status: 'ok', value }),
        (error: unknown) => settle({ status: 'rejected', error }),
      );
    } catch (error) {
      // `execute` puede lanzar síncrono: se convierte en un outcome controlado.
      settle({ status: 'rejected', error });
    }
  });
}

export type SleepOutcome = 'slept' | 'aborted';

/** Espera cancelable usada por el backoff de reintentos. */
export function sleepAbortable(ms: number, signal: AbortSignal): Promise<SleepOutcome> {
  if (signal.aborted) return Promise.resolve('aborted');
  const delay = sanitizeDelay(ms);
  if (delay === 0) return Promise.resolve('slept');
  return new Promise<SleepOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: SleepOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => finish('aborted');
    const timer = setTimeout(() => finish('slept'), delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sanitizeDelay(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
