import { describe, expect, it } from 'vitest';
import { createHttpError } from '@/adapters/http/FetchHttpClient';
import { HttpError } from '@/domain/ports/HttpClient';
import type { HttpClient, StreamResult, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderKind, ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import { ProviderError } from './errors';
import { createOpenAICompatibleAdapter } from './openaiCompatible';
import { createProviderAdapter } from './index';
import type { FakeTransport, RecordedPost } from './__fixtures__/openaiCompatible';
import {
  bufferedResult,
  chatRequest,
  chunk,
  erroringStream,
  fakeHttp,
  fakeTransport,
  jsonResponse,
  makeDeps,
  providerConfig,
  sseDone,
  sseFrame,
  sseResult,
  stalledStream,
  TEST_API_KEY,
  textStream,
  usageChunk,
  webSearchTool,
} from './__fixtures__/openaiCompatible';

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
  config: ProviderConfig = providerConfig(),
): ReturnType<typeof createOpenAICompatibleAdapter> {
  return createOpenAICompatibleAdapter(config, makeDeps(transport, http));
}

describe('createOpenAICompatibleAdapter', () => {
  it('expone identidad y capacidades exactas', () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')));
    expect(adapter.providerId).toBe('test-provider');
    expect(adapter.kind).toBe('openai-compatible');
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
      jsonResponse({
        data: [{ id: 'm1', name: 'Model One' }, { id: 'm2' }, { id: '' }, { noId: true }],
      }),
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

  it('acepta también {models:[...]} y descarta entradas inválidas', async () => {
    const http = fakeHttp(() => jsonResponse({ models: [{ id: 'a' }, 'skip', null, { id: 'b', name: 'Bee' }] }));
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')), http);

    await expect(adapter.listModels()).resolves.toEqual([
      { id: 'a', label: 'a', source: 'api' },
      { id: 'b', label: 'Bee', source: 'api' },
    ]);
  });

  it('sin requiresKey omite Authorization y conserva extraHeaders', async () => {
    const http = fakeHttp(() => jsonResponse({ data: [] }));
    const adapter = createOpenAICompatibleAdapter(
      providerConfig({ requiresKey: false, extraHeaders: { 'X-Custom': '1' } }),
      makeDeps(fakeTransport(() => bufferedResult('')), http, { apiKey: undefined }),
    );

    await expect(adapter.listModels()).resolves.toEqual([]);
    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.headers).toEqual({ 'X-Custom': '1', Accept: 'application/json' });
  });

  it('mapea 401 a auth y 429 a rate_limit con Retry-After', async () => {
    const unauthorized = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => ({ status: 401, headers: {}, text: '{"error":{"message":"bad key"}}' })),
    );
    const unauthorizedError = await capture(unauthorized.listModels());
    if (!(unauthorizedError instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(unauthorizedError.code).toBe('auth');
    expect(unauthorizedError.retryable).toBe(false);
    expect(unauthorizedError.status).toBe(401);
    expect(unauthorizedError.message).toBe('bad key');

    const rateLimited = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => ({ status: 429, headers: { 'Retry-After': '2.5' }, text: '' })),
    );
    const rateLimitError = await capture(rateLimited.listModels());
    if (!(rateLimitError instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(rateLimitError.code).toBe('rate_limit');
    expect(rateLimitError.retryable).toBe(true);
    expect(rateLimitError.retryAfterMs).toBe(2500);
  });

  it('propaga HttpError de red sin envolverlo', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => {
        throw createHttpError('network', 'offline');
      }),
    );

    const error = await capture(adapter.listModels());
    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) throw new Error('expected HttpError');
    expect(error.kind).toBe('network');
  });

  it('lanza ProviderError unknown si el body no es JSON válido ni tiene lista', async () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')), fakeHttp(() => ({ status: 200, headers: {}, text: 'not-json' })));

    const error = await capture(adapter.listModels());
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
  });
});

