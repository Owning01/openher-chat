import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, ProviderAdapter } from '../ports/ProviderAdapter';
import { DEFAULT_AGENT_BUDGET } from '../settings/defaults';
import type { AgentBudget, AgentEvent } from '../types/agent';
import type { ChatMessage, MessageErrorCode, ToolErrorCode, ToolResult } from '../types/chat';
import type { ModelInfo, ProviderCapabilities } from '../types/provider';
import type { StreamEvent } from '../types/stream';
import type { ToolDefinition, ToolRegistry } from '../types/tools';
import { runAgent, type RunAgentDeps, type RunAgentParams } from './runAgent';

interface FakeScript {
  events?: StreamEvent[];
  errorBefore?: unknown;
  errorAfter?: unknown;
}

class FakeProviderAdapter implements ProviderAdapter {
  readonly providerId = 'fake-provider';
  readonly kind = 'openai-compatible' as const;
  readonly requests: ChatCompletionRequest[] = [];
  readonly scripts: FakeScript[] = [];
  onRequest?: (request: ChatCompletionRequest) => void;
  completed = false;
  closed = false;
  toolCalling = true;

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolCalling: this.toolCalling, systemPrompt: true, listModels: true, images: false };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    this.requests.push(request);
    this.onRequest?.(request);
    const script = this.scripts.shift();
    try {
      if (script?.errorBefore !== undefined) throw script.errorBefore;
      for (const event of script?.events ?? []) {
        yield event;
      }
      if (script?.errorAfter !== undefined) throw script.errorAfter;
      this.completed = true;
    } finally {
      this.closed = true;
    }
  }
}

class FakeToolRegistry implements ToolRegistry {
  private readonly tools: ToolDefinition[] = [];

  add(tool: ToolDefinition): void {
    this.tools.push(tool);
  }

  list(): ToolDefinition[] {
    return this.tools;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.find((tool) => tool.name === name);
  }
}

function makeTool(name: string, execute: ToolDefinition['execute'], overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: `Fake tool ${name} for tests`,
    parameters: { type: 'object', properties: {}, required: [] },
    timeoutMs: 5000,
    maxResultChars: 20_000,
    execute,
    ...overrides,
  };
}

function okResult(content: string): ToolResult {
  return { ok: true, content, durationMs: 1 };
}

function failResult(code: ToolErrorCode, message: string): ToolResult {
  return { ok: false, content: message, error: { code, message }, durationMs: 1 };
}

function providerFailure(
  code: MessageErrorCode,
  options: { retryable: boolean; status?: number; retryAfterMs?: number } = { retryable: false },
): Error {
  return Object.assign(new Error(`fake ${code}`), {
    code,
    retryable: options.retryable,
    status: options.status,
    retryAfterMs: options.retryAfterMs,
  });
}

