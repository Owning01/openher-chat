import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpClient, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import { ProviderError } from './errors';
import { createOpenAIResponsesAdapter } from './openaiResponses';
import type { FakeTransport, RecordedPost } from './__fixtures__/openaiResponses';
import {
  bufferedResult,
  fakeHttp,
  fakeTransport,
  functionCallArgsDelta,
  jsonResponse,
  makeResponsesDeps,
  outputItemDone,
  reasoningDelta,
  reasoningTextDelta,
  responsesChatRequest,
  responsesConfig,
  responseCompleted,
  responseFailed,
  responsesFrame,
  sseResult,
  stalledStream,
  TEST_API_KEY,
  textDelta,
  textResponse,
} from './__fixtures__/openaiResponses';
import { webSearchTool } from './__fixtures__/openaiCompatible';

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function drain(stream: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; error: unknown }> {
  const events: StreamEvent[] = [];
  try {
    for await (const event of stream) events.push(event);
    return { events, error: null };
  } catch (error) {
    return { events, error };
  }
}

async function capture<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function requirePost(transport: FakeTransport): RecordedPost {
  const [post] = transport.posts;
  if (post === undefined) throw new Error('expected a recorded transport post');
  return post;
}

function makeAdapter(
  transport: StreamTransport,
  http: HttpClient = fakeHttp(() => jsonResponse({})),
  config: ProviderConfig = responsesConfig(),
): ReturnType<typeof createOpenAIResponsesAdapter> {
  return createOpenAIResponsesAdapter(config, makeResponsesDeps(transport, http));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createOpenAIResponsesAdapter', () => {
  it('expone identidad y capacidades exactas', () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')));
    expect(adapter.providerId).toBe('test-responses');
    expect(adapter.kind).toBe('openai-responses');
    expect(adapter.capabilities()).toEqual({
      streaming: true,
      toolCalling: true,
      systemPrompt: true,
      listModels: true,
      images: false,
    });
  });
});