describe('streamChat payload', () => {
  it('construye el payload exacto con tools, quirks y mapeo de mensajes', async () => {
    const transport = fakeTransport(() => sseResult(textStream('ok')));
    const adapter = makeAdapter(transport, undefined, providerConfig({ quirks: { includeUsage: true, sendToolChoice: true } }));

    await collect(
      adapter.streamChat(
        chatRequest({
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
    expect(post.url).toBe('https://api.example.com/v1/chat/completions');
    expect(post.headers).toEqual({ Accept: 'text/event-stream', Authorization: `Bearer ${TEST_API_KEY}` });
    expect(post.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"a"}' } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_1' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.5,
      max_tokens: 256,
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web.',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          },
        },
      ],
      tool_choice: 'auto',
    });
  });

  it('omite tools, tool_choice sin tools, temperature y max_tokens nulos; normaliza baseUrl con slash final', async () => {
    const transport = fakeTransport(() => sseResult(textStream('ok')));
    const adapter = makeAdapter(
      transport,
      undefined,
      providerConfig({ baseUrl: 'https://api.example.com/v1/', requiresKey: false, quirks: { sendToolChoice: true } }),
    );

    await collect(adapter.streamChat(chatRequest({ maxOutputTokens: null, temperature: 0.2 })));

    const post = requirePost(transport);
    expect(post.url).toBe('https://api.example.com/v1/chat/completions');
    expect(post.headers).toEqual({ Accept: 'text/event-stream' });
    expect(post.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      stream: true,
      temperature: 0.2,
    });
    expect(post.body).not.toHaveProperty('tool_choice');
    expect(post.body).not.toHaveProperty('stream_options');
    expect(post.body).not.toHaveProperty('max_tokens');
  });
});

