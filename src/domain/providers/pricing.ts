import type { TokenUsage } from '../types/chat';

/**
 * Precio de referencia en USD por 1M tokens. Es una **estimación** pensada para
 * dar orden de magnitud: cada proveedor fija sus precios y pueden cambiar, y los
 * modelos locales (Ollama/LM Studio/vLLM) no tienen coste asociado.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** Entrada servida desde caché (lectura). Si falta, se usa `input`. */
  cachedInput?: number;
  /** Entrada escrita en caché (Anthropic). Si falta, se usa `input`. */
  cacheWrite?: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  total: number;
  currency: 'USD';
}

interface PriceRule {
  match: RegExp;
  price: ModelPrice;
}

/** Órden importante: las reglas más específicas van antes que sus prefijos. */
const PRICE_RULES: readonly PriceRule[] = [
  { match: /gpt-4o-mini/, price: { input: 0.15, output: 0.6, cachedInput: 0.075 } },
  { match: /gpt-4o/, price: { input: 2.5, output: 10, cachedInput: 1.25 } },
  { match: /gpt-4\.1-mini/, price: { input: 0.4, output: 1.6, cachedInput: 0.1 } },
  { match: /gpt-4\.1/, price: { input: 2, output: 8, cachedInput: 0.5 } },
  { match: /o4-mini/, price: { input: 1.1, output: 4.4, cachedInput: 0.275 } },
  { match: /\bo3\b/, price: { input: 2, output: 8, cachedInput: 0.5 } },
  { match: /claude-3[-.]5-haiku/, price: { input: 0.8, output: 4, cachedInput: 0.08, cacheWrite: 1 } },
  { match: /claude.*opus/, price: { input: 15, output: 75, cachedInput: 1.5, cacheWrite: 18.75 } },
  { match: /claude.*sonnet/, price: { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } },
  { match: /gemini.*flash/, price: { input: 0.3, output: 2.5, cachedInput: 0.075 } },
  { match: /gemini.*pro/, price: { input: 1.25, output: 10, cachedInput: 0.31 } },
  { match: /deepseek.*reasoner/, price: { input: 0.55, output: 2.19, cachedInput: 0.14 } },
  { match: /deepseek/, price: { input: 0.27, output: 1.1, cachedInput: 0.07 } },
  { match: /llama-3\.3-70b/, price: { input: 0.59, output: 0.79 } },
  { match: /llama-3\.1-8b/, price: { input: 0.05, output: 0.08 } },
  { match: /glm-4\.5/, price: { input: 0.6, output: 2.2, cachedInput: 0.11 } },
  { match: /kimi-k2/, price: { input: 0.6, output: 2.5, cachedInput: 0.15 } },
  { match: /minimax/, price: { input: 0.3, output: 1.2 } },
  { match: /qwen.*(235b|72b)/, price: { input: 0.2, output: 0.6 } },
];

/** Precio de referencia de un modelo por id (match parcial), o `null` si no se conoce. */
export function findModelPrice(modelId: string): ModelPrice | null {
  const normalized = modelId.toLowerCase();
  for (const rule of PRICE_RULES) {
    if (rule.match.test(normalized)) return rule.price;
  }
  return null;
}

/** Coste estimado de un `TokenUsage` concreto. Devuelve `null` sin precio conocido. */
export function estimateCost(modelId: string | undefined, usage: TokenUsage): CostBreakdown | null {
  if (modelId === undefined) return null;
  const price = findModelPrice(modelId);
  if (price === null) return null;

  const prompt = usage.promptTokens ?? 0;
  const cached = usage.cachedPromptTokens ?? 0;
  const cacheWrite = usage.cacheWritePromptTokens ?? 0;
  const completion = usage.completionTokens ?? 0;
  // `promptTokens` es el total de entrada (incluye caché, igual que OpenAI y Anthropic normalizada).
  const fresh = Math.max(0, prompt - cached - cacheWrite);

  const input =
    (fresh * price.input + cached * (price.cachedInput ?? price.input) + cacheWrite * (price.cacheWrite ?? price.input)) /
    1_000_000;
  const output = (completion * price.output) / 1_000_000;
  return { input, output, total: input + output, currency: 'USD' };
}

export interface UsageCarrier {
  modelId?: string;
  usage?: TokenUsage;
}

/** Suma el coste de todos los mensajes con precio conocido; `null` si no hay ninguno. */
export function totalCost(messages: readonly UsageCarrier[]): CostBreakdown | null {
  let input = 0;
  let output = 0;
  let priced = false;
  for (const message of messages) {
    if (message.usage === undefined) continue;
    const cost = estimateCost(message.modelId, message.usage);
    if (cost === null) continue;
    priced = true;
    input += cost.input;
    output += cost.output;
  }
  return priced ? { input, output, total: input + output, currency: 'USD' } : null;
}

/** Suma de tokens de una conversación (para el panel de uso). */
export function totalTokens(messages: readonly UsageCarrier[]): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let cached = 0;
  let cacheWrite = 0;
  for (const message of messages) {
    if (message.usage === undefined) continue;
    promptTokens += message.usage.promptTokens ?? 0;
    completionTokens += message.usage.completionTokens ?? 0;
    cached += message.usage.cachedPromptTokens ?? 0;
    cacheWrite += message.usage.cacheWritePromptTokens ?? 0;
  }
  const total: TokenUsage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
  if (cached > 0) total.cachedPromptTokens = cached;
  if (cacheWrite > 0) total.cacheWritePromptTokens = cacheWrite;
  return total;
}
