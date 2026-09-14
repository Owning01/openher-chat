import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/chat';
import type { HistoryBudget } from '../types/settings';
import {
  AUTO_CONTEXT_USAGE,
  DEFAULT_PROMPT_BUDGET_TOKENS,
  FALLBACK_KEEP_LAST_TURNS,
  FALLBACK_RESERVED_OUTPUT_TOKENS,
  MIN_PROMPT_BUDGET_TOKENS,
  resolvePromptBudget,
  selectHistoryByBudget,
} from './selectHistoryByBudget';

const CONVERSATION_ID = 'conv-1';
const SYSTEM_TOKENS = 1; // 'sys' = 3 bytes
const USER_TOKENS = 9; // overhead 4 + bloque 4 + 'abcd' 1
const ASSISTANT_TOKENS = 9;
const TURN_TOKENS = USER_TOKENS + ASSISTANT_TOKENS;
const GIANT_ASSISTANT_TOKENS = 221; // 'x'.repeat(1000) recortado para el wire a 816 chars + marcador 33 -> 849 + overhead 8
const GIANT_TURN_TOKENS = USER_TOKENS + GIANT_ASSISTANT_TOKENS;
const MEDIUM_ASSISTANT_TOKENS = 58; // 'y'.repeat(200) -> 50 tokens + overhead 8
const MEDIUM_TURN_TOKENS = USER_TOKENS + MEDIUM_ASSISTANT_TOKENS;

function userMessage(id: string, text = 'abcd'): ChatMessage {
  return {
    id,
    conversationId: CONVERSATION_ID,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: 0,
    updatedAt: 0,
  };
}

function assistantMessage(id: string, text = 'abcd'): ChatMessage {
  return {
    id,
    conversationId: CONVERSATION_ID,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: 0,
    updatedAt: 0,
  };
}

function turn(index: number): ChatMessage[] {
  return [userMessage(`u${index}`), assistantMessage(`a${index}`)];
}

function historyOf(...indexes: number[]): ChatMessage[] {
  return indexes.flatMap((index) => turn(index));
}

function budget(overrides: Partial<HistoryBudget> = {}): HistoryBudget {
  return {
    mode: 'fixed',
    maxPromptTokens: 512,
    reservedOutputTokens: 2048,
    keepLastTurns: 0,
    truncateMessageAtPercent: 0.4,
    ...overrides,
  };
}

describe('resolvePromptBudget', () => {
  it('usa fixed cuando maxPromptTokens está definido', () => {
    expect(resolvePromptBudget(budget({ maxPromptTokens: 4096 }), 100_000)).toBe(4096);
  });

  it('en auto usa contextWindow * 0.65 - reservedOutputTokens', () => {
    const auto = budget({ mode: 'auto', maxPromptTokens: null });
    expect(resolvePromptBudget(auto, 128_000)).toBe(Math.floor(128_000 * 0.65 - 2048));
    expect(resolvePromptBudget(auto, 128_000)).toBe(81_152);
  });

  it('sin contextWindow cae al fallback de 8192', () => {
    const auto = budget({ mode: 'auto', maxPromptTokens: null });
    expect(resolvePromptBudget(auto, undefined)).toBe(DEFAULT_PROMPT_BUDGET_TOKENS);
    expect(DEFAULT_PROMPT_BUDGET_TOKENS).toBe(8192);
  });

  it('aplica el mínimo absoluto de 512 tokens', () => {
    expect(resolvePromptBudget(budget({ maxPromptTokens: 100 }), undefined)).toBe(MIN_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(budget({ mode: 'auto', maxPromptTokens: null, reservedOutputTokens: 100_000 }), 2000)).toBe(512);
  });
});

