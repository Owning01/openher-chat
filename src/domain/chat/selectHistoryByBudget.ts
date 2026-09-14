import { DEFAULT_HISTORY_BUDGET } from '../settings/defaults';
import type { ChatMessage, MessageContent } from '../types/chat';
import type { HistoryBudget } from '../types/settings';
import { estimateMessageTokens, estimateTokens } from './estimateTokens';
import { truncateText } from './truncateText';

/** Presupuesto mínimo absoluto de prompt, aunque la ventana o el fixed sean diminutos. */
export const MIN_PROMPT_BUDGET_TOKENS = 512;
/** Fallback cuando el modo no es fixed y no hay contextWindow conocido. */
export const DEFAULT_PROMPT_BUDGET_TOKENS = 8192;
/** Fracción de la ventana de contexto usable por el prompt (el resto calibra la salida). */
export const AUTO_CONTEXT_USAGE = 0.65;
/** Rango permitido para `truncateMessageAtPercent`. */
export const MIN_TRUNCATE_MESSAGE_PERCENT = 0.05;
export const MAX_TRUNCATE_MESSAGE_PERCENT = 1;
/** Fallbacks para settings corruptos, alineados con `DEFAULT_HISTORY_BUDGET`. */
export const FALLBACK_KEEP_LAST_TURNS = DEFAULT_HISTORY_BUDGET.keepLastTurns;
export const FALLBACK_TRUNCATE_MESSAGE_PERCENT = DEFAULT_HISTORY_BUDGET.truncateMessageAtPercent;
export const FALLBACK_RESERVED_OUTPUT_TOKENS = DEFAULT_HISTORY_BUDGET.reservedOutputTokens;

export interface SelectHistoryByBudgetInput {
  history: ChatMessage[];
  userMessage: ChatMessage;
  system?: string;
  budget: HistoryBudget;
  contextWindow?: number;
  /**
   * AMEND §A6 (aditivo): tokens reservados para contenido que viaja al wire fuera
   * del historial seleccionado (p. ej. `ephemeralSuffix`). Fórmula:
   * `presupuestoEfectivo = max(0, resolvePromptBudget(budget, contextWindow) - reservedTokens)`.
   * El historial se elige contra ese presupuesto efectivo y `estimatedPromptTokens`
   * no lo incluye (mide sólo lo persistido). `undefined`/no finito/≤ 0 ⇒ 0, de modo
   * que el cálculo previo queda idéntico.
   */
  reservedTokens?: number;
}

export interface HistorySelection {
  /** Historial seleccionado (sin system ni userMessage); los recortes son copias solo para el wire. */
  messages: ChatMessage[];
  /** Cantidad de mensajes del historial descartados por presupuesto. */
  droppedCount: number;
  /** Tokens estimados del prompt completo: system + historial conservado + user. */
  estimatedPromptTokens: number;
}

/**
 * Resuelve el presupuesto de prompt: fixed explícito o auto (65% de la ventana
 * - salida reservada). Valores no finitos o ≤ 0 se sanean con el fallback por
 * modo: fixed → 512, auto → 8192 (o la ventana si es válida).
 */
export function resolvePromptBudget(budget: HistoryBudget, contextWindow?: number): number {
  if (budget.mode === 'fixed') {
    const fixed = budget.maxPromptTokens;
    const tokens = typeof fixed === 'number' && Number.isFinite(fixed) && fixed > 0 ? fixed : MIN_PROMPT_BUDGET_TOKENS;
    return Math.max(MIN_PROMPT_BUDGET_TOKENS, Math.floor(tokens));
  }

  const reserved = sanitizeReservedOutputTokens(budget.reservedOutputTokens);
  const tokens =
    typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0
      ? contextWindow * AUTO_CONTEXT_USAGE - reserved
      : DEFAULT_PROMPT_BUDGET_TOKENS;
  return Math.max(MIN_PROMPT_BUDGET_TOKENS, Math.floor(tokens));
}

/**
 * Devuelve una copia recortada head+tail (60/40) del mensaje cuando excede
 * `maxTokens`; el original nunca se muta. Si no hay bloques de texto que
 * recortar (p. ej. solo tool-call), devuelve el mismo mensaje.
 */
export function truncateMessageForWire(message: ChatMessage, maxTokens: number): ChatMessage {
  if (estimateMessageTokens(message) <= maxTokens) return message;
  const textBlocks = message.content.filter(isTextBearing);
  if (textBlocks.length === 0) return message;
  const charsPerBlock = Math.max(1, Math.floor((maxTokens * 4) / textBlocks.length));

  const content = message.content.map((block): MessageContent => {
    switch (block.type) {
      case 'text': {
        const text = truncateText(block.text, charsPerBlock);
        return text === block.text ? block : { type: 'text', text };
      }
      case 'reasoning': {
        const text = truncateText(block.text, charsPerBlock);
        return text === block.text ? block : { type: 'reasoning', text };
      }
      case 'tool-result': {
        const text = truncateText(block.result.content, charsPerBlock);
        return text === block.result.content ? block : { ...block, result: { ...block.result, content: text } };
      }
      default:
        return block;
    }
  });

  const changed = content.some((block, index) => block !== message.content[index]);
  return changed ? { ...message, content } : message;
}

