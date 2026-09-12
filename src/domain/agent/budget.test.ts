import { describe, expect, it } from 'vitest';
import type { AgentBudget } from '../types/agent';
import type { TokenUsage } from '../types/chat';
import {
  MAX_CALIBRATION,
  MIN_CALIBRATION,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_MAX_RETRY_AFTER_MS,
  accumulateUsage,
  computeRetryDelay,
  createBudgetState,
  findBudgetLimit,
  projectedTokens,
  registerStepUsage,
  sleepAbortable,
  usageTokens,
  withTimeout,
} from './budget';

function budget(overrides: Partial<AgentBudget> = {}): AgentBudget {
  return {
    maxSteps: 6,
    maxToolCalls: 8,
    maxToolResultChars: 6000,
    maxTotalTokens: 60_000,
    maxWallClockMs: 120_000,
    maxRetriesPerStep: 2,
    toolTimeoutMs: 15_000,
    ...overrides,
  };
}

describe('createBudgetState', () => {
  it('inicia contadores en cero y calibración neutra', () => {
    const state = createBudgetState(123);
    expect(state).toEqual({
      startedAt: 123,
      lastNow: 123,
      elapsedMs: 0,
      steps: 0,
      toolCalls: 0,
      tokensUsed: 0,
      calibration: 1,
    });
  });
});

describe('usageTokens', () => {
  it('prefiere totalTokens cuando existe', () => {
    expect(usageTokens({ promptTokens: 10, completionTokens: 5, totalTokens: 99 })).toBe(99);
  });

  it('suma prompt + completion si no hay total', () => {
    expect(usageTokens({ promptTokens: 10, completionTokens: 5 })).toBe(15);
  });

  it('devuelve 0 sin usage o sin campos', () => {
    expect(usageTokens(undefined)).toBe(0);
    expect(usageTokens({})).toBe(0);
  });

  it('ignora campos no finitos sin contaminar el total', () => {
    expect(usageTokens({ promptTokens: Number.NaN, completionTokens: 5 })).toBe(5);
    expect(usageTokens({ promptTokens: Number.POSITIVE_INFINITY, completionTokens: 5 })).toBe(5);
    expect(usageTokens({ totalTokens: Number.NaN, promptTokens: 7 })).toBe(7);
    expect(usageTokens({ promptTokens: Number.NaN, completionTokens: Number.NaN })).toBe(0);
  });
});

describe('accumulateUsage', () => {
  it('suma campo a campo y calcula el total cuando hay prompt + completion', () => {
    const first = accumulateUsage(undefined, { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    const second = accumulateUsage(first, { promptTokens: 5, completionTokens: 1 });
    expect(second).toEqual({ promptTokens: 15, completionTokens: 3, totalTokens: 18 });
  });

  it('no inventa campos ausentes', () => {
    const result = accumulateUsage({ promptTokens: 4 }, { promptTokens: 6 });
    expect(result).toEqual({ promptTokens: 10 });
  });

  it('conserva el total previo aunque falte en el nuevo usage', () => {
    const result = accumulateUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }, { completionTokens: 3 });
    expect(result).toEqual({ promptTokens: 1, completionTokens: 4, totalTokens: 2 });
  });

  it('devuelve el acumulado sin cambios cuando el usage es undefined', () => {
    const current: TokenUsage = { totalTokens: 7 };
    expect(accumulateUsage(current, undefined)).toEqual(current);
  });

  it('no propaga valores no finitos ni inventa totales', () => {
    expect(accumulateUsage(undefined, { promptTokens: Number.NaN, completionTokens: 4 })).toEqual({
      completionTokens: 4,
    });
    expect(accumulateUsage({ promptTokens: 2 }, { totalTokens: Number.POSITIVE_INFINITY })).toEqual({
      promptTokens: 2,
    });
    expect(accumulateUsage({ promptTokens: 1, completionTokens: 1 }, { completionTokens: Number.NaN })).toEqual({
      promptTokens: 1,
      completionTokens: 1,
    });
  });
});