describe('sanitización de HistoryBudget', () => {
  it('maxPromptTokens no finito o <= 0 usa el fallback por modo', () => {
    expect(resolvePromptBudget(budget({ maxPromptTokens: Number.NaN }), undefined)).toBe(MIN_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(budget({ maxPromptTokens: Number.POSITIVE_INFINITY }), 100_000)).toBe(MIN_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(budget({ maxPromptTokens: 0 }), undefined)).toBe(MIN_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(budget({ maxPromptTokens: -10 }), undefined)).toBe(MIN_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(budget({ maxPromptTokens: null }), 100_000)).toBe(MIN_PROMPT_BUDGET_TOKENS);

    const auto = budget({ mode: 'auto', maxPromptTokens: null });
    expect(resolvePromptBudget(auto, undefined)).toBe(DEFAULT_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(auto, Number.NaN)).toBe(DEFAULT_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(auto, Number.POSITIVE_INFINITY)).toBe(DEFAULT_PROMPT_BUDGET_TOKENS);
    expect(resolvePromptBudget(auto, 0)).toBe(DEFAULT_PROMPT_BUDGET_TOKENS);
  });

  it('reservedOutputTokens no finito o negativo cae a 2048', () => {
    const auto = budget({ mode: 'auto', maxPromptTokens: null });
    const expected = Math.floor(128_000 * AUTO_CONTEXT_USAGE - FALLBACK_RESERVED_OUTPUT_TOKENS);
    expect(resolvePromptBudget(auto, 128_000)).toBe(expected);
    expect(resolvePromptBudget({ ...auto, reservedOutputTokens: Number.NaN }, 128_000)).toBe(expected);
    expect(resolvePromptBudget({ ...auto, reservedOutputTokens: Number.POSITIVE_INFINITY }, 128_000)).toBe(expected);
    expect(resolvePromptBudget({ ...auto, reservedOutputTokens: -1 }, 128_000)).toBe(expected);
  });
});

