import { describe, expect, it } from 'vitest';
import { createHttpError } from '@/adapters/http/FetchHttpClient';
import { HttpError } from '@/domain/ports/HttpClient';
import type { HttpClient, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import { ANTHROPIC_FALLBACK_MODELS, createAnthropicAdapter } from './anthropic';
import { ProviderError } from './errors';
import { createProviderAdapter } from './index';
import type { FakeTransport, RecordedPost } from './__fixtures__/anthropic';
import {
  ANTHROPIC_MODEL,
  TEST_API_KEY,
  anthropicConfig,
  bufferedResult,
  chatRequest,
  contentBlockStart,
  contentBlockStop,
  errorEvent,
  fakeHttp,
  fakeTransport,
  inputJsonDelta,
  jsonResponse,
  makeDeps,
  messageDelta,
  messageStart,
  messageStop,
  pingEvent,
  sseResult,
  stalledStream,
  textDelta,
  textStream,
  thinkingDelta,
  webSearchTool,
} from './__fixtures__/anthropic';

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
  config: ProviderConfig = anthropicConfig(),
): ReturnType<typeof createAnthropicAdapter> {
  return createAnthropicAdapter(config, makeDeps(transport, http));
}

describe('createAnthropicAdapter', () => {
  it('expone identidad y capacidades exactas con imágenes', () => {
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')));
    expect(adapter.providerId).toBe('anthropic');
    expect(adapter.kind).toBe('anthropic');
    expect(adapter.capabilities()).toEqual({
      streaming: true,
      toolCalling: true,
      systemPrompt: true,
      listModels: true,
      images: true,
    });
  });
});

describe('listModels', () => {
  it('pide GET /v1/models?limit=1000 con headers Anthropic y normaliza display_name', async () => {
    const http = fakeHttp(() =>
      jsonResponse({
        data: [
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
          { id: 'claude-haiku-4-5' },
          { id: '' },
          'skip',
          null,
        ],
        has_more: false,
      }),
    );
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')), http);

    await expect(adapter.listModels()).resolves.toEqual([
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'api' },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5', source: 'api' },
    ]);

    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(request.method).toBe('GET');
    expect(request.timeoutMs).toBe(10_000);
    expect(request.headers).toEqual({
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': TEST_API_KEY,
    });
  });

  it('con 404 devuelve el catálogo estático local con source manual', async () => {
    const http = fakeHttp(() => ({ status: 404, headers: {}, text: '{"error":{"message":"not found"}}' }));
    const adapter = makeAdapter(fakeTransport(() => bufferedResult('')), http);

    const models = await adapter.listModels();
    expect(models).toEqual(ANTHROPIC_FALLBACK_MODELS);
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.every((model) => model.source === 'manual')).toBe(true);
  });

  it('mapea 429 con Retry-After y 503 a ProviderError', async () => {
    const rateLimited = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => ({ status: 429, headers: { 'Retry-After': '3' }, text: '' })),
    );
    const rateLimitError = await capture(rateLimited.listModels());
    if (!(rateLimitError instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(rateLimitError.code).toBe('rate_limit');
    expect(rateLimitError.retryable).toBe(true);
    expect(rateLimitError.retryAfterMs).toBe(3000);

    const failed = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => ({ status: 503, headers: {}, text: 'overloaded' })),
    );
    const serverError = await capture(failed.listModels());
    if (!(serverError instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(serverError.code).toBe('server');
    expect(serverError.retryable).toBe(true);
  });

  it('propaga HttpError de red y rechaza cuerpos sin shape de lista', async () => {
    const offline = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => {
        throw createHttpError('network', 'offline');
      }),
    );
    const networkError = await capture(offline.listModels());
    expect(networkError).toBeInstanceOf(HttpError);
    if (!(networkError instanceof HttpError)) throw new Error('expected HttpError');
    expect(networkError.kind).toBe('network');

    const malformed = makeAdapter(
      fakeTransport(() => bufferedResult('')),
      fakeHttp(() => ({ status: 200, headers: {}, text: 'not-json' })),
    );
    const malformedError = await capture(malformed.listModels());
    if (!(malformedError instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(malformedError.code).toBe('unknown');
    expect(malformedError.retryable).toBe(false);
  });
});