describe('listModels', () => {
  it('normaliza {data:[...]} y pide GET /models con timeout de 10 s y Bearer', async () => {
    const http = fakeHttp(() =>
      jsonResponse({ data: [{ id: 'm1', name: 'Model One' }, { id: 'm2' }, { id: '' }, { noId: true }] }),
    );
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')), http);

    await expect(adapter.listModels()).resolves.toEqual([
      { id: 'm1', label: 'Model One', source: 'api' },
      { id: 'm2', label: 'm2', source: 'api' },
    ]);

    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.url).toBe('https://api.example.com/v1/models');
    expect(request.method).toBe('GET');
    expect(request.timeoutMs).toBe(10_000);
    expect(request.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TEST_API_KEY}` });
  });

  it('sin requiresKey omite Authorization y conserva extraHeaders', async () => {
    const http = fakeHttp(() => jsonResponse({ models: [{ id: 'a' }] }));
    const adapter = createOpenAIResponsesAdapter(
      responsesConfig({ requiresKey: false, extraHeaders: { 'X-Custom': '1' } }),
      makeResponsesDeps(fakeTransport(() => bufferedResult('')), http, { apiKey: undefined }),
    );

    await expect(adapter.listModels()).resolves.toEqual([{ id: 'a', label: 'a', source: 'api' }]);
    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.headers).toEqual({ 'X-Custom': '1', Accept: 'application/json' });
  });

  it('mapea 401 a auth al listar modelos', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => ({ status: 401, headers: {}, text: '{"error":{"message":"bad key"}}' })),
    );

    const error = await capture(adapter.listModels());
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(401);
  });
});

describe('streamChat payload', () => {
  it('construye el payload exacto con instructions, input, tools y max_output_tokens', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('ok')));
    const adapter = makeAdapter(transport);

    await collect(
      adapter.streamChat(
        responsesChatRequest({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'web_search', argumentsText: '{"query":"a"}' }] },
            { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1', toolName: 'web_search' },
          ],
          tools: [webSearchTool],
          temperature: 0.5,
          maxOutputTokens: 256,
        }),
      ),
    );

    const post = requirePost(transport);
    expect(post.url).toBe('https://api.example.com/v1/responses');
    expect(post.headers).toEqual({ Accept: 'text/event-stream', Authorization: `Bearer ${TEST_API_KEY}` });
    expect(post.body).toEqual({
      model: 'test-model',
      input: [
        { role: 'user', content: 'Hi' },
        { type: 'function_call', call_id: 'call_1', name: 'web_search', arguments: '{"query":"a"}' },
        { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
      ],
      instructions: 'You are helpful.',
      tools: [
        {
          type: 'function',
          name: 'web_search',
          description: 'Search the web.',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      ],
      tool_choice: 'auto',
      temperature: 0.5,
      max_output_tokens: 256,
      stream: true,
    });
  });

  it('mapea assistant con texto y prioriza request.system; normaliza baseUrl con slash final', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('ok')));
    const adapter = makeAdapter(transport, undefined, responsesConfig({ baseUrl: 'https://api.example.com/v1/' }));

    await collect(
      adapter.streamChat(
        responsesChatRequest({
          system: 'Top-level system.',
          messages: [
            { role: 'system', content: 'Ignored system.' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hola' },
          ],
          maxOutputTokens: null,
        }),
      ),
    );

    const post = requirePost(transport);
    expect(post.url).toBe('https://api.example.com/v1/responses');
    expect(post.body).toEqual({
      model: 'test-model',
      input: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hola' },
      ],
      instructions: 'Top-level system.',
      stream: true,
    });
    expect(post.body).not.toHaveProperty('tools');
    expect(post.body).not.toHaveProperty('tool_choice');
    expect(post.body).not.toHaveProperty('max_output_tokens');
  });

  it('thinking off no envía reasoning (comportamiento actual)', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('ok')));
    const adapter = makeAdapter(transport);

    await collect(adapter.streamChat(responsesChatRequest({ thinking: 'off' })));

    expect(requirePost(transport).body).not.toHaveProperty('reasoning');
  });

  it('thinking mapea el nivel a effort con resumen automático', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('ok')));
    const adapter = makeAdapter(transport);

    await collect(adapter.streamChat(responsesChatRequest({ thinking: 'high' })));

    expect(requirePost(transport).body).toMatchObject({
      reasoning: { effort: 'high', summary: 'auto' },
    });
  });

  it('thinking max se degrada a high (sin tier xhigh en todos los modelos)', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('ok')));
    const adapter = makeAdapter(transport);

    await collect(adapter.streamChat(responsesChatRequest({ thinking: 'max' })));

    expect(requirePost(transport).body).toMatchObject({
      reasoning: { effort: 'high', summary: 'auto' },
    });
  });
});

describe('streamChat SSE', () => {
  it('emite start, text-deltas y stop end_turn', async () => {
    const adapter = makeAdapter(fakeTransport(() => sseResult(textResponse('Hola', ' mundo'))));

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'Hola' },
      { type: 'text-delta', delta: ' mundo' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('emite reasoning-delta para summary_text y reasoning_text', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(reasoningDelta('pienso') + reasoningTextDelta(' mas') + textDelta('respuesta') + responseCompleted())),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'reasoning-delta', delta: 'pienso' },
      { type: 'reasoning-delta', delta: ' mas' },
      { type: 'text-delta', delta: 'respuesta' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('tolera el tipo en payload.type sin event nombrado', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(responsesFrame('x', {}) + `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'sin-event' })}\n\n` + responseCompleted()),
      ),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'sin-event' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('acumula argumentos por output_index, emite el tool-call una sola vez y cierra tool_use', async () => {
    const item = {
      id: 'fc_1',
      type: 'function_call',
      call_id: 'call_abc',
      name: 'web_search',
      arguments: '{"query":"clima en Madrid"}',
    };
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          functionCallArgsDelta('fc_1', 0, '{"query":"clima') +
            functionCallArgsDelta('fc_1', 0, ' en Madrid"}') +
            outputItemDone(item, 0) +
            responseCompleted({ output: [item] }),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'tool-call', toolCall: { id: 'call_abc', name: 'web_search', argumentsText: '{"query":"clima en Madrid"}' } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('drena tool-calls pendientes y mapea usage + max_tokens en response.completed', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          textDelta('parcial') +
            responseCompleted({
              output: [{ id: 'fc_2', type: 'function_call', call_id: 'call_2', name: 'open_url', arguments: '{"url":"https://a"}' }],
              usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
              incomplete_details: { reason: 'max_output_tokens' },
            }),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'parcial' },
      { type: 'tool-call', toolCall: { id: 'call_2', name: 'open_url', argumentsText: '{"url":"https://a"}' } },
      { type: 'usage', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
      { type: 'stop', reason: 'max_tokens' },
    ]);
  });

  it('flush de la tool-call pendiente al terminar sin response.completed', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          functionCallArgsDelta('fc_3', 0, '{"query":"x"}') +
            outputItemDone({ id: 'fc_3', type: 'function_call', call_id: 'call_3', name: 'web_search', arguments: '{"query":"x"}' }, 0),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'tool-call', toolCall: { id: 'call_3', name: 'web_search', argumentsText: '{"query":"x"}' } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });
});

describe('streamChat abort y errores', () => {
  it('con signal ya abortado emite un único stop aborted sin postear', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = fakeTransport(() => {
      throw new Error('transport must not be called');
    });
    const adapter = makeAdapter(transport);

    await expect(collect(adapter.streamChat(responsesChatRequest({ signal: controller.signal })))).resolves.toEqual([
      { type: 'stop', reason: 'aborted' },
    ]);
    expect(transport.posts).toHaveLength(0);
  });

  it('abort a mitad de stream emite stop aborted y no deja timers vivos', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const transport = fakeTransport(() => ({ mode: 'sse', stream: stalledStream(textDelta('uno'), controller.signal) }));
    const adapter = makeAdapter(transport);

    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat(responsesChatRequest({ signal: controller.signal }))) {
      events.push(event);
      if (event.type === 'text-delta') controller.abort();
    }

    expect(events).toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'uno' },
      { type: 'stop', reason: 'aborted' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('response.failed sin salida previa lanza ProviderError server retryable', async () => {
    const adapter = makeAdapter(fakeTransport(() => sseResult(responseFailed('internal server error'))));

    const { events, error } = await drain(adapter.streamChat(responsesChatRequest()));
    expect(events).toEqual([{ type: 'start' }]);
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('internal server error');
  });

  it('response.failed después de deltas emite error y termina sin lanzar', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(textDelta('hola') + responseFailed('invalid request payload', 'invalid_request_error'))),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'hola' },
      { type: 'error', error: { code: 'invalid_request', message: 'invalid request payload', retryable: false } },
    ]);
  });
});

describe('streamChat buffered', () => {
  it('emite transport-fallback y parsea output[] + usage', async () => {
    const body = JSON.stringify({
      id: 'resp_1',
      object: 'response',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'pienso' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hola' }] },
        { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'open_url', arguments: '{"url":"https://a.example"}' },
      ],
      usage: { input_tokens: 7, output_tokens: 4, total_tokens: 11 },
    });
    const adapter = makeAdapter(fakeTransport(() => bufferedResult(body)));

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'transport-fallback', reason: 'cors' },
      { type: 'reasoning-delta', delta: 'pienso' },
      { type: 'text-delta', delta: 'Hola' },
      { type: 'tool-call', toolCall: { id: 'call_9', name: 'open_url', argumentsText: '{"url":"https://a.example"}' } },
      { type: 'usage', usage: { promptTokens: 7, completionTokens: 4, totalTokens: 11 } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('parsea un cuerpo SSE completo buffereado por el fallback nativo', async () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult(textResponse('uno', 'dos'))));

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'transport-fallback', reason: 'cors' },
      { type: 'text-delta', delta: 'uno' },
      { type: 'text-delta', delta: 'dos' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('con status 401 lanza ProviderError antes del primer evento', async () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('{"error":{"message":"bad key"}}', 401)));

    const { events, error } = await drain(adapter.streamChat(responsesChatRequest()));
    expect(events).toEqual([]);
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
  });
});

describe('streamChat robustez adversarial', () => {
  it('ignora frames con JSON inválido y continúa con los válidos', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult('event: response.output_text.delta\ndata: {not-json\n\n' + textDelta('ok') + responseCompleted()),
      ),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'ok' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('ignora eventos desconocidos sin romper el stream', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(responsesFrame('response.in_progress', { delta: 'x' }) + textDelta('ok') + responseCompleted())),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'ok' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('emite una sola vez un response.output_item.done duplicado', async () => {
    const item = { id: 'fc_dup', type: 'function_call', call_id: 'call_dup', name: 'web_search', arguments: '{}' };
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(outputItemDone(item, 0) + outputItemDone(item, 0) + responseCompleted())),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'tool-call', toolCall: { id: 'call_dup', name: 'web_search', argumentsText: '{}' } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('no emite tool-call si solo llegan argumentos sin nombre ni item previo', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(functionCallArgsDelta('fc_huerfano', 0, '{"a":1}') + responseCompleted())),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('ignora deltas vacíos de argumentos y de texto', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(functionCallArgsDelta('fc_x', 0, '') + textDelta('') + textDelta('ok') + responseCompleted())),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'ok' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('abort a mitad de acumulación de tool-call emite stop aborted sin tool-call', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const transport = fakeTransport(() => ({
      mode: 'sse',
      stream: stalledStream(functionCallArgsDelta('fc_pending', 0, '{"q":') + textDelta('uno'), controller.signal),
    }));
    const adapter = makeAdapter(transport);

    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat(responsesChatRequest({ signal: controller.signal }))) {
      events.push(event);
      if (event.type === 'text-delta') controller.abort();
    }

    expect(events).toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'uno' },
      { type: 'stop', reason: 'aborted' },
    ]);
  });

  it('transporta 100k caracteres de texto sin romper ni truncar', async () => {
    const big = 'a'.repeat(100_000);
    const adapter = makeAdapter(fakeTransport(() => sseResult(textDelta(big) + responseCompleted())));

    const events = await collect(adapter.streamChat(responsesChatRequest()));
    expect(events[1]).toEqual({ type: 'text-delta', delta: big });
  });

  it('ignora usage con valores no numéricos', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          responseCompleted({ output: [], usage: { input_tokens: 'x', output_tokens: null, total_tokens: true } }),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('emite error de stream en evento error tras deltas sin lanzar', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult(textDelta('parcial') + responsesFrame('error', { message: 'sin conexión' }))),
    );

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'parcial' },
      { type: 'error', error: { code: 'server', message: 'sin conexión', retryable: true } },
    ]);
  });
});

describe('usage no finito (regresión)', () => {
  it('omite tokens Infinity de un SSE con 1e400', async () => {
    const raw =
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[],"usage":{"input_tokens":1e400,"output_tokens":2,"total_tokens":1e400}}}\n\n';
    const adapter = makeAdapter(fakeTransport(() => sseResult(raw)));

    await expect(collect(adapter.streamChat(responsesChatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'usage', usage: { completionTokens: 2 } },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });
});

describe('extraHeaders por request', () => {
  it('las aplica sobre las del provider', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('hi')));
    const adapter = createOpenAIResponsesAdapter(responsesConfig(), makeResponsesDeps(transport, fakeHttp(() => jsonResponse({}))));

    await collect(adapter.streamChat(responsesChatRequest({ extraHeaders: { 'x-opencode-session': 'conv-1' } })));

    const post = transport.posts[0];
    if (post === undefined) throw new Error('expected a recorded transport post');
    expect(post.headers).toMatchObject({ 'x-opencode-session': 'conv-1' });
  });
});

describe('caché de prompt', () => {
  it('añade prompt_cache_key con la sesión cuando hay hint de caché', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('hi')));
    const adapter = createOpenAIResponsesAdapter(
      responsesConfig(),
      makeResponsesDeps(transport, fakeHttp(() => jsonResponse({}))),
    );

    await collect(adapter.streamChat(responsesChatRequest({ sessionId: 'conv-9', cache: { cacheControl: true } })));

    const post = transport.posts[0];
    if (post === undefined) throw new Error('expected a recorded transport post');
    expect((post.body as { prompt_cache_key?: string }).prompt_cache_key).toBe('conv-9');
  });

  it('no añade prompt_cache_key sin el hint', async () => {
    const transport = fakeTransport(() => sseResult(textResponse('hi')));
    const adapter = createOpenAIResponsesAdapter(
      responsesConfig(),
      makeResponsesDeps(transport, fakeHttp(() => jsonResponse({}))),
    );

    await collect(adapter.streamChat(responsesChatRequest({ sessionId: 'conv-9' })));

    const post = transport.posts[0];
    if (post === undefined) throw new Error('expected a recorded transport post');
    expect(post.body).not.toHaveProperty('prompt_cache_key');
  });
});