describe('streamChat SSE', () => {
  it('emite start, text-deltas, usage y stop end_turn', async () => {
    const transport = fakeTransport(() =>
      sseResult(
        sseFrame(chunk({ content: 'Hola' })) +
          sseFrame(chunk({ content: ' mundo' })) +
          sseFrame(chunk({}, 'stop')) +
          sseFrame(usageChunk({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })) +
          sseDone,
      ),
    );
    const adapter = makeAdapter(transport);

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'Hola' },
      { type: 'text-delta', delta: ' mundo' },
      { type: 'usage', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('mapea finish_reason length a max_tokens y razones desconocidas a end_turn', async () => {
    const truncated = makeAdapter(fakeTransport(() => sseResult(sseFrame(chunk({ content: 'parcial' })) + sseFrame(chunk({}, 'length')) + sseDone)));
    await expect(collect(truncated.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'parcial' },
      { type: 'stop', reason: 'max_tokens' },
    ]);

    const filtered = makeAdapter(fakeTransport(() => sseResult(sseFrame(chunk({ content: 'x' })) + sseFrame(chunk({}, 'content_filter')) + sseDone)));
    await expect(collect(filtered.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'x' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('emite reasoning_content como reasoning-delta', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          sseFrame(chunk({ reasoning_content: 'pienso' })) + sseFrame(chunk({ content: 'respuesta' })) + sseFrame(chunk({}, 'stop')) + sseDone,
        ),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'reasoning-delta', delta: 'pienso' },
      { type: 'text-delta', delta: 'respuesta' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('acumula una tool-call fragmentada en 3 deltas y la emite una vez con stop tool_use', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          [
            sseFrame(chunk({ tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'web_search', arguments: '{"qu' } }] })),
            sseFrame(chunk({ tool_calls: [{ index: 0, function: { arguments: 'ery":"clima' } }] })),
            sseFrame(chunk({ tool_calls: [{ index: 0, function: { arguments: ' en Madrid"}' } }] })),
            sseFrame(chunk({}, 'tool_calls')),
            sseDone,
          ].join(''),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'tool-call', toolCall: { id: 'call_abc', name: 'web_search', argumentsText: '{"query":"clima en Madrid"}' } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('acumula tool-calls paralelas por index y las ordena', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          [
            sseFrame(chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'web_search', arguments: '{"q"' } }] })),
            sseFrame(chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'open_url', arguments: '{"u"' } }] })),
            sseFrame(chunk({ tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] })),
            sseFrame(chunk({ tool_calls: [{ index: 1, function: { arguments: ':"y"}' } }] })),
            sseFrame(chunk({}, 'tool_calls')),
          ].join(''),
        ),
      ),
    );

    const events = await collect(adapter.streamChat(chatRequest()));
    expect(events).toEqual([
      { type: 'start' },
      { type: 'tool-call', toolCall: { id: 'a', name: 'web_search', argumentsText: '{"q":"x"}' } },
      { type: 'tool-call', toolCall: { id: 'b', name: 'open_url', argumentsText: '{"u":"y"}' } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('cierra sin [DONE] y drena la tool-call pendiente con end_turn por defecto', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          sseFrame(chunk({ content: 'parcial' })) +
            sseFrame(chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'open_url', arguments: '{"url":"https://a"}' } }] })),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'parcial' },
      { type: 'tool-call', toolCall: { id: 'call_1', name: 'open_url', argumentsText: '{"url":"https://a"}' } },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('[DONE] corta el parseo e ignora los frames posteriores', async () => {
    const adapter = makeAdapter(fakeTransport(() => sseResult(sseFrame(chunk({ content: 'uno' })) + sseDone + sseFrame(chunk({ content: 'despues' })))));

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'uno' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('ignora frames con JSON inválido sin cortar el stream', async () => {
    const adapter = makeAdapter(
      fakeTransport(() => sseResult('data: {not-json}\n\n' + sseFrame(chunk({ content: 'ok' })) + sseFrame(chunk({}, 'stop')) + sseDone)),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'ok' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });
});

describe('streamChat buffered', () => {
  it('emite transport-fallback y parsea choices[0].message completa', async () => {
    const body = JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hola',
            reasoning_content: 'pienso',
            tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'open_url', arguments: '{"url":"https://a.example"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 },
    });
    const adapter = makeAdapter(fakeTransport(() => bufferedResult(body)));

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
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
    const adapter = makeAdapter(fakeTransport(() => bufferedResult(textStream('uno', 'dos'))));

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'transport-fallback', reason: 'cors' },
      { type: 'text-delta', delta: 'uno' },
      { type: 'text-delta', delta: 'dos' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('con status 401 lanza ProviderError antes del primer evento', async () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('{"error":{"message":"bad key"}}', 401)));

    const { events, error } = await drain(adapter.streamChat(chatRequest()));
    expect(events).toEqual([]);
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
  });

  it('con status 429 lanza ProviderError retryable', async () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('slow down', 429)));

    const { events, error } = await drain(adapter.streamChat(chatRequest()));
    expect(events).toEqual([]);
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('rate_limit');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBeUndefined();
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

    await expect(collect(adapter.streamChat(chatRequest({ signal: controller.signal })))).resolves.toEqual([
      { type: 'stop', reason: 'aborted' },
    ]);
    expect(transport.posts).toHaveLength(0);
  });

  it('abort durante el POST no propaga HttpError y cierra con stop aborted', async () => {
    const controller = new AbortController();
    const transport = fakeTransport(
      ({ signal }) =>
        new Promise<StreamResult>((_, reject) => {
          signal.addEventListener('abort', () => reject(createHttpError('aborted', 'stream request aborted')), { once: true });
        }),
    );
    const adapter = makeAdapter(transport);

    const pending = collect(adapter.streamChat(chatRequest({ signal: controller.signal })));
    controller.abort();
    await expect(pending).resolves.toEqual([{ type: 'stop', reason: 'aborted' }]);
    expect(transport.posts).toHaveLength(1);
  });

  it('abort a mitad de stream emite exactamente un stop aborted al final', async () => {
    const controller = new AbortController();
    const transport = fakeTransport(() => ({
      mode: 'sse',
      stream: stalledStream(sseFrame(chunk({ content: 'uno' })), controller.signal),
    }));
    const adapter = makeAdapter(transport);

    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat(chatRequest({ signal: controller.signal }))) {
      events.push(event);
      if (event.type === 'text-delta') controller.abort();
    }

    expect(events).toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'uno' },
      { type: 'stop', reason: 'aborted' },
    ]);
  });

  it('propaga errores de stream no-abort después de los eventos ya emitidos', async () => {
    const streamAdapter = makeAdapter(fakeTransport(() => ({ mode: 'sse', stream: erroringStream([sseFrame(chunk({ content: 'x' }))], new Error('boom')) })));
    const { events, error } = await drain(streamAdapter.streamChat(chatRequest()));

    expect(events).toEqual([{ type: 'start' }, { type: 'text-delta', delta: 'x' }]);
    if (!(error instanceof Error)) throw new Error('expected Error');
    expect(error.message).toBe('boom');
  });
});

describe('createProviderAdapter', () => {
  const deps = makeDeps(fakeTransport(() => bufferedResult('')), fakeHttp(() => jsonResponse({})));

  it('despacha openai-compatible al adapter implementado', () => {
    const adapter = createProviderAdapter(providerConfig(), deps);
    expect(adapter.kind).toBe('openai-compatible');
    expect(adapter.providerId).toBe('test-provider');
    expect(adapter.capabilities().streaming).toBe(true);
  });

  it('despacha anthropic al adapter implementado', () => {
    const adapter = createProviderAdapter(providerConfig({ kind: 'anthropic' }), deps);
    expect(adapter.kind).toBe('anthropic');
  });

  it('kind desconocido lanza un error claro', () => {
    const invalidKind = 'gemini' as ProviderKind;
    expect(() => createProviderAdapter(providerConfig({ kind: invalidKind }), deps)).toThrowError(/unsupported provider kind/);
  });
});