describe('streamChat payload', () => {
  it('construye el payload exacto: system top-level, tools sin wrapper y mapeo de mensajes', async () => {
    const transport = fakeTransport(() => sseResult(textStream('ok')));
    const adapter = makeAdapter(transport);

    await collect(
      adapter.streamChat(
        chatRequest({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Let me search.', toolCalls: [{ id: 'call_1', name: 'web_search', argumentsText: '{"query":"a"}' }] },
            { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1', toolName: 'web_search' },
          ],
          tools: [webSearchTool],
          temperature: 0.5,
          maxOutputTokens: 256,
        }),
      ),
    );

    const post = requirePost(transport);
    expect(post.url).toBe('https://api.anthropic.com/v1/messages');
    expect(post.headers).toEqual({
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': TEST_API_KEY,
    });
    expect(post.body).toEqual({
      model: ANTHROPIC_MODEL,
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me search.' },
            { type: 'tool_use', id: 'call_1', name: 'web_search', input: { query: 'a' } },
          ],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"ok":true}' }] },
      ],
      max_tokens: 256,
      temperature: 0.5,
      stream: true,
      tools: [
        {
          name: 'web_search',
          description: 'Search the web.',
          input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      ],
    });
    expect(post.body).not.toHaveProperty('tool_choice');
  });

  it('prioriza req.system, excluye todo system de messages y usa max_tokens 2048 por defecto', async () => {
    const transport = fakeTransport(() => sseResult(textStream('ok')));
    const adapter = makeAdapter(transport);

    await collect(
      adapter.streamChat(
        chatRequest({
          system: 'Override',
          messages: [
            { role: 'system', content: 'ignored' },
            { role: 'user', content: 'Hey' },
          ],
          maxOutputTokens: null,
        }),
      ),
    );

    const post = requirePost(transport);
    expect(post.body).toMatchObject({
      system: 'Override',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hey' }] }],
      max_tokens: 2048,
    });
    expect(post.body).not.toHaveProperty('temperature');
    expect(post.body).not.toHaveProperty('tools');
  });

  it('sin apiKey omite x-api-key y conserva extraHeaders', async () => {
    const transport = fakeTransport(() => sseResult(textStream('ok')));
    const config = anthropicConfig({ requiresKey: false, extraHeaders: { 'X-Custom': '1' } });
    const adapter = createAnthropicAdapter(config, makeDeps(transport, fakeHttp(() => jsonResponse({})), { apiKey: undefined }));

    await collect(adapter.streamChat(chatRequest()));

    expect(requirePost(transport).headers).toEqual({
      'X-Custom': '1',
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  });

  it('normaliza bases con /v1 y slash final sin duplicar el segmento', async () => {
    const transport = fakeTransport(() => sseResult(textStream('ok')));
    const http = fakeHttp(() => jsonResponse({ data: [] }));
    const adapter = makeAdapter(transport, http, anthropicConfig({ baseUrl: 'https://proxy.example.com/anthropic/v1/' }));

    await collect(adapter.streamChat(chatRequest()));
    expect(requirePost(transport).url).toBe('https://proxy.example.com/anthropic/v1/messages');

    await adapter.listModels();
    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.url).toBe('https://proxy.example.com/anthropic/v1/models?limit=1000');
  });
});

