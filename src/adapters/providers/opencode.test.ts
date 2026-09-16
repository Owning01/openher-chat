import { describe, expect, it } from 'vitest';
import type { HttpClient, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import { ProviderError } from './errors';
import { parseOpenAIModelList } from './modelList';
import {
  buildOpenCodeHeaders,
  classifyOpenCodeModelApi,
  createOpenCodeAdapter,
  openCodeVariantFromBaseUrl,
  OPENCODE_CLIENT,
  OPENCODE_CLIENT_HEADER,
  OPENCODE_SESSION_HEADER,
  resolveOpenCodeBaseUrl,
} from './opencode';
import type { AdapterFactory } from './opencode';
import {
  chatRequest,
  fakeHttp,
  fakeTransport,
  jsonResponse,
  makeDeps,
  providerConfig,
  TEST_API_KEY,
} from './__fixtures__/openaiCompatible';
import { recordingDelegates } from './__fixtures__/opencode';
import type { RecordingDelegates } from './__fixtures__/opencode';

async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function capture<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function makeAdapter(
  http: HttpClient = fakeHttp(() => jsonResponse({ data: [] })),
  config: ProviderConfig = providerConfig({ kind: 'opencode' }),
  recording: RecordingDelegates = recordingDelegates(),
): { adapter: ReturnType<typeof createOpenCodeAdapter>; recording: RecordingDelegates } {
  const transport: StreamTransport = fakeTransport(() => {
    throw new Error('stream transport must not be called in this test');
  });
  const adapter = createOpenCodeAdapter(config, makeDeps(transport, http), recording.delegates);
  return { adapter, recording };
}

describe('classifyOpenCodeModelApi', () => {
  it('clasifica claude/qwen como messages', () => {
    expect(classifyOpenCodeModelApi('claude-sonnet-4')).toBe('messages');
    expect(classifyOpenCodeModelApi('qwen3-coder')).toBe('messages');
  });

  it('clasifica gpt/grok/muse-spark como responses', () => {
    expect(classifyOpenCodeModelApi('gpt-5')).toBe('responses');
    expect(classifyOpenCodeModelApi('grok-code-fast')).toBe('responses');
    expect(classifyOpenCodeModelApi('muse-spark-1')).toBe('responses');
  });

  it('clasifica el resto como chat-completions', () => {
    const ids = ['deepseek-chat', 'glm-4.6', 'kimi-k2', 'minimax-m2', 'gemini-2.5-pro', 'free-model', 'unknown-model'];
    for (const id of ids) expect(classifyOpenCodeModelApi(id)).toBe('chat-completions');
  });

  it('es case-insensitive', () => {
    expect(classifyOpenCodeModelApi('CLAUDE-X')).toBe('messages');
    expect(classifyOpenCodeModelApi('Qwen-X')).toBe('messages');
    expect(classifyOpenCodeModelApi('GPT-X')).toBe('responses');
    expect(classifyOpenCodeModelApi('Muse-Spark')).toBe('responses');
  });
});

describe('createOpenCodeAdapter identidad y capacidades', () => {
  it('expone providerId, kind opencode y capacidades exactas', () => {
    const { adapter } = makeAdapter();
    expect(adapter.providerId).toBe('test-provider');
    expect(adapter.kind).toBe('opencode');
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
  it('hace GET /models con timeout 10s y Bearer, y etiqueta api + supportsTools', async () => {
    const http = fakeHttp(() =>
      jsonResponse({
        data: [
          { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
          { id: 'gpt-5' },
          { id: 'deepseek-chat' },
          { id: '' },
        ],
      }),
    );
    const { adapter } = makeAdapter(http, providerConfig({ kind: 'opencode', baseUrl: 'https://opencode.ai/zen/v1' }));

    await expect(adapter.listModels()).resolves.toEqual([
      { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', source: 'api', api: 'messages', supportsTools: true },
      { id: 'gpt-5', label: 'gpt-5', source: 'api', api: 'responses', supportsTools: true },
      { id: 'deepseek-chat', label: 'deepseek-chat', source: 'api', api: 'chat-completions', supportsTools: true },
    ]);

    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.url).toBe('https://opencode.ai/zen/v1/models');
    expect(request.method).toBe('GET');
    expect(request.timeoutMs).toBe(10_000);
    expect(request.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TEST_API_KEY}` });
  });

  it('normaliza baseUrl con slash final', async () => {
    const http = fakeHttp(() => jsonResponse({ models: [] }));
    const { adapter } = makeAdapter(http, providerConfig({ kind: 'opencode', baseUrl: 'https://opencode.ai/zen/v1/' }));

    await expect(adapter.listModels()).resolves.toEqual([]);
    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.url).toBe('https://opencode.ai/zen/v1/models');
  });

  it('sin requiresKey omite Authorization y conserva extraHeaders', async () => {
    const http = fakeHttp(() => jsonResponse({ data: [] }));
    const transport: StreamTransport = fakeTransport(() => {
      throw new Error('stream transport must not be called in this test');
    });
    const config = providerConfig({ kind: 'opencode', requiresKey: false, extraHeaders: { 'X-Custom': '1' } });
    const adapter = createOpenCodeAdapter(config, makeDeps(transport, http, { apiKey: undefined }), recordingDelegates().delegates);

    await expect(adapter.listModels()).resolves.toEqual([]);
    const [request] = http.requests;
    if (request === undefined) throw new Error('expected a recorded http request');
    expect(request.headers).toEqual({ 'X-Custom': '1', Accept: 'application/json' });
  });

  it('no 2xx lanza ProviderError', async () => {
    const http = fakeHttp(() => ({ status: 401, headers: {}, text: '{"error":{"message":"bad key"}}' }));
    const { adapter } = makeAdapter(http);

    const error = await capture(adapter.listModels());
    if (!(error instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(error.code).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('bad key');
  });
});

describe('streamChat router', () => {
  it('enruta claude→messages, gpt→responses y deepseek→chat-completions', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'claude-x' })));
    await collect(adapter.streamChat(chatRequest({ modelId: 'gpt-x' })));
    await collect(adapter.streamChat(chatRequest({ modelId: 'deepseek-x' })));

    expect(recording.calls.map((call) => call.api)).toEqual(['messages', 'responses', 'chat-completions']);
    const events = await collect(adapter.streamChat(chatRequest({ modelId: 'claude-y' })));
    expect(events).toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'messages' },
      { type: 'stop', reason: 'end_turn' },
    ]);
  });

  it('respeta el override api explícito en config.models', async () => {
    const config = providerConfig({
      kind: 'opencode',
      models: [{ id: 'deepseek-x', label: 'DeepSeek X', source: 'manual', api: 'responses' }],
    });
    const { adapter, recording } = makeAdapter(undefined, config);

    await collect(adapter.streamChat(chatRequest({ modelId: 'deepseek-x' })));
    expect(recording.calls.map((call) => call.api)).toEqual(['responses']);
  });

  it('modelo desconocido cae a chat-completions', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'totally-unknown' })));
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]?.api).toBe('chat-completions');
    expect(recording.calls[0]?.request.modelId).toBe('totally-unknown');
  });

  it('construye cada delegate una sola vez y lo reutiliza', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'claude-a' })));
    await collect(adapter.streamChat(chatRequest({ modelId: 'claude-b' })));

    expect(recording.built).toEqual(['messages']);
    expect(recording.calls).toHaveLength(2);
  });

  it('cae a chat-completions si un delegate falta en runtime', async () => {
    const recording = recordingDelegates();
    const brokenDelegates = {
      ...recording.delegates,
      messages: undefined as unknown as AdapterFactory,
    };
    const transport: StreamTransport = fakeTransport(() => {
      throw new Error('stream transport must not be called in this test');
    });
    const adapter = createOpenCodeAdapter(
      providerConfig({ kind: 'opencode' }),
      makeDeps(transport, fakeHttp(() => jsonResponse({}))),
      brokenDelegates,
    );

    await collect(adapter.streamChat(chatRequest({ modelId: 'claude-x' })));
    expect(recording.calls.map((call) => call.api)).toEqual(['chat-completions']);
  });
});

describe('parseOpenAIModelList integración', () => {
  it('comparte el parser con las listas de OpenCode Zen', () => {
    expect(parseOpenAIModelList(JSON.stringify({ data: [{ id: 'glm-4.6' }] }))).toEqual([
      { id: 'glm-4.6', label: 'glm-4.6', source: 'api' },
    ]);
  });
});

describe('classifyOpenCodeModelApi adversarial', () => {
  it('devuelve chat-completions para vacío, solo espacios, unicode y sin prefijo', () => {
    expect(classifyOpenCodeModelApi('')).toBe('chat-completions');
    expect(classifyOpenCodeModelApi('   ')).toBe('chat-completions');
    expect(classifyOpenCodeModelApi('ｇｐｔ-5')).toBe('chat-completions');
    expect(classifyOpenCodeModelApi('zzz')).toBe('chat-completions');
  });

  it('clasifica prefijos parciales por su familia de prefijo', () => {
    expect(classifyOpenCodeModelApi('gptx')).toBe('responses');
    expect(classifyOpenCodeModelApi('claudex')).toBe('messages');
    expect(classifyOpenCodeModelApi('qwen')).toBe('messages');
    expect(classifyOpenCodeModelApi('grok')).toBe('responses');
  });

  it('no lanza con un id de un millón de caracteres', () => {
    expect(classifyOpenCodeModelApi('x'.repeat(1_000_000))).toBe('chat-completions');
  });
});

describe('createOpenCodeAdapter adversarial', () => {
  it('el api explícito gana a la heurística en un id gpt', async () => {
    const config = providerConfig({
      kind: 'opencode',
      models: [{ id: 'gpt-5', label: 'GPT-5', source: 'manual', api: 'messages' }],
    });
    const { adapter, recording } = makeAdapter(undefined, config);

    await collect(adapter.streamChat(chatRequest({ modelId: 'gpt-5' })));
    expect(recording.calls.map((call) => call.api)).toEqual(['messages']);
  });

  it('colapsa varios slashes finales del baseUrl al listar modelos', async () => {
    const http = fakeHttp(() => jsonResponse({ data: [] }));
    const { adapter } = makeAdapter(http, providerConfig({ kind: 'opencode', baseUrl: 'https://opencode.ai/zen/v1///' }));

    await adapter.listModels();
    expect(http.requests[0]?.url).toBe('https://opencode.ai/zen/v1/models');
  });

  it('propaga el error si el factory del delegate lanza', async () => {
    const recording = recordingDelegates();
    const delegates = {
      ...recording.delegates,
      messages: (): never => {
        throw new Error('boom');
      },
    };
    const transport: StreamTransport = fakeTransport(() => {
      throw new Error('stream transport must not be called in this test');
    });
    const adapter = createOpenCodeAdapter(
      providerConfig({ kind: 'opencode' }),
      makeDeps(transport, fakeHttp(() => jsonResponse({}))),
      delegates,
    );

    await expect(collect(adapter.streamChat(chatRequest({ modelId: 'claude-x' })))).rejects.toThrow('boom');
  });
});

describe('classifyOpenCodeModelApi (regresión)', () => {
  it('recorta espacios y normaliza mayúsculas antes de clasificar', () => {
    expect(classifyOpenCodeModelApi('  GPT-5  ')).toBe('responses');
    expect(classifyOpenCodeModelApi(' claude-opus ')).toBe('messages');
    expect(classifyOpenCodeModelApi('  grok-4.5 ')).toBe('responses');
  });
});

describe('resolveOpenCodeBaseUrl (proxy dev de Vite)', () => {
  it('reescribe opencode.ai a la ruta relativa /zen en dev', () => {
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/go/v1', true)).toBe('/zen/go/v1');
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/v1/', true)).toBe('/zen/v1');
  });

  it('no reescribe fuera de dev ni hosts ajenos', () => {
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/go/v1', false)).toBe('https://opencode.ai/zen/go/v1');
    expect(resolveOpenCodeBaseUrl('https://proxy.example.com/zen/go/v1', true)).toBe('https://proxy.example.com/zen/go/v1');
  });

  it('no confunde prefijos parecidos (opencode.ai.evil.com)', () => {
    expect(resolveOpenCodeBaseUrl('https://opencode.ai.evil.com/zen/v1', true)).toBe('https://opencode.ai.evil.com/zen/v1');
  });

  it('el proxy propio (VPS) gana sobre /zen y recorta slashes', () => {
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/go/v1', true, 'https://zen.mi-vps.com')).toBe(
      'https://zen.mi-vps.com/zen/go/v1',
    );
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/go/v1', false, 'https://zen.mi-vps.com/')).toBe(
      'https://zen.mi-vps.com/zen/go/v1',
    );
  });

  it('ignora proxy inválido o de otro host y no toca nada', () => {
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/go/v1', true, 'no-es-url')).toBe('/zen/go/v1');
    expect(resolveOpenCodeBaseUrl('https://opencode.ai/zen/go/v1', true, '')).toBe('/zen/go/v1');
    expect(resolveOpenCodeBaseUrl('https://proxy.example.com/zen/go/v1', false, 'https://zen.mi-vps.com')).toBe(
      'https://proxy.example.com/zen/go/v1',
    );
  });
});

describe('OpenCode Go (variante)', () => {
  it('deriva la variante de la base URL', () => {
    expect(openCodeVariantFromBaseUrl('https://opencode.ai/zen/go/v1')).toBe('go');
    expect(openCodeVariantFromBaseUrl('https://opencode.ai/zen/go/v1/')).toBe('go');
    expect(openCodeVariantFromBaseUrl('https://opencode.ai/zen/v1')).toBe('zen');
    expect(openCodeVariantFromBaseUrl('https://api.example.com/v1')).toBe('zen');
  });

  it('en Go, MiniMax va a messages; en Zen, a chat-completions', () => {
    expect(classifyOpenCodeModelApi('minimax-m3', 'go')).toBe('messages');
    expect(classifyOpenCodeModelApi('minimax-m2.7', 'go')).toBe('messages');
    expect(classifyOpenCodeModelApi('minimax-m3', 'zen')).toBe('chat-completions');
  });

  it('Go: qwen→messages, gpt/grok/muse→responses, resto→chat-completions', () => {
    expect(classifyOpenCodeModelApi('qwen3.8-max', 'go')).toBe('messages');
    expect(classifyOpenCodeModelApi('grok-4.6', 'go')).toBe('responses');
    expect(classifyOpenCodeModelApi('gpt-5.6-luna', 'go')).toBe('responses');
    expect(classifyOpenCodeModelApi('deepseek-v4.1-flash', 'go')).toBe('chat-completions');
    expect(classifyOpenCodeModelApi('longcat-2.0', 'go')).toBe('chat-completions');
    expect(classifyOpenCodeModelApi('hy4-preview', 'go')).toBe('chat-completions');
    expect(classifyOpenCodeModelApi('omen-alpha', 'go')).toBe('chat-completions');
  });

  it('listModels de un proveedor Go etiqueta MiniMax como messages', async () => {
    const http = fakeHttp(() =>
      jsonResponse({
        data: [
          { id: 'minimax-m3' },
          { id: 'glm-5.3' },
          { id: 'grok-4.6' },
          { id: 'qwen3.8-flash' },
        ],
      }),
    );
    const config = providerConfig({ kind: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1' });
    const adapter = createOpenCodeAdapter(config, makeDeps(fakeTransport(() => ({ mode: 'buffered', status: 200, text: '' })), http), recordingDelegates().delegates);

    const models = await adapter.listModels();
    expect(models.map((model) => [model.id, model.api])).toEqual([
      ['minimax-m3', 'messages'],
      ['glm-5.3', 'chat-completions'],
      ['grok-4.6', 'responses'],
      ['qwen3.8-flash', 'messages'],
    ]);
  });
});

const GO_CONFIG = providerConfig({ kind: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1' });

describe('x-opencode-session (requisito de OpenCode Go)', () => {
  it('buildOpenCodeHeaders siempre identifica al cliente y añade la sesión si la hay', () => {
    expect(buildOpenCodeHeaders('conv-123')).toEqual({
      [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT,
      [OPENCODE_SESSION_HEADER]: 'conv-123',
    });
    expect(buildOpenCodeHeaders('  ')).toEqual({ [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT });
    expect(buildOpenCodeHeaders(undefined)).toEqual({ [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT });
  });

  it('streamChat propaga la sesión al delegate como x-opencode-session', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'glm-5.3', sessionId: 'conv-42' })));

    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]?.request.extraHeaders).toEqual({
      [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT,
      [OPENCODE_SESSION_HEADER]: 'conv-42',
    });
    expect(recording.calls[0]?.request.sessionId).toBe('conv-42');
  });

  it('sin sessionId solo identifica al cliente', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'glm-5.3' })));

    expect(recording.calls[0]?.request.extraHeaders).toEqual({ [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT });
  });

  it('mezcla la sesión con cabeceras extra preexistentes', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'glm-5.3', sessionId: 'c1', extraHeaders: { 'X-Trace': 't' } })));

    expect(recording.calls[0]?.request.extraHeaders).toEqual({
      'X-Trace': 't',
      [OPENCODE_CLIENT_HEADER]: OPENCODE_CLIENT,
      [OPENCODE_SESSION_HEADER]: 'c1',
    });
  });
});

describe('caché de prompt de OpenCode', () => {
  it('en Go pide caché con retención de 24h', async () => {
    const { adapter, recording } = makeAdapter(undefined, GO_CONFIG);

    await collect(adapter.streamChat(chatRequest({ modelId: 'deepseek-v4-flash', sessionId: 's1' })));

    expect(recording.calls[0]?.request.cache?.cacheControl).toBe(true);
    expect(recording.calls[0]?.request.cache?.retention).toBe('24h');
  });

  it('omite los marcadores en GLM (el gateway los rechaza) pero conserva la clave', async () => {
    const { adapter, recording } = makeAdapter(undefined, GO_CONFIG);

    await collect(adapter.streamChat(chatRequest({ modelId: 'glm-5.3', sessionId: 's1' })));

    expect(recording.calls[0]?.request.cache?.cacheControl).toBe(false);
    expect(recording.calls[0]?.request.sessionId).toBe('s1');
  });

  it('en Zen no fuerza retención extendida', async () => {
    const { adapter, recording } = makeAdapter();

    await collect(adapter.streamChat(chatRequest({ modelId: 'claude-sonnet-4-6', sessionId: 's1' })));

    expect(recording.calls[0]?.request.cache?.cacheControl).toBe(true);
    expect(recording.calls[0]?.request.cache?.retention).toBeUndefined();
  });
});
