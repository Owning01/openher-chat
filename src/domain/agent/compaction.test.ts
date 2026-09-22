import { describe, expect, it } from 'vitest';

import type { ChatCompletionRequest, ProviderAdapter } from '../ports/ProviderAdapter';
import type { ChatMessage } from '../types/chat';
import type { ModelInfo, ProviderCapabilities } from '../types/provider';
import type { StreamEvent } from '../types/stream';
import {
  MAX_PRESERVE_RECENT_TOKENS,
  MIN_PRESERVE_RECENT_TOKENS,
  TOOL_OUTPUT_MAX_CHARS,
  buildCompactionPrompt,
  compactMessages,
  preserveRecentBudget,
  selectCompactionWindow,
  serializeForSummary,
  shouldCompact,
} from './compaction';

class SummaryAdapter implements ProviderAdapter {
  readonly providerId = 'fake';
  readonly kind = 'openai-compatible' as const;
  readonly requests: ChatCompletionRequest[] = [];
  private readonly events: StreamEvent[] | Error;

  constructor(events: StreamEvent[] | Error) {
    this.events = events;
  }

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: false };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    this.requests.push(request);
    if (this.events instanceof Error) throw this.events;
    for (const event of this.events) yield event;
  }
}

function message(id: string, role: ChatMessage['role'], content: ChatMessage['content']): ChatMessage {
  return { id, conversationId: 'c1', role, status: 'complete', content, createdAt: 1, updatedAt: 1 };
}

describe('serializeForSummary', () => {
  it('etiqueta user, assistant, tool call y tool result', () => {
    expect(serializeForSummary(message('u', 'user', [{ type: 'text', text: 'hola' }]))).toBe('[User]: hola');
    const assistant = message('a', 'assistant', [
      { type: 'text', text: 'pensando' },
      { type: 'reasoning', text: 'interno' },
      { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"q":"x"}' } },
      { type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: { ok: true, content: 'res', durationMs: 1 } },
    ]);
    expect(serializeForSummary(assistant)).toBe(
      '[Assistant]: pensando\n[Assistant reasoning]: interno\n[Assistant tool call]: web_search({"q":"x"})\n[Tool result]: res',
    );
  });

  it('trunca los resultados largos a 2000 caracteres', () => {
    const result = serializeForSummary(
      message('a', 'assistant', [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'web_search',
          result: { ok: true, content: 'x'.repeat(5000), durationMs: 1 },
        },
      ]),
    );
    expect(result).toContain('[truncated]');
    expect(result.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 40);
  });
});

describe('selectCompactionWindow', () => {
  it('conserva los mensajes recientes que caben en el presupuesto', () => {
    const messages = Array.from({ length: 20 }, (_value, index) =>
      message(`m${index}`, 'user', [{ type: 'text', text: 'x'.repeat(400) }]),
    );
    const { head, recent } = selectCompactionWindow(messages, 300);
    expect(recent.length).toBeGreaterThan(0);
    expect(head.length + recent.length).toBe(messages.length);
    expect(head.at(-1)?.id).not.toBe(recent.at(0)?.id);
  });

  it('sin presupuesto deja todo para resumir', () => {
    const messages = [message('m0', 'user', [{ type: 'text', text: 'hola' }])];
    expect(selectCompactionWindow(messages, 0)).toEqual({ head: messages, recent: [] });
  });
});

describe('shouldCompact', () => {
  const history = [message('m0', 'user', [{ type: 'text', text: 'x'.repeat(4000) }])];

  it('compara contra ventana - max(salida, buffer)', () => {
    expect(shouldCompact({ history, contextWindow: 100_000, reservedOutput: 1_000 })).toBe(false);
    expect(shouldCompact({ history, contextWindow: 5_000, reservedOutput: 4_000 })).toBe(true);
  });

  it('activa autocompactación automáticamente al alcanzar 250k tokens', () => {
    // Genera un historial con más de 250.000 tokens estimados
    const hugeHistory = [message('m_huge', 'user', [{ type: 'text', text: 'x'.repeat(1_000_000) }])];
    // Con ventana de 1M (donde normalmente no compactaría), activa autocompact a los 250k
    expect(shouldCompact({ history: hugeHistory, contextWindow: 1_000_000, reservedOutput: 4_000 })).toBe(true);
    // Incluso sin ventana definida (>0), a los 250k compacta
    expect(shouldCompact({ history: hugeHistory, contextWindow: 0, reservedOutput: 0 })).toBe(true);
  });

  it('nunca compacta sin ventana conocida si está debajo de 250k', () => {
    expect(shouldCompact({ history, contextWindow: 0, reservedOutput: 0 })).toBe(false);
  });
});

describe('preserveRecentBudget', () => {
  it('acota el 25% de la ventana a [2k, 15k]', () => {
    expect(preserveRecentBudget(1_000)).toBe(MIN_PRESERVE_RECENT_TOKENS);
    expect(preserveRecentBudget(200_000)).toBe(MAX_PRESERVE_RECENT_TOKENS);
    expect(preserveRecentBudget(40_000)).toBe(10_000);
  });
});

describe('buildCompactionPrompt', () => {
  it('sin resumen previo pide uno nuevo', () => {
    const prompt = buildCompactionPrompt({ context: ['[User]: hola'] });
    expect(prompt).toContain('<conversation>');
    expect(prompt).toContain('Create a new anchored summary');
    expect(prompt).not.toContain('<prior-summary>');
  });

  it('con resumen previo pide fusionarlo', () => {
    const prompt = buildCompactionPrompt({ previousSummary: 'viejo', context: ['[User]: hola'] });
    expect(prompt).toContain('<prior-summary>\nviejo');
    expect(prompt).toContain('combines both');
  });
});

describe('compactMessages', () => {
  it('resume el head y devuelve el punto de corte', async () => {
    const adapter = new SummaryAdapter([
      { type: 'text-delta', delta: '## Objective\n- seguir' },
      { type: 'stop', reason: 'end_turn' },
    ]);
    const messages = [
      message('old', 'user', [{ type: 'text', text: 'a'.repeat(400) }]),
      message('recent', 'assistant', [{ type: 'text', text: 'reciente' }]),
    ];

    const result = await compactMessages({
      provider: adapter,
      modelId: 'm',
      messages,
      keepTokens: 20,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ summary: '## Objective\n- seguir', throughMessageId: 'old' });
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.toolChoice).toBe('none');
  });

  it('devuelve null si no hay head o si el adapter falla', async () => {
    const empty = await compactMessages({
      provider: new SummaryAdapter([]),
      modelId: 'm',
      messages: [],
      signal: new AbortController().signal,
    });
    expect(empty).toBeNull();

    const failed = await compactMessages({
      provider: new SummaryAdapter(new Error('boom')),
      modelId: 'm',
      messages: [
        message('a', 'user', [{ type: 'text', text: 'x'.repeat(100) }]),
        message('b', 'assistant', [{ type: 'text', text: 'y' }]),
      ],
      keepTokens: 5,
      signal: new AbortController().signal,
    });
    expect(failed).toBeNull();
  });
});