describe('registerStepUsage', () => {
  it('acumula tokens y calibra con real/estimado', () => {
    const state = createBudgetState(0);
    registerStepUsage(state, { promptTokens: 200, completionTokens: 50, totalTokens: 250 }, 100);
    expect(state.tokensUsed).toBe(250);
    expect(state.calibration).toBe(2);
  });

  it('acota la calibración entre MIN y MAX', () => {
    const state = createBudgetState(0);
    registerStepUsage(state, { promptTokens: 1000 }, 100);
    expect(state.calibration).toBe(MAX_CALIBRATION);

    registerStepUsage(state, { promptTokens: 1 }, 100);
    expect(state.calibration).toBe(MIN_CALIBRATION);
  });

  it('ignora calibración con estimado o prompt no positivos', () => {
    const state = createBudgetState(0);
    registerStepUsage(state, undefined, 100);
    registerStepUsage(state, { promptTokens: 50 }, 0);
    registerStepUsage(state, { completionTokens: 10 }, 100);
    expect(state.calibration).toBe(1);
    expect(state.tokensUsed).toBe(60);
  });

  it('ignora usage no finito para tokens y calibración', () => {
    const state = createBudgetState(0);
    registerStepUsage(
      state,
      { promptTokens: Number.NaN, completionTokens: Number.POSITIVE_INFINITY, totalTokens: Number.NaN },
      100,
    );
    expect(state.tokensUsed).toBe(0);
    expect(state.calibration).toBe(1);
    expect(projectedTokens(state, 50)).toBe(50);
  });
});

describe('projectedTokens', () => {
  it('aplica la calibración vigente', () => {
    const state = createBudgetState(0);
    state.tokensUsed = 100;
    state.calibration = 2;
    expect(projectedTokens(state, 50)).toBe(200);
  });

  it('sanea estimados no finitos o negativos', () => {
    const state = createBudgetState(0);
    state.tokensUsed = 10;
    expect(projectedTokens(state, Number.NaN)).toBe(10);
    expect(projectedTokens(state, -50)).toBe(10);
  });
});

describe('findBudgetLimit', () => {
  it('devuelve null cuando todo cabe', () => {
    const state = createBudgetState(0);
    expect(findBudgetLimit(state, budget(), 1000, 100, true)).toBeNull();
  });

  it('detecta pasos agotados', () => {
    const state = createBudgetState(0);
    state.steps = 6;
    expect(findBudgetLimit(state, budget(), 0, 100, false)).toBe('steps');
  });

  it('detecta tool calls agotados solo si las tools están habilitadas', () => {
    const state = createBudgetState(0);
    state.toolCalls = 8;
    expect(findBudgetLimit(state, budget(), 0, 100, true)).toBe('toolCalls');
    expect(findBudgetLimit(state, budget(), 0, 100, false)).toBeNull();
  });

  it('detecta tokens agotados con el estimado calibrado', () => {
    const state = createBudgetState(0);
    state.tokensUsed = 900;
    state.calibration = 2;
    expect(findBudgetLimit(state, budget({ maxTotalTokens: 1000 }), 0, 100, false)).toBe('tokens');
  });

  it('detecta wall-clock agotado', () => {
    const state = createBudgetState(0);
    expect(findBudgetLimit(state, budget({ maxWallClockMs: 120_000 }), 120_000, 100, true)).toBe('wallClock');
  });

  it('acumula wall-clock monótono aunque el reloj retroceda', () => {
    const state = createBudgetState(10_000);
    expect(findBudgetLimit(state, budget({ maxWallClockMs: 62_000 }), 5_000, 100, false)).toBeNull();
    expect(findBudgetLimit(state, budget({ maxWallClockMs: 62_000 }), 70_000, 100, false)).toBeNull();
    expect(findBudgetLimit(state, budget({ maxWallClockMs: 62_000 }), 72_000, 100, false)).toBe('wallClock');
  });
});