describe('selectHistoryByBudget', () => {
  it('mantiene todo el historial cuando cabe', () => {
    const result = selectHistoryByBudget({
      history: historyOf(1, 2),
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(result.droppedCount).toBe(0);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + 2 * TURN_TOKENS);
  });

  it('descarta turnos completos desde el más viejo', () => {
    const giant = 'x'.repeat(1000);
    const history = [
      userMessage('u1'),
      assistantMessage('a1', giant),
      userMessage('u2'),
      assistantMessage('a2', giant),
      userMessage('u3'),
      assistantMessage('a3', giant),
    ];
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['u2', 'a2', 'u3', 'a3']);
    expect(result.droppedCount).toBe(2);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + 2 * GIANT_TURN_TOKENS);
  });

  it('conserva un sufijo contiguo y descarta el turno viejo gigante', () => {
    const history = [
      userMessage('u1'),
      assistantMessage('a1', 'x'.repeat(8000)),
      userMessage('u2'),
      assistantMessage('a2', 'y'.repeat(200)),
      userMessage('u3'),
      assistantMessage('a3', 'y'.repeat(200)),
      userMessage('u4'),
      assistantMessage('a4', 'y'.repeat(200)),
      userMessage('u5'),
      assistantMessage('a5', 'y'.repeat(200)),
      userMessage('u6'),
      assistantMessage('a6', 'y'.repeat(200)),
    ];
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
    expect(result.droppedCount).toBe(2);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + 5 * MEDIUM_TURN_TOKENS);
  });

  it('cuenta droppedCount en mensajes, no en turnos', () => {
    const history = [
      assistantMessage('a-1', 'x'.repeat(8000)),
      assistantMessage('a0', 'x'.repeat(8000)),
      assistantMessage('a0b', 'x'.repeat(8000)),
      ...turn(1),
      ...turn(2),
    ];
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(result.droppedCount).toBe(3);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + 2 * TURN_TOKENS);
  });

  it('system y user siempre quedan presentes aunque el historial no quepa', () => {
    const result = selectHistoryByBudget({
      history: historyOf(1, 2, 3),
      userMessage: userMessage('current'),
      system: 's'.repeat(4000),
      budget: budget(),
    });
    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(6);
    expect(result.estimatedPromptTokens).toBe(1000 + USER_TOKENS);
  });

  it('trunca un mensaje gigante solo para el wire y no muta el original', () => {
    const giant = 'a'.repeat(4000);
    const assistant = assistantMessage('a1', giant);
    const history = [userMessage('u1'), assistant];
    const before = JSON.stringify(history);
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.droppedCount).toBe(0);
    const selected = result.messages[1];
    expect(selected).toBeDefined();
    expect(selected).not.toBe(assistant);
    const selectedBlock = selected?.content[0];
    expect(selectedBlock?.type).toBe('text');
    if (selectedBlock?.type === 'text') {
      expect(selectedBlock.text).toContain('[... truncated 3184 chars ...]');
      expect(selectedBlock.text.length).toBeLessThan(giant.length);
    }
    const originalBlock = assistant.content[0];
    if (originalBlock?.type === 'text') expect(originalBlock.text).toBe(giant);
    expect(JSON.stringify(history)).toBe(before);
    // 4000 chars -> 816 chars recortados + marcador 34 -> 213 tokens + overhead 8 = 221
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + USER_TOKENS + GIANT_ASSISTANT_TOKENS);
  });

  it('trunca también el user message gigante para la estimación', () => {
    const giant = 'a'.repeat(4000);
    const giantUser = userMessage('current', giant);
    const result = selectHistoryByBudget({
      history: [],
      userMessage: giantUser,
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(0);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + GIANT_ASSISTANT_TOKENS);
    const block = giantUser.content[0];
    if (block?.type === 'text') expect(block.text).toBe(giant);
  });

  it('con auto + contextWindow descarta solo lo que excede la ventana', () => {
    const history = historyOf(...Array.from({ length: 100 }, (_, index) => index + 1));
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget({ mode: 'auto', maxPromptTokens: null, reservedOutputTokens: 0 }),
      contextWindow: 2000,
    });
    // presupuesto 1300 - system 1 - user 9 = 1290; 71 turnos de 18 = 1278
    expect(result.messages.length).toBe(142);
    expect(result.droppedCount).toBe(58);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + 71 * TURN_TOKENS);
  });

  it('con auto sin contextWindow usa 8192 y no descarta nada', () => {
    const history = historyOf(...Array.from({ length: 100 }, (_, index) => index + 1));
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget({ mode: 'auto', maxPromptTokens: null, reservedOutputTokens: 0 }),
    });
    expect(result.droppedCount).toBe(0);
    expect(result.messages.length).toBe(200);
  });

  it('respeta keepLastTurns aunque esos turnos excedan el presupuesto', () => {
    const giant = 'x'.repeat(1000);
    const history = [
      userMessage('u1'),
      assistantMessage('a1', giant),
      userMessage('u2'),
      assistantMessage('a2', giant),
      userMessage('u3'),
      assistantMessage('a3', giant),
      userMessage('u4'),
      assistantMessage('a4', giant),
    ];
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget({ keepLastTurns: 3 }),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
    expect(result.droppedCount).toBe(2);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + 3 * GIANT_TURN_TOKENS);
    expect(result.estimatedPromptTokens).toBeGreaterThan(512);
  });

  it('keepLastTurns mayor que el historial conserva todo', () => {
    const result = selectHistoryByBudget({
      history: historyOf(1, 2),
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget({ keepLastTurns: 10 }),
    });
    expect(result.messages.length).toBe(4);
    expect(result.droppedCount).toBe(0);
  });

  it('no muta el historial ni el user message', () => {
    const history = historyOf(1, 2, 3);
    const user = userMessage('current');
    const historyBefore = JSON.stringify(history);
    const userBefore = JSON.stringify(user);
    selectHistoryByBudget({ history, userMessage: user, system: 'sys', budget: budget() });
    expect(JSON.stringify(history)).toBe(historyBefore);
    expect(JSON.stringify(user)).toBe(userBefore);
  });

  it('trunca tool-results gigantes en la copia para el wire', () => {
    const original = 'z'.repeat(4000);
    const assistant: ChatMessage = {
      id: 'a1',
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      status: 'complete',
      content: [
        { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"query":"x"}' } },
        { type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: { ok: true, content: original, durationMs: 1 } },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const result = selectHistoryByBudget({
      history: [userMessage('u1'), assistant],
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    const selected = result.messages[1];
    expect(selected).not.toBe(assistant);
    const block = selected?.content[1];
    expect(block?.type).toBe('tool-result');
    if (block?.type === 'tool-result') {
      expect(block.result.content).toContain('[... truncated 3184 chars ...]');
      expect(block.result.content.length).toBeLessThan(original.length);
    }
    const originalBlock = assistant.content[1];
    if (originalBlock?.type === 'tool-result') expect(originalBlock.result.content).toBe(original);
  });

  it('con historial vacío devuelve selección vacía', () => {
    const result = selectHistoryByBudget({
      history: [],
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(0);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS);
  });

  it('ignora un duplicado del user message dentro del historial', () => {
    const duplicated = userMessage('current');
    const result = selectHistoryByBudget({
      history: [duplicated, assistantMessage('a1')],
      userMessage: userMessage('current'),
      budget: budget(),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['a1']);
    expect(result.droppedCount).toBe(0);
    expect(result.estimatedPromptTokens).toBe(USER_TOKENS + ASSISTANT_TOKENS);
  });

  it('un turno huérfano viejo no desplaza al turno más nuevo', () => {
    const result = selectHistoryByBudget({
      history: [
        assistantMessage('a0', 'x'.repeat(8000)),
        assistantMessage('a0b', 'x'.repeat(8000)),
        assistantMessage('a0c', 'x'.repeat(8000)),
        userMessage('u1'),
      ],
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(result.messages.map((message) => message.id)).toEqual(['u1']);
    expect(result.droppedCount).toBe(3);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + USER_TOKENS);
  });

  it('sanea maxPromptTokens NaN sin propagar NaN', () => {
    const result = selectHistoryByBudget({
      history: historyOf(1),
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget({ maxPromptTokens: Number.NaN }),
    });
    expect(Number.isFinite(result.estimatedPromptTokens)).toBe(true);
    expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + TURN_TOKENS);
  });

  it('keepLastTurns no finito o negativo usa el fallback de 6 turnos', () => {
    const giant = 'x'.repeat(1000);
    const history = Array.from({ length: 8 }, (_, index) => [
      userMessage(`gu${index}`),
      assistantMessage(`ga${index}`, giant),
    ]).flat();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -2]) {
      const result = selectHistoryByBudget({
        history,
        userMessage: userMessage('current'),
        system: 'sys',
        budget: budget({ keepLastTurns: value }),
      });
      expect(result.messages.length).toBe(FALLBACK_KEEP_LAST_TURNS * 2);
      expect(result.droppedCount).toBe(4);
      expect(result.estimatedPromptTokens).toBe(SYSTEM_TOKENS + USER_TOKENS + FALLBACK_KEEP_LAST_TURNS * GIANT_TURN_TOKENS);
    }
  });

  it('truncateMessageAtPercent no finito usa 0.4 y los extremos se clampan a [0.05, 1]', () => {
    const giant = 'x'.repeat(4000);
    const history = [userMessage('u1'), assistantMessage('a1', giant)];
    const selectWith = (percent: number) =>
      selectHistoryByBudget({
        history,
        userMessage: userMessage('current'),
        system: 'sys',
        budget: budget({ truncateMessageAtPercent: percent, keepLastTurns: 1 }),
      });
    const wireText = (result: ReturnType<typeof selectHistoryByBudget>): string => {
      const block = result.messages[1]?.content[0];
      return block?.type === 'text' ? block.text : '';
    };

    // 0.4 => tope 204 tokens => 816 chars conservados
    expect(wireText(selectWith(Number.NaN))).toContain('[... truncated 3184 chars ...]');
    expect(wireText(selectWith(Number.POSITIVE_INFINITY))).toContain('[... truncated 3184 chars ...]');
    // clamp inferior 0.05 => tope 25 tokens => 100 chars
    expect(wireText(selectWith(0))).toContain('[... truncated 3900 chars ...]');
    // clamp superior 1 => tope 512 tokens => 2048 chars
    expect(wireText(selectWith(2))).toContain('[... truncated 1952 chars ...]');
  });

  it('reservedTokens reduce el presupuesto efectivo y descarta turnos', () => {
    const history = historyOf(1, 2, 3);
    const withoutReserve = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    expect(withoutReserve.messages).toHaveLength(6);

    // 512 - 500 = 12 tokens efectivos: no alcanza ni para un turno mínimo.
    const withReserve = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
      reservedTokens: 500,
    });
    expect(withReserve.messages).toEqual([]);
    expect(withReserve.droppedCount).toBe(6);
  });

  it('garantiza que historial seleccionado + reserva no desborden el presupuesto', () => {
    const reservedTokens = 100;
    const history = historyOf(...Array.from({ length: 40 }, (_, index) => index + 1));
    const result = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
      reservedTokens,
    });
    expect(result.estimatedPromptTokens + reservedTokens).toBeLessThanOrEqual(512);
  });

  it('reservedTokens ausente, cero, no finito o negativo equivale a no reservar', () => {
    const history = historyOf(1, 2, 3);
    const base = selectHistoryByBudget({
      history,
      userMessage: userMessage('current'),
      system: 'sys',
      budget: budget(),
    });
    for (const reservedTokens of [undefined, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -50]) {
      const result = selectHistoryByBudget({
        history,
        userMessage: userMessage('current'),
        system: 'sys',
        budget: budget(),
        reservedTokens,
      });
      expect(result.messages).toEqual(base.messages);
      expect(result.droppedCount).toBe(base.droppedCount);
      expect(result.estimatedPromptTokens).toBe(base.estimatedPromptTokens);
    }
  });
});
