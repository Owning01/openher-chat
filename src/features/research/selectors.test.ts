import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_BUDGET, DEFAULT_PROXY_SETTINGS, DEFAULT_SEARCH_SETTINGS } from '@/domain/settings/defaults';
import type { AgentEvent, AgentStep } from '@/domain/types/agent';
import type { ChatMessage, SourceRef, ToolCall, ToolResult } from '@/domain/types/chat';
import { assistantMessage } from '@/features/chat/components/__fixtures__/messages';

import {
  budgetUsage,
  dedupeSources,
  researchWarning,
  sourcesFromMessages,
  stepsFromEvents,
  summarizeToolCall,
} from './selectors';

const SOURCE_URL = 'https://example.com/doc';

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: 'call-1', name: 'web_search', argumentsText: '{"query":"clima"}', ...overrides };
}

describe('stepsFromEvents', () => {
  it('reduce AgentEvent a pasos con tools, estado, usage y marcas de tiempo', () => {
    let tick = 0;
    const clock = (): number => (tick += 10);
    const events: AgentEvent[] = [
      { type: 'run-start', runId: 'run-1' },
      { type: 'step-start', stepIndex: 0 },
      { type: 'text-delta', stepIndex: 0, delta: 'Busco ' },
      { type: 'reasoning-delta', stepIndex: 0, delta: 'pienso' },
      { type: 'tool-start', stepIndex: 0, toolCall: toolCall() },
      {
        type: 'tool-end',
        stepIndex: 0,
        toolCall: toolCall(),
        result: {
          ok: true,
          content: 'resultado',
          sources: [{ url: SOURCE_URL, title: 'Doc', accessedAt: 1 }],
          durationMs: 1200,
        },
      },
      {
        type: 'step-end',
        stepIndex: 0,
        stopReason: 'tool_use',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      { type: 'step-start', stepIndex: 1 },
      { type: 'text-delta', stepIndex: 1, delta: 'Listo' },
      { type: 'step-end', stepIndex: 1, stopReason: 'end_turn' },
      {
        type: 'run-end',
        status: 'complete',
        message: assistantMessage('a1', []),
      },
    ];

    const steps = stepsFromEvents(events, clock);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ index: 0, status: 'complete', text: 'Busco ', stopReason: 'tool_use' });
    expect(steps[0]?.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(steps[0]?.toolCalls.map((call) => call.name)).toEqual(['web_search']);
    expect(steps[0]?.toolResults[0]?.sources?.[0]?.url).toBe(SOURCE_URL);
    expect(steps[1]).toMatchObject({ index: 1, status: 'complete', text: 'Listo', stopReason: 'end_turn' });
    expect(steps[0]?.endedAt).toBeGreaterThan(steps[0]?.startedAt ?? Number.POSITIVE_INFINITY);
  });

  it('run-end error marca los pasos en curso como error y los cierra', () => {
    const steps = stepsFromEvents([
      { type: 'run-start', runId: 'run-2' },
      { type: 'step-start', stepIndex: 0 },
      { type: 'run-end', status: 'error', message: assistantMessage('a2', []) },
    ]);

    expect(steps[0]?.status).toBe('error');
    expect(steps[0]?.endedAt).toBeDefined();
  });

  it('run-end abortado cierra los pasos en curso como completados (parcial conservado)', () => {
    const steps = stepsFromEvents([
      { type: 'run-start', runId: 'run-3' },
      { type: 'step-start', stepIndex: 0 },
      { type: 'run-end', status: 'aborted', message: assistantMessage('a3', []) },
    ]);

    expect(steps[0]?.status).toBe('complete');
  });
});

describe('sourcesFromMessages', () => {
  it('extrae y deduplica fuentes de bloques tool-result por URL canónica', () => {
    const messages: ChatMessage[] = [
      assistantMessage('a1', [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'web_search',
          result: {
            ok: true,
            content: 'resultados',
            sources: [
              { url: SOURCE_URL, title: 'Doc', accessedAt: 1 },
              { url: 'https://other.example/b', title: 'Otra', accessedAt: 2 },
            ],
            durationMs: 10,
          },
        },
      ]),
      assistantMessage('a2', [
        {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'open_url',
          result: {
            ok: true,
            content: 'página',
            sources: [{ url: `${SOURCE_URL}#seccion`, title: 'Doc bis', accessedAt: 3 }],
            durationMs: 20,
          },
        },
        {
          type: 'tool-result',
          toolCallId: 't3',
          toolName: 'web_search',
          result: { ok: false, content: 'falló', durationMs: 30 },
        },
      ]),
    ];

    const sources = sourcesFromMessages(messages);

    expect(sources.map((source) => source.title)).toEqual(['Doc', 'Otra']);
    expect(sources).toHaveLength(2);
  });

  it('tolera un `sources` nulo persistido sin tumbar el panel', () => {
    const corrupt = assistantMessage('a-corrupt', [
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'web_search',
        result: {
          ok: true,
          content: 'x',
          durationMs: 1,
          sources: null as unknown as SourceRef[] | undefined,
        },
      },
    ]);

    expect(sourcesFromMessages([corrupt])).toEqual([]);
  });

  it('tolera un `result` nulo persistido (probe) sin tumbar el panel', () => {
    const probe = assistantMessage('a-probe', [
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'web_search',
        result: null as unknown as ToolResult,
      },
    ]);

    expect(sourcesFromMessages([probe])).toEqual([]);
  });

  it('dedupeSources conserva el orden de primera aparición', () => {
    const unique = dedupeSources([
      { url: 'https://a.test/x', title: 'A', accessedAt: 1 },
      { url: 'https://a.test/x#frag', title: 'A duplicada', accessedAt: 2 },
      { url: 'https://b.test/y', title: 'B', accessedAt: 3 },
    ]);

    expect(unique.map((source) => source.title)).toEqual(['A', 'B']);
  });
});