describe('streamChat SSE', () => {
  it('emite start, text-deltas y stop end_turn ignorando ping', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          messageStart() +
            pingEvent() +
            contentBlockStart(0, { type: 'text', text: '' }) +
            textDelta(0, 'Hola') +
            textDelta(0, ' mundo') +
            pingEvent() +
            contentBlockStop(0) +
            messageDelta('end_turn') +
            messageStop(),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'Hola' },
      { type: 'text-delta', delta: ' mundo' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('un stream solo de ping y message_delta cierra limpio', async () => {
    const adapter = makeAdapter(fakeTransport(() => sseResult(messageStart() + pingEvent() + pingEvent() + messageDelta('end_turn') + messageStop())));

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('mapea thinking_delta a reasoning-delta', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          messageStart() +
            contentBlockStart(0, { type: 'thinking', thinking: '' }) +
            thinkingDelta(0, 'pienso') +
            contentBlockStop(0) +
            contentBlockStart(1, { type: 'text', text: '' }) +
            textDelta(1, 'respuesta') +
            contentBlockStop(1) +
            messageDelta('end_turn') +
            messageStop(),
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

  it('acumula input_json_delta fragmentado y emite la tool-call en content_block_stop', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          messageStart() +
            contentBlockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'web_search', input: {} }) +
            inputJsonDelta(0, '{"qu') +
            inputJsonDelta(0, 'ery":"clima') +
            inputJsonDelta(0, ' en Madrid"}') +
            contentBlockStop(0) +
            messageDelta('tool_use') +
            messageStop(),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'tool-call', toolCall: { id: 'toolu_1', name: 'web_search', argumentsText: '{"query":"clima en Madrid"}' } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('emite usage de message_start (input) y message_delta (output)', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(
          messageStart(25) +
            contentBlockStart(0, { type: 'text', text: '' }) +
            textDelta(0, 'hola') +
            contentBlockStop(0) +
            messageDelta('end_turn', 8) +
            messageStop(),
        ),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'usage', usage: { promptTokens: 25 } },
      { type: 'text-delta', delta: 'hola' },
      { type: 'usage', usage: { completionTokens: 8 } },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('mapea max_tokens y stop_sequence y cae a end_turn con razones desconocidas', async () => {
    const cases = [
      ['max_tokens', 'max_tokens'],
      ['stop_sequence', 'stop_sequence'],
      ['pause_turn', 'end_turn'],
    ] as const;

    for (const [reason, expected] of cases) {
      const adapter = makeAdapter(fakeTransport(() => sseResult(messageStart() + messageDelta(reason) + messageStop())));
      await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
        { type: 'start' },
        { type: 'stop', reason: expected },
      ]);
    }
  });

  it('emite un evento error terminal si el error llega después de un delta', async () => {
    const adapter = makeAdapter(
      fakeTransport(() =>
        sseResult(messageStart() + contentBlockStart(0, { type: 'text', text: '' }) + textDelta(0, 'x') + errorEvent('overloaded_error', 'Overloaded')),
      ),
    );

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'x' },
      { type: 'error', error: { code: 'server', message: 'Overloaded', retryable: true } },
    ]);
  });

  it('lanza ProviderError si el error llega antes del primer delta', async () => {
    const adapter = makeAdapter(fakeTransport(() => sseResult(messageStart() + errorEvent('authentication_error', 'bad key'))));

    const { events, error } = await drain(adapter.streamChat(chatRequest()));
    expect(events).toEqual([{ type: 'start' }]);
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('auth');
    expect(error.retryable).toBe(false);
  });
});

describe('streamChat buffered', () => {
  it('emite transport-fallback y parsea content[] con usage y stop_reason', async () => {
    const body = JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: ANTHROPIC_MODEL,
      content: [
        { type: 'thinking', thinking: 'pienso' },
        { type: 'text', text: 'Hola' },
        { type: 'tool_use', id: 'toolu_9', name: 'open_url', input: { url: 'https://a.example' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 7, output_tokens: 4 },
    });
    const adapter = makeAdapter(fakeTransport(() => bufferedResult(body)));

    await expect(collect(adapter.streamChat(chatRequest()))).resolves.toEqual([
      { type: 'start' },
      { type: 'transport-fallback', reason: 'cors' },
      { type: 'reasoning-delta', delta: 'pienso' },
      { type: 'text-delta', delta: 'Hola' },
      { type: 'tool-call', toolCall: { id: 'toolu_9', name: 'open_url', argumentsText: '{"url":"https://a.example"}' } },
      { type: 'usage', usage: { promptTokens: 7, completionTokens: 4 } },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });

  it('parsea una transcripción SSE completa buffereada por el fallback nativo', async () => {
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
});

describe('streamChat abort', () => {
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

  it('abort a mitad de stream emite exactamente un stop aborted al final', async () => {
    const controller = new AbortController();
    const transport = fakeTransport(() => ({
      mode: 'sse',
      stream: stalledStream(
        messageStart() + contentBlockStart(0, { type: 'text', text: '' }) + textDelta(0, 'uno'),
        controller.signal,
      ),
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
});

describe('createProviderAdapter', () => {
  it('despacha anthropic al adapter implementado', () => {
    const deps = makeDeps(fakeTransport(() => bufferedResult('')), fakeHttp(() => jsonResponse({})));
    const adapter = createProviderAdapter(anthropicConfig(), deps);

    expect(adapter.kind).toBe('anthropic');
    expect(adapter.providerId).toBe('anthropic');
    expect(adapter.capabilities().images).toBe(true);
  });
});