describe('computeRetryDelay', () => {
  it('aplica backoff exponencial con jitter acotado', () => {
    expect(computeRetryDelay(0, undefined, () => 0)).toBe(RETRY_BASE_DELAY_MS / 2);
    expect(computeRetryDelay(0, undefined, () => 1)).toBe(RETRY_BASE_DELAY_MS);
    expect(computeRetryDelay(1, undefined, () => 0)).toBe(RETRY_BASE_DELAY_MS);
  });

  it('no supera el techo de backoff', () => {
    expect(computeRetryDelay(10, undefined, () => 1)).toBe(RETRY_MAX_DELAY_MS);
  });

  it('respeta Retry-After si supera el backoff', () => {
    expect(computeRetryDelay(0, 3000, () => 0)).toBe(3000);
    expect(computeRetryDelay(0, RETRY_MAX_RETRY_AFTER_MS * 10, () => 0)).toBe(RETRY_MAX_RETRY_AFTER_MS);
  });

  it('ignora Retry-After inválido', () => {
    expect(computeRetryDelay(0, Number.NaN, () => 0)).toBe(RETRY_BASE_DELAY_MS / 2);
    expect(computeRetryDelay(0, -5, () => 0)).toBe(RETRY_BASE_DELAY_MS / 2);
  });

  it('sanea un attempt no finito', () => {
    expect(computeRetryDelay(Number.NaN, undefined, () => 0)).toBe(RETRY_BASE_DELAY_MS / 2);
  });
});

describe('withTimeout', () => {
  it('devuelve ok cuando la tarea termina antes del timeout', async () => {
    const outcome = await withTimeout(async () => 42, 50, new AbortController().signal);
    expect(outcome).toEqual({ status: 'ok', value: 42 });
  });

  it('corta por timeout y aborta el signal entregado a la tarea', async () => {
    let taskSignalAborted = false;
    const outcome = await withTimeout(
      (signal) =>
        new Promise<void>(() => {
          signal.addEventListener('abort', () => {
            taskSignalAborted = true;
          });
        }),
      10,
      new AbortController().signal,
    );
    expect(outcome).toEqual({ status: 'timeout' });
    expect(taskSignalAborted).toBe(true);
  });

  it('devuelve aborted sin ejecutar la tarea si el signal externo ya está abortado', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const outcome = await withTimeout(async () => {
      called = true;
      return 1;
    }, 50, controller.signal);
    expect(outcome).toEqual({ status: 'aborted' });
    expect(called).toBe(false);
  });

  it('corta por aborto externo durante la tarea', async () => {
    const controller = new AbortController();
    let taskSignalAborted = false;
    const pending = withTimeout(
      (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              taskSignalAborted = true;
              resolve();
            },
            { once: true },
          );
        }),
      1000,
      controller.signal,
    );
    controller.abort();
    expect(await pending).toEqual({ status: 'aborted' });
    expect(taskSignalAborted).toBe(true);
  });

  it('propaga rejection como outcome rejected', async () => {
    const outcome = await withTimeout(async () => {
      throw new Error('boom');
    }, 50, new AbortController().signal);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.error).toBeInstanceOf(Error);
  });

  it('convierte un throw síncrono de la tarea en outcome rejected', async () => {
    const outcome = await withTimeout(() => {
      throw new Error('sync boom');
    }, 50, new AbortController().signal);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toBe('sync boom');
    }
  });

  it('ignora un segundo settle cuando la tarea aborta su propio signal', async () => {
    const controller = new AbortController();
    const outcome = await withTimeout(async () => {
      controller.abort();
      return 1;
    }, 50, controller.signal);
    expect(outcome).toEqual({ status: 'aborted' });
  });
});

describe('sleepAbortable', () => {
  it('duerme y resuelve slept', async () => {
    await expect(sleepAbortable(1, new AbortController().signal)).resolves.toBe('slept');
  });

  it('resuelve slept sin timer si el delay es 0 o inválido', async () => {
    await expect(sleepAbortable(0, new AbortController().signal)).resolves.toBe('slept');
    await expect(sleepAbortable(Number.NaN, new AbortController().signal)).resolves.toBe('slept');
  });

  it('resuelve aborted si el signal ya estaba abortado', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepAbortable(5000, controller.signal)).resolves.toBe('aborted');
  });

  it('cancela la espera si aborta durante el sleep', async () => {
    const controller = new AbortController();
    const pending = sleepAbortable(5000, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe('aborted');
  });
});