describe('budgetUsage', () => {
  it('suma pasos, tool calls, tokens y tiempo contra el presupuesto', () => {
    const steps: AgentStep[] = [
      {
        index: 0,
        status: 'complete',
        startedAt: 0,
        endedAt: 2000,
        text: '',
        toolCalls: [toolCall(), toolCall({ id: 'call-2', name: 'open_url', argumentsText: '{"url":"https://x"}' })],
        toolResults: [],
        usage: { promptTokens: 10, completionTokens: 5 },
      },
      {
        index: 1,
        status: 'complete',
        startedAt: 2000,
        endedAt: 3500,
        text: '',
        toolCalls: [],
        toolResults: [],
        usage: { totalTokens: 100 },
      },
    ];

    const usage = budgetUsage(steps, DEFAULT_AGENT_BUDGET);

    expect(usage).toEqual({
      steps: 2,
      maxSteps: DEFAULT_AGENT_BUDGET.maxSteps,
      toolCalls: 2,
      maxToolCalls: DEFAULT_AGENT_BUDGET.maxToolCalls,
      tokens: 115,
      maxTotalTokens: DEFAULT_AGENT_BUDGET.maxTotalTokens,
      wallClockMs: 3500,
      maxWallClockMs: DEFAULT_AGENT_BUDGET.maxWallClockMs,
    });
  });
});

describe('researchWarning', () => {
  const base = {
    search: DEFAULT_SEARCH_SETTINGS,
    proxy: DEFAULT_PROXY_SETTINGS,
    keys: { brave: false, tavily: false },
    browser: false,
  };

  it('avisa cuando el proveedor seleccionado no tiene key', () => {
    expect(researchWarning({ ...base, search: { ...base.search, mode: 'brave' } })).toEqual({
      kind: 'missingKey',
      provider: 'brave',
    });
    expect(researchWarning({ ...base, search: { ...base.search, mode: 'tavily' } })).toEqual({
      kind: 'missingKey',
      provider: 'tavily',
    });
  });

  it('avisa cuando el proxy personalizado no tiene URL', () => {
    expect(
      researchWarning({ ...base, proxy: { mode: 'custom', baseUrl: null } }),
    ).toEqual({ kind: 'missingProxyUrl' });
  });

  it('avisa cuando la URL del proxy personalizado es inválida en vez de hacer bypass silencioso', () => {
    expect(researchWarning({ ...base, proxy: { mode: 'custom', baseUrl: 'no-es-una-url' } })).toEqual({
      kind: 'invalidProxyUrl',
    });
    expect(researchWarning({ ...base, proxy: { mode: 'custom', baseUrl: 'ftp://proxy.test' } })).toEqual({
      kind: 'invalidProxyUrl',
    });
    expect(researchWarning({ ...base, proxy: { mode: 'custom', baseUrl: 'javascript:alert(1)' } })).toEqual({
      kind: 'invalidProxyUrl',
    });
    expect(
      researchWarning({ ...base, browser: true, proxy: { mode: 'custom', baseUrl: 'https://proxy.test' } }),
    ).toBeNull();
  });

  it('avisa en navegador cuando no hay proxy ni keys (auto/duckduckgo)', () => {
    expect(researchWarning({ ...base, browser: true })).toEqual({ kind: 'browserWithoutProxy' });
    expect(
      researchWarning({ ...base, browser: true, search: { ...base.search, mode: 'duckduckgo' } }),
    ).toEqual({ kind: 'browserWithoutProxy' });
  });

  it('no avisa en nativo con keys o con proxy configurado', () => {
    expect(researchWarning(base)).toBeNull();
    expect(researchWarning({ ...base, keys: { brave: true, tavily: false } })).toBeNull();
    expect(
      researchWarning({ ...base, browser: true, proxy: { mode: 'custom', baseUrl: 'https://proxy.test' } }),
    ).toBeNull();
  });
});

describe('summarizeToolCall', () => {
  it('prioriza query y url de los argumentos parseados', () => {
    expect(summarizeToolCall(toolCall())).toBe('clima');
    expect(
      summarizeToolCall(toolCall({ name: 'open_url', argumentsText: '{"url":"https://x.test/a"}' })),
    ).toBe('https://x.test/a');
  });

  it('usa argumentsText cuando no hay argumentos parseados y recorta los largos', () => {
    const long = 'x'.repeat(200);
    const summary = summarizeToolCall({ id: 'c', name: 'web_search', argumentsText: `{"query":"${long}"}` });
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(90);
    expect(summarizeToolCall({ id: 'c', name: 'web_search', argumentsText: 'no-json' })).toBe('no-json');
  });
});