function textMessage(id: string, role: 'user' | 'assistant', text: string): ChatMessage {
  return {
    id,
    conversationId: 'conv-1',
    role,
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeParams(overrides: Partial<RunAgentParams> = {}): RunAgentParams {
  return {
    providerId: 'fake-provider',
    modelId: 'fake-model',
    conversationId: 'conv-1',
    systemPrompt: 'You are a test assistant.',
    history: [],
    userMessage: textMessage('u-current', 'user', 'hello'),
    defaults: { temperature: 0.7, maxOutputTokens: null },
    budget: { ...DEFAULT_AGENT_BUDGET },
    historyBudget: {
      mode: 'fixed',
      maxPromptTokens: 4096,
      reservedOutputTokens: 512,
      keepLastTurns: 3,
      truncateMessageAtPercent: 0.4,
    },
    researchMode: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function agentBudget(overrides: Partial<AgentBudget> = {}): AgentBudget {
  return { ...DEFAULT_AGENT_BUDGET, ...overrides };
}

interface Harness {
  provider: FakeProviderAdapter;
  controller: AbortController;
  tools: FakeToolRegistry;
  params: RunAgentParams;
  deps: RunAgentDeps;
  setNow: (value: number) => void;
}

function createHarness(options: { params?: Partial<RunAgentParams> } = {}): Harness {
  const provider = new FakeProviderAdapter();
  const controller = new AbortController();
  const tools = new FakeToolRegistry();
  let now = 0;
  let idCounter = 0;
  const params = makeParams({ signal: controller.signal, ...options.params });
  const deps: RunAgentDeps = {
    provider,
    tools,
    clock: () => now,
    newId: () => `id-${(idCounter += 1)}`,
  };
  return {
    provider,
    controller,
    tools,
    params,
    deps,
    setNow: (value: number) => {
      now = value;
    },
  };
}

type RunEndEvent = Extract<AgentEvent, { type: 'run-end' }>;

function eventsOfType<T extends AgentEvent['type']>(events: AgentEvent[], type: T): Extract<AgentEvent, { type: T }>[] {
  return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

function runEnd(events: AgentEvent[]): RunEndEvent {
  const [event] = eventsOfType(events, 'run-end');
  if (event === undefined) throw new Error('missing run-end event');
  return event;
}

async function collect(generator: AsyncGenerator<AgentEvent, void, void>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

const TOOL_CALL_SEARCH: StreamEvent = {
  type: 'tool-call',
  toolCall: { id: 'c1', name: 'web_search', argumentsText: '{"query":"x"}' },
};

describe('runAgent - caso feliz', () => {
  it('emite bloques ordenados, usage acumulado y run-end complete', async () => {
    const h = createHarness();
    h.provider.scripts.push({
      events: [
        { type: 'start' },
        { type: 'transport-fallback', reason: 'cors' },
        { type: 'reasoning-delta', delta: 'thinking ' },
        { type: 'reasoning-delta', delta: 'hard' },
        { type: 'text-delta', delta: '' },
        { type: 'text-delta', delta: 'Hello' },
        { type: 'text-delta', delta: ' world' },
        { type: 'usage', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } },
        { type: 'stop', reason: 'end_turn' },
      ],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(events.map((event) => event.type)).toEqual([
      'run-start',
      'step-start',
      'reasoning-delta',
      'reasoning-delta',
      'text-delta',
      'text-delta',
      'step-end',
      'run-end',
    ]);
    const [stepEnd] = eventsOfType(events, 'step-end');
    expect(stepEnd?.stopReason).toBe('end_turn');
    expect(stepEnd?.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });

    expect(end.status).toBe('complete');
    expect(end.message.status).toBe('complete');
    expect(end.message.finishReason).toBe('complete');
    expect(end.message.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    expect(end.message.content).toEqual([
      { type: 'reasoning', text: 'thinking hard' },
      { type: 'text', text: 'Hello world' },
    ]);

    expect(h.provider.requests).toHaveLength(1);
    expect(h.provider.requests[0]?.system).toBe(h.params.systemPrompt);
    expect(h.provider.requests[0]?.messages[0]).toEqual({ role: 'system', content: h.params.systemPrompt });
    expect(h.provider.requests[0]?.tools).toBeUndefined();
  });
});

describe('runAgent - multi-paso con tools', () => {
  it('ejecuta 2 tools intercaladas y conserva el orden real de bloques', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(makeTool('web_search', async () => okResult('search-results')));
    h.tools.add(makeTool('open_url', async () => okResult('page-text')));
    h.provider.scripts.push(
      {
        events: [
          { type: 'text-delta', delta: 'Buscando.' },
          TOOL_CALL_SEARCH,
          { type: 'usage', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      {
        events: [
          { type: 'text-delta', delta: 'Abriendo.' },
          { type: 'tool-call', toolCall: { id: 'c2', name: 'open_url', argumentsText: '{"url":"https://example.com"}' } },
          { type: 'usage', usage: { promptTokens: 150, completionTokens: 5, totalTokens: 155 } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      {
        events: [
          { type: 'text-delta', delta: 'Listo' },
          { type: 'usage', usage: { promptTokens: 180, completionTokens: 3 } },
          { type: 'stop', reason: 'end_turn' },
        ],
      },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('complete');
    expect(end.message.content.map((block) => block.type)).toEqual([
      'text',
      'tool-call',
      'tool-result',
      'text',
      'tool-call',
      'tool-result',
      'text',
    ]);
    expect(end.message.content[0]).toEqual({ type: 'text', text: 'Buscando.' });
    expect(end.message.content[3]).toEqual({ type: 'text', text: 'Abriendo.' });
    expect(end.message.content[6]).toEqual({ type: 'text', text: 'Listo' });
    expect(end.message.usage).toEqual({ promptTokens: 430, completionTokens: 18, totalTokens: 448 });

    const stepEnds = eventsOfType(events, 'step-end');
    expect(stepEnds.map((event) => event.stopReason)).toEqual(['tool_use', 'tool_use', 'end_turn']);
    expect(eventsOfType(events, 'tool-start')).toHaveLength(2);
    expect(eventsOfType(events, 'tool-end').map((event) => event.result.content)).toEqual(['search-results', 'page-text']);

    expect(h.provider.requests).toHaveLength(3);
    expect(h.provider.requests[0]?.tools).toHaveLength(2);
    expect(h.provider.requests[0]?.toolChoice).toBe('auto');
    expect(h.provider.requests[1]?.messages).toContainEqual({
      role: 'assistant',
      content: 'Buscando.',
      toolCalls: [{ id: 'c1', name: 'web_search', argumentsText: '{"query":"x"}' }],
    });
    expect(h.provider.requests[1]?.messages).toContainEqual({
      role: 'tool',
      content: 'search-results',
      toolCallId: 'c1',
      toolName: 'web_search',
    });
    expect(h.provider.requests[2]?.messages).toContainEqual({
      role: 'tool',
      content: 'page-text',
      toolCallId: 'c2',
      toolName: 'open_url',
    });
  });

  it('enriquece los argumentos parseados en tool-start', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push(
      { events: [TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }] },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolStart] = eventsOfType(events, 'tool-start');
    expect(toolStart?.toolCall.arguments).toEqual({ query: 'x' });
  });
});

describe('runAgent - presupuestos', () => {
  it('agota pasos y conserva el parcial con budget_exceeded', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ maxSteps: 1, maxToolCalls: 5 }) },
    });
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'primer paso' }, TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('budget_exceeded');
    expect(end.message.finishReason).toBe('budget_exceeded');
    expect(end.message.content.map((block) => block.type)).toEqual(['text', 'tool-call', 'tool-result']);
    expect(h.provider.requests).toHaveLength(1);
    expect(eventsOfType(events, 'step-start')).toHaveLength(1);
    expect(eventsOfType(events, 'step-end')).toHaveLength(1);
  });

  it('agota tokens antes de arrancar si el estimado ya supera el tope', async () => {
    const h = createHarness({ params: { budget: agentBudget({ maxTotalTokens: 1 }) } });
    h.provider.scripts.push({ events: [{ type: 'text-delta', delta: 'no debería correr' }] });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('budget_exceeded');
    expect(end.message.content).toEqual([]);
    expect(h.provider.requests).toHaveLength(0);
    expect(eventsOfType(events, 'step-start')).toHaveLength(0);
  });

  it('agota tokens con el usage real calibrado tras un paso', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ maxTotalTokens: 1150 }) },
    });
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push({
      events: [
        TOOL_CALL_SEARCH,
        { type: 'usage', usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 } },
        { type: 'stop', reason: 'tool_use' },
      ],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('budget_exceeded');
    expect(h.provider.requests).toHaveLength(1);
    expect(end.message.content.map((block) => block.type)).toEqual(['tool-call', 'tool-result']);
  });

  it('agota wall-clock entre pasos usando el clock inyectado', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ maxWallClockMs: 200 }) },
    });
    h.tools.add(
      makeTool('slow', async () => {
        h.setNow(500);
        return okResult('late');
      }),
    );
    h.provider.scripts.push({
      events: [{ type: 'tool-call', toolCall: { id: 'c1', name: 'slow', argumentsText: '{}' } }, { type: 'stop', reason: 'tool_use' }],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('budget_exceeded');
    expect(h.provider.requests).toHaveLength(1);
    expect(end.message.content.map((block) => block.type)).toEqual(['tool-call', 'tool-result']);
  });
});