/**
 * Selecciona el historial que cabe en el presupuesto:
 * - system y el último user siempre están presentes en el wire (el caller los agrega).
 * - Se descartan turnos completos desde el más viejo (siempre sufijo contiguo).
 * - `keepLastTurns` es el mínimo de turnos recientes garantizados aunque excedan.
 * - Un mensaje > truncateMessageAtPercent del presupuesto se recorta (copia) para el wire.
 * - `mode:'auto'`: contextWindow * 0.65 - reservedOutputTokens (fallback 8192); mínimo 512.
 * - Valores no finitos/fuera de rango se sanean con los fallbacks documentados.
 * - `reservedTokens` (aditivo) se resta del presupuesto resuelto antes de elegir
 *   historial: `efectivo = max(0, promptBudget - reservedTokens)`.
 */
export function selectHistoryByBudget(input: SelectHistoryByBudgetInput): HistorySelection {
  const { budget, system, contextWindow, userMessage } = input;
  const history = input.history.filter((message) => message.id !== userMessage.id);
  const promptBudget = resolvePromptBudget(budget, contextWindow);
  // AMEND §A6: reserva para el sufijo efímero; nunca negativa ni no finita.
  const effectiveBudget = Math.max(0, promptBudget - sanitizeReservedTokens(input.reservedTokens));
  const percent = sanitizeTruncateMessagePercent(budget.truncateMessageAtPercent);
  const maxMessageTokens = Math.max(1, Math.floor(effectiveBudget * percent));

  const systemTokens = system !== undefined && system.length > 0 ? estimateTokens(system) : 0;
  const userTokens = estimateMessageTokens(truncateMessageForWire(userMessage, maxMessageTokens));

  const turns = splitTurns(history);
  const turnCosts = turns.map((turn) => estimateTurnTokens(turn, maxMessageTokens));
  const keepLastTurns = Math.min(sanitizeKeepLastTurns(budget.keepLastTurns), turns.length);
  const mandatoryStart = turns.length - keepLastTurns;

  let remaining = effectiveBudget - systemTokens - userTokens;
  for (let index = mandatoryStart; index < turns.length; index += 1) {
    remaining -= turnCosts[index] ?? 0;
  }

  let keepFromTurn = mandatoryStart;
  for (let index = mandatoryStart - 1; index >= 0; index -= 1) {
    const cost = turnCosts[index] ?? Number.POSITIVE_INFINITY;
    if (cost <= remaining) {
      remaining -= cost;
      keepFromTurn = index;
    } else {
      break;
    }
  }

  const messages: ChatMessage[] = [];
  for (let index = keepFromTurn; index < turns.length; index += 1) {
    for (const message of turns[index] ?? []) {
      messages.push(truncateMessageForWire(message, maxMessageTokens));
    }
  }

  let estimatedPromptTokens = systemTokens + userTokens;
  for (let index = keepFromTurn; index < turnCosts.length; index += 1) {
    estimatedPromptTokens += turnCosts[index] ?? 0;
  }

  return {
    messages,
    droppedCount: countMessages(turns.slice(0, keepFromTurn)),
    estimatedPromptTokens,
  };
}

function sanitizeReservedOutputTokens(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : FALLBACK_RESERVED_OUTPUT_TOKENS;
}

/** `reservedTokens` aditivo: no finito/negativo/ausente ⇒ 0 (sin reserva). */
function sanitizeReservedTokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sanitizeKeepLastTurns(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : FALLBACK_KEEP_LAST_TURNS;
}

function sanitizeTruncateMessagePercent(value: number): number {
  const percent = Number.isFinite(value) ? value : FALLBACK_TRUNCATE_MESSAGE_PERCENT;
  return Math.min(MAX_TRUNCATE_MESSAGE_PERCENT, Math.max(MIN_TRUNCATE_MESSAGE_PERCENT, percent));
}

function isTextBearing(block: MessageContent): boolean {
  return block.type === 'text' || block.type === 'reasoning' || block.type === 'tool-result';
}

function splitTurns(history: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === 'user' && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function estimateTurnTokens(turn: ChatMessage[], maxMessageTokens: number): number {
  let total = 0;
  for (const message of turn) total += estimateMessageTokens(truncateMessageForWire(message, maxMessageTokens));
  return total;
}

function countMessages(turns: ChatMessage[][]): number {
  let total = 0;
  for (const turn of turns) total += turn.length;
  return total;
}
