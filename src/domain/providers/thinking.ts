import type { ThinkingLevel } from '../types/provider';

/**
 * Soporte de thinking en `/chat/completions` y presupuestos de Anthropic.
 * Los transportes nativos (Anthropic `/messages`, OpenAI `/responses`) aceptan
 * sus parámetros siempre; en `chat-completions` sólo se envían cuando el modelo
 * lo soporta (flag explícito o inferencia por id).
 */

/** Modelos de `chat-completions` con razonamiento conocido (prefijos, minúsculas). */
const THINKING_ID_PATTERNS: readonly RegExp[] = [
  /deepseek-reasoner/i,
  /qwq/i,
  /gpt-oss/i,
  /kimi-k2-thinking/i,
  /(^|[-_/])thinking([-_/]|$)/i,
];

/** Fracción de `max_tokens` dedicada al presupuesto de thinking (Anthropic). */
const THINKING_BUDGET_FRACTIONS: Readonly<Record<Exclude<ThinkingLevel, 'off'>, number>> = {
  low: 0.1,
  medium: 0.25,
  high: 0.5,
  max: 0.8,
};

/** Presupuesto mínimo aceptado por la API de Anthropic. */
const MIN_THINKING_BUDGET = 1024;

/**
 * ¿Este id de modelo razona en `chat-completions`? Heurística curada y
 * conservadora: ante la duda devuelve `false` (no se envía nada).
 */
export function inferThinkingSupport(modelId: string): boolean {
  const id = modelId.trim();
  if (id === '') return false;
  return THINKING_ID_PATTERNS.some((pattern) => pattern.test(id));
}

/**
 * Presupuesto `budget_tokens` para Anthropic: fracción del nivel sobre
 * `maxTokens`, acotado a `[1024, maxTokens - 1]`. Devuelve `null` cuando el
 * nivel es `off` o cuando no cabe (ventana demasiado chica): el adapter debe
 * omitir `thinking` en ese caso en vez de mandar un payload inválido.
 */
export function thinkingBudgetTokens(level: ThinkingLevel, maxTokens: number): number | null {
  if (level === 'off') return null;
  if (!Number.isFinite(maxTokens) || maxTokens <= MIN_THINKING_BUDGET + 1) return null;
  const raw = Math.floor(maxTokens * THINKING_BUDGET_FRACTIONS[level]);
  const budget = Math.max(MIN_THINKING_BUDGET, raw);
  if (budget >= maxTokens) return null;
  return budget;
}