describe('runAgent - abort', () => {
  it('aborta a mitad de stream, cierra el reader y conserva el texto parcial', async () => {
    const h = createHarness();
    h.provider.scripts.push({
      events: [
        { type: 'text-delta', delta: 'parcial' },
        { type: 'text-delta', delta: ' nunca' },
      ],
    });

    const iterator = runAgent(h.params, h.deps);
    await iterator.next();
    await iterator.next();
    const partial = await iterator.next();
    expect(partial.value).toEqual({ type: 'text-delta', stepIndex: 0, delta: 'parcial' });
    h.controller.abort();

    const events: AgentEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      events.push(next.value);
    }
    const end = runEnd(events);

    expect(end.status).toBe('aborted');
    expect(end.message.status).toBe('aborted');
    expect(end.message.finishReason).toBe('aborted');
    expect(end.message.content).toEqual([{ type: 'text', text: 'parcial' }]);
    expect(h.provider.closed).toBe(true);
    expect(h.provider.completed).toBe(false);
  });

  it('aborta antes del primer paso sin llamar al provider', async () => {
    const h = createHarness();
    h.controller.abort();

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('aborted');
    expect(end.message.content).toEqual([]);
    expect(h.provider.requests).toHaveLength(0);
  });

  it('aborta durante una tool sin emitir tool-end', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool(
        'slow',
        (_args, context) =>
          new Promise<ToolResult>((resolve) => {
            context.signal.addEventListener('abort', () => resolve(okResult('late')), { once: true });
          }),
      ),
    );
    h.provider.scripts.push({
      events: [
        { type: 'tool-call', toolCall: { id: 'c1', name: 'slow', argumentsText: '{}' } },
        { type: 'stop', reason: 'tool_use' },
      ],
    });

    const iterator = runAgent(h.params, h.deps);
    const events: AgentEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      events.push(next.value);
      if (next.value.type === 'tool-start') h.controller.abort();
    }
    const end = runEnd(events);

    expect(end.status).toBe('aborted');
    expect(end.message.content.map((block) => block.type)).toEqual(['tool-call']);
    expect(eventsOfType(events, 'tool-end')).toHaveLength(0);
  });
});

describe('runAgent - tools', () => {
  it('convierte un timeout de tool en resultado accionable y sigue el run', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ toolTimeoutMs: 15 }) },
    });
    h.tools.add(makeTool('hang', () => new Promise<ToolResult>(() => undefined)));
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'hang', argumentsText: '{}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'text-delta', delta: 'sigo' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');
    const end = runEnd(events);

    expect(toolEnd?.result.ok).toBe(false);
    expect(toolEnd?.result.error?.code).toBe('timeout');
    expect(toolEnd?.result.content).toContain('timed out');
    expect(end.status).toBe('complete');
  });

  it('usa el menor entre el timeout de la tool y el del presupuesto', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(makeTool('fast', () => new Promise<ToolResult>(() => undefined), { timeoutMs: 10 }));
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'fast', argumentsText: '{}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');

    expect(toolEnd?.result.error?.code).toBe('timeout');
    expect(toolEnd?.result.content).toContain('after 10ms');
  });

  it('devuelve invalid_args al modelo cuando la tool es desconocida', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'nope', argumentsText: '{}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'text-delta', delta: 'sin tool' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');
    const end = runEnd(events);

    expect(toolEnd?.result.ok).toBe(false);
    expect(toolEnd?.result.error?.code).toBe('invalid_args');
    expect(toolEnd?.result.content).toContain('Unknown tool "nope"');
    expect(end.status).toBe('complete');
  });

  it('devuelve invalid_args cuando el JSON de argumentos es inválido', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(makeTool('web_search', async () => okResult('nunca')));
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'web_search', argumentsText: 'no-json' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'text-delta', delta: 'ok' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');

    expect(toolEnd?.result.ok).toBe(false);
    expect(toolEnd?.result.error?.code).toBe('invalid_args');
    expect(toolEnd?.result.content).toContain('Invalid arguments');
  });

  it('deduplica llamadas idénticas y reutiliza el resultado cacheado con nota', async () => {
    let executions = 0;
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool('web_search', async () => {
        executions += 1;
        return okResult('once');
      }),
    );
    h.provider.scripts.push(
      {
        events: [
          TOOL_CALL_SEARCH,
          { type: 'tool-call', toolCall: { id: 'c1-bis', name: 'web_search', argumentsText: '{"query":"x"}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'text-delta', delta: 'final' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const toolEnds = eventsOfType(events, 'tool-end');
    const end = runEnd(events);

    expect(executions).toBe(1);
    expect(toolEnds).toHaveLength(2);
    expect(toolEnds[0]?.result.content).toBe('once');
    expect(toolEnds[1]?.result.ok).toBe(true);
    expect(toolEnds[1]?.result.content).toContain('already executed');
    expect(end.status).toBe('complete');
  });

  it('deduplica argumentos equivalentes aunque el orden de las claves cambie', async () => {
    let executions = 0;
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool('web_search', async () => {
        executions += 1;
        return okResult('canónico');
      }),
    );
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'web_search', argumentsText: '{"query":"x","limit":3}' } },
          { type: 'tool-call', toolCall: { id: 'c2', name: 'web_search', argumentsText: '{"limit":3,"query":"x"}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const toolEnds = eventsOfType(events, 'tool-end');

    expect(executions).toBe(1);
    expect(toolEnds).toHaveLength(2);
    expect(toolEnds[1]?.result.content).toContain('already executed');
  });

  it('trunca el resultado a min(maxResultChars, maxToolResultChars)', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool('web_search', async () => okResult('x'.repeat(500)), { maxResultChars: 80 }),
    );
    h.provider.scripts.push(
      { events: [TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }] },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');
    const content = toolEnd?.result.content ?? '';

    expect(content).toContain('truncated 453 chars');
    expect(Array.from(content)).toHaveLength(80);
  });

  it('respeta el cap exacto aunque el marcador de recorte no quepa', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ maxToolResultChars: 8 }) },
    });
    h.tools.add(makeTool('web_search', async () => okResult('y'.repeat(500))));
    h.provider.scripts.push(
      { events: [TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }] },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');

    expect(toolEnd?.result.content).toBe('y'.repeat(8));
  });

  it('convierte una tool que lanza en resultado parse_error', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool('boom', async () => {
        throw new Error('kaboom');
      }),
    );
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'boom', argumentsText: '{}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');

    expect(toolEnd?.result.ok).toBe(false);
    expect(toolEnd?.result.error?.code).toBe('parse_error');
    expect(toolEnd?.result.content).toContain('kaboom');
  });

  it('convierte un throw síncrono de la tool en resultado parse_error', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool('sync-boom', (): Promise<ToolResult> => {
        throw new Error('sync kaboom');
      }),
    );
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'sync-boom', argumentsText: '{}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      { events: [{ type: 'text-delta', delta: 'sigo' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const [toolEnd] = eventsOfType(events, 'tool-end');
    const end = runEnd(events);

    expect(toolEnd?.result.ok).toBe(false);
    expect(toolEnd?.result.error?.code).toBe('parse_error');
    expect(toolEnd?.result.content).toContain('sync kaboom');
    expect(end.status).toBe('complete');
  });

  it('corta el run con error tras 2 fallos consecutivos de tools', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(makeTool('broken', async () => failResult('network', 'down')));
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'broken', argumentsText: '{"n":1}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c2', name: 'broken', argumentsText: '{"n":2}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('network');
    expect(end.message.status).toBe('error');
    expect(end.message.finishReason).toBe('error');
    expect(eventsOfType(events, 'tool-end')).toHaveLength(2);
    expect(eventsOfType(events, 'step-end').map((event) => event.stepIndex)).toEqual([0]);
  });

  it('no envía tools si researchMode está apagado', async () => {
    const h = createHarness();
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push({ events: [{ type: 'stop', reason: 'end_turn' }] });

    await collect(runAgent(h.params, h.deps));

    expect(h.provider.requests[0]?.tools).toBeUndefined();
    expect(h.provider.requests[0]?.toolChoice).toBeUndefined();
  });

  it('no envía tools si el modelo declara supportsTools === false', async () => {
    const h = createHarness({
      params: {
        researchMode: true,
        model: { id: 'fake-model', label: 'Fake', source: 'manual', supportsTools: false },
      },
    });
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push({ events: [{ type: 'stop', reason: 'end_turn' }] });

    await collect(runAgent(h.params, h.deps));

    expect(h.provider.requests[0]?.tools).toBeUndefined();
  });

  it('no envía tools si el provider no soporta toolCalling', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.provider.toolCalling = false;
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push({ events: [{ type: 'stop', reason: 'end_turn' }] });

    await collect(runAgent(h.params, h.deps));

    expect(h.provider.requests[0]?.tools).toBeUndefined();
  });
});

describe('runAgent - retries', () => {
  it('reintenta un 429 pre-delta y completa', async () => {
    const h = createHarness();
    h.provider.scripts.push(
      { errorBefore: providerFailure('rate_limit', { retryable: true, status: 429, retryAfterMs: 20 }) },
      { events: [{ type: 'text-delta', delta: 'ok' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(2);
    expect(end.status).toBe('complete');
    expect(end.message.content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('agota maxRetriesPerStep ante 500 y cierra con error', async () => {
    const h = createHarness({ params: { budget: agentBudget({ maxRetriesPerStep: 1 }) } });
    h.provider.scripts.push(
      { errorBefore: providerFailure('server', { retryable: true, status: 500 }) },
      { errorBefore: providerFailure('server', { retryable: true, status: 500 }) },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(2);
    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('server');
  });

  it('no reintenta errores no retryable', async () => {
    const h = createHarness();
    h.provider.scripts.push({ errorBefore: providerFailure('auth', { retryable: false, status: 401 }) });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(1);
    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('auth');
    expect(end.message.status).toBe('error');
  });

  it('nunca reintenta después del primer delta', async () => {
    const h = createHarness();
    h.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'parcial' }],
      errorAfter: providerFailure('server', { retryable: true, status: 500 }),
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(1);
    expect(end.status).toBe('error');
    expect(end.message.content).toEqual([{ type: 'text', text: 'parcial' }]);
    expect(end.error?.code).toBe('server');
  });

  it('en context_length del paso 0 reintenta una vez con 50% del historial', async () => {
    const history = [
      textMessage('u1', 'user', 'historia uno'),
      textMessage('a1', 'assistant', 'respuesta uno'),
      textMessage('u2', 'user', 'historia dos'),
      textMessage('a2', 'assistant', 'respuesta dos'),
    ];
    const h = createHarness({ params: { history } });
    h.provider.scripts.push(
      { errorBefore: providerFailure('context_length', { retryable: false, status: 400 }) },
      { events: [{ type: 'text-delta', delta: 'ok' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(2);
    expect(h.provider.requests[0]?.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(h.provider.requests[1]?.messages).toEqual([
      { role: 'system', content: h.params.systemPrompt },
      { role: 'user', content: 'historia dos' },
      { role: 'assistant', content: 'respuesta dos' },
      { role: 'user', content: 'hello' },
    ]);
    expect(end.status).toBe('complete');
  });
});

describe('runAgent - casos límite', () => {
  it('ignora razonamientos vacíos y honra un stop aborted del provider', async () => {
    const h = createHarness();
    h.provider.scripts.push({
      events: [
        { type: 'reasoning-delta', delta: '' },
        { type: 'reasoning-delta', delta: 'algo' },
        { type: 'stop', reason: 'aborted' },
      ],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('aborted');
    expect(end.message.content).toEqual([{ type: 'reasoning', text: 'algo' }]);
    expect(eventsOfType(events, 'step-end')).toHaveLength(0);
  });

  it('trata como aborto un error con name AbortError', async () => {
    const h = createHarness();
    h.provider.scripts.push({ errorBefore: Object.assign(new Error('cancelado'), { name: 'AbortError' }) });

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(end.status).toBe('aborted');
  });

  it('trata como aborto un error de transporte con kind aborted', async () => {
    const h = createHarness();
    h.provider.scripts.push({ errorBefore: Object.assign(new Error('cancelado'), { kind: 'aborted' }) });

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(end.status).toBe('aborted');
  });

  it('aborta durante el backoff de un reintento', async () => {
    const h = createHarness();
    h.provider.scripts.push({ errorBefore: providerFailure('rate_limit', { retryable: true, status: 429 }) });
    h.provider.onRequest = () => {
      setTimeout(() => h.controller.abort(), 0);
    };

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(end.status).toBe('aborted');
    expect(h.provider.requests).toHaveLength(1);
  });

  it('aborta entre dos tool calls sin ejecutar la segunda', async () => {
    const executions: string[] = [];
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(
      makeTool('web_search', async () => {
        executions.push('run');
        return okResult('r');
      }),
    );
    h.provider.scripts.push({
      events: [
        { type: 'tool-call', toolCall: { id: 'c1', name: 'web_search', argumentsText: '{"query":"a"}' } },
        { type: 'tool-call', toolCall: { id: 'c2', name: 'web_search', argumentsText: '{"query":"b"}' } },
        { type: 'stop', reason: 'tool_use' },
      ],
    });

    const iterator = runAgent(h.params, h.deps);
    const events: AgentEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) break;
      events.push(next.value);
      if (next.value.type === 'tool-end') h.controller.abort();
    }
    const end = runEnd(events);

    expect(end.status).toBe('aborted');
    expect(executions).toHaveLength(1);
    expect(eventsOfType(events, 'tool-start')).toHaveLength(1);
    expect(end.message.content.map((block) => block.type)).toEqual(['tool-call', 'tool-call', 'tool-result']);
  });

  it('agota wall-clock durante el batch de tools', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ maxWallClockMs: 200 }) },
    });
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.onRequest = () => h.setNow(300);
    h.provider.scripts.push({ events: [TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }] });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('budget_exceeded');
    expect(eventsOfType(events, 'tool-start')).toHaveLength(0);
    expect(end.message.content.map((block) => block.type)).toEqual(['tool-call']);
  });

  it('agota el presupuesto de tool calls a mitad de batch', async () => {
    const h = createHarness({
      params: { researchMode: true, budget: agentBudget({ maxToolCalls: 1 }) },
    });
    h.tools.add(makeTool('web_search', async () => okResult('r')));
    h.provider.scripts.push({
      events: [
        { type: 'tool-call', toolCall: { id: 'c1', name: 'web_search', argumentsText: '{"query":"a"}' } },
        { type: 'tool-call', toolCall: { id: 'c2', name: 'web_search', argumentsText: '{"query":"b"}' } },
        { type: 'stop', reason: 'tool_use' },
      ],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(end.status).toBe('budget_exceeded');
    expect(eventsOfType(events, 'tool-start')).toHaveLength(1);
    expect(end.message.content.map((block) => block.type)).toEqual(['tool-call', 'tool-call', 'tool-result']);
  });

  it('convierte 2 fallos de timeout consecutivos en run-end error timeout', async () => {
    const h = createHarness({ params: { researchMode: true } });
    h.tools.add(makeTool('broken', async () => failResult('timeout', 'timed out')));
    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c1', name: 'broken', argumentsText: '{"n":1}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'c2', name: 'broken', argumentsText: '{"n":2}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
    );

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('timeout');
  });

  it('reintenta un error event retryable solo pre-delta', async () => {
    const h = createHarness();
    h.provider.scripts.push(
      { events: [{ type: 'error', error: { code: 'rate_limit', message: 'slow down', retryable: true } }] },
      { events: [{ type: 'text-delta', delta: 'ok' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(2);
    expect(end.status).toBe('complete');
  });

  it('no reintenta un error event después del primer delta', async () => {
    const h = createHarness();
    h.provider.scripts.push({
      events: [
        { type: 'text-delta', delta: 'parcial' },
        { type: 'error', error: { code: 'server', message: 'boom', retryable: true } },
      ],
    });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(1);
    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('server');
    expect(end.message.content).toEqual([{ type: 'text', text: 'parcial' }]);
  });

  it('deriva retryable del status HTTP y usa mensaje genérico para causes sin Error', async () => {
    const h = createHarness({ params: { budget: agentBudget({ maxRetriesPerStep: 1 }) } });
    h.provider.scripts.push({ errorBefore: { status: 500 } }, { errorBefore: { status: 500 } });

    const events = await collect(runAgent(h.params, h.deps));
    const end = runEnd(events);

    expect(h.provider.requests).toHaveLength(2);
    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('server');
    expect(end.error?.message).toBe('The provider stream failed.');
  });

  it('reintenta un 429 y un 408 sin flag retryable explícito', async () => {
    const h = createHarness();
    h.provider.scripts.push(
      { errorBefore: { status: 429 } },
      { errorBefore: { status: 408 } },
      { events: [{ type: 'text-delta', delta: 'ok' }, { type: 'stop', reason: 'end_turn' }] },
    );

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(h.provider.requests).toHaveLength(3);
    expect(end.status).toBe('complete');
  });

  it('reintenta errores de transporte kind timeout y kind network', async () => {
    const timeoutHarness = createHarness();
    timeoutHarness.provider.scripts.push(
      { errorBefore: Object.assign(new Error('t'), { kind: 'timeout' }) },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );
    const timeoutEnd = runEnd(await collect(runAgent(timeoutHarness.params, timeoutHarness.deps)));
    expect(timeoutHarness.provider.requests).toHaveLength(2);
    expect(timeoutEnd.status).toBe('complete');

    const networkHarness = createHarness();
    networkHarness.provider.scripts.push(
      { errorBefore: Object.assign(new Error('n'), { kind: 'network' }) },
      { events: [{ type: 'stop', reason: 'end_turn' }] },
    );
    const networkEnd = runEnd(await collect(runAgent(networkHarness.params, networkHarness.deps)));
    expect(networkHarness.provider.requests).toHaveLength(2);
    expect(networkEnd.status).toBe('complete');
  });

  it('normaliza un code desconocido y un status no numérico como unknown', async () => {
    const h = createHarness();
    h.provider.scripts.push({ errorBefore: { code: 'bogus', status: '500' } });

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(h.provider.requests).toHaveLength(1);
    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('unknown');
    expect(end.error?.retryable).toBe(false);
  });

  it('normaliza una cause que no es objeto', async () => {
    const h = createHarness();
    h.provider.scripts.push({ errorBefore: 'boom' });

    const end = runEnd(await collect(runAgent(h.params, h.deps)));

    expect(end.status).toBe('error');
    expect(end.error?.code).toBe('unknown');
    expect(end.error?.message).toBe('The provider stream failed.');
  });

  it('convierte un fallo de tools.list en run-end error controlado', async () => {
    const h = createHarness({ params: { researchMode: true } });
    const deps: RunAgentDeps = {
      ...h.deps,
      tools: {
        list: () => {
          throw new Error('list boom');
        },
        get: () => undefined,
      },
    };

    const events = await collect(runAgent(h.params, deps));
    const end = runEnd(events);

    expect(end.status).toBe('error');
    expect(end.error?.message).toContain('list boom');
    expect(h.provider.requests).toHaveLength(0);
  });

  it('no deja escapar un fallo del registry de tools', async () => {
    const h = createHarness({ params: { researchMode: true } });
    const tool = makeTool('web_search', async () => okResult('r'));
    const deps: RunAgentDeps = {
      ...h.deps,
      tools: {
        list: () => [tool],
        get: () => {
          throw new Error('registry boom');
        },
      },
    };
    h.provider.scripts.push({ events: [TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }] });

    const end = runEnd(await collect(runAgent(h.params, deps)));

    expect(end.status).toBe('error');
    expect(end.error?.message).toContain('registry boom');
  });

  it('no deja escapar un fallo del registry con aborto simultáneo', async () => {
    const h = createHarness({ params: { researchMode: true } });
    const tool = makeTool('web_search', async () => okResult('r'));
    const deps: RunAgentDeps = {
      ...h.deps,
      tools: {
        list: () => [tool],
        get: () => {
          h.controller.abort();
          throw new Error('registry boom');
        },
      },
    };
    h.provider.scripts.push({ events: [TOOL_CALL_SEARCH, { type: 'stop', reason: 'tool_use' }] });

    const end = runEnd(await collect(runAgent(h.params, deps)));

    expect(end.status).toBe('aborted');
  });
});
