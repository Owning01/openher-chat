import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';

import {
  DEFAULT_OPENCODE_SERVER_URL,
  OPENCODE_HEALTH_PATH,
  OPENCODE_PROVIDERS_PATH,
  fetchOpenCodeServerCatalog,
  mapProviders,
  normalizeServerBaseUrl,
  probeOpenCodeServer,
} from './opencodeServer';

interface FakeHttp extends HttpClient {
  readonly requests: HttpRequest[];
}

function fakeHttp(responder: (request: HttpRequest) => HttpResponse): FakeHttp {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      return responder(request);
    },
  };
}

function json(body: unknown, status = 200): HttpResponse {
  return { status, headers: {}, text: JSON.stringify(body) };
}

describe('normalizeServerBaseUrl', () => {
  it('acepta http(s) y quita slashes finales', () => {
    expect(normalizeServerBaseUrl('http://127.0.0.1:4096/')).toBe('http://127.0.0.1:4096');
    expect(normalizeServerBaseUrl('https://host/base/')).toBe('https://host/base');
  });

  it('rechaza vacío, esquemas no http y basura', () => {
    expect(normalizeServerBaseUrl('')).toBeNull();
    expect(normalizeServerBaseUrl('  ')).toBeNull();
    expect(normalizeServerBaseUrl('ftp://host')).toBeNull();
    expect(normalizeServerBaseUrl('not a url')).toBeNull();
  });
});

describe('probeOpenCodeServer', () => {
  it('consulta /global/health y normaliza healthy/version', async () => {
    const http = fakeHttp(() => json({ healthy: true, version: '1.2.3' }));
    await expect(probeOpenCodeServer(DEFAULT_OPENCODE_SERVER_URL, http)).resolves.toEqual({
      healthy: true,
      version: '1.2.3',
    });
    const [request] = http.requests;
    expect(request?.url).toBe(`${DEFAULT_OPENCODE_SERVER_URL}${OPENCODE_HEALTH_PATH}`);
    expect(request?.timeoutMs).toBe(5_000);
  });

  it('lanza con HTTP no 2xx', async () => {
    const http = fakeHttp(() => json({}, 500));
    await expect(probeOpenCodeServer(DEFAULT_OPENCODE_SERVER_URL, http)).rejects.toThrow(/HTTP 500/);
  });

  it('lanza con URL inválida sin tocar la red', async () => {
    const http = fakeHttp(() => json({ healthy: true }));
    await expect(probeOpenCodeServer('nope', http)).rejects.toThrow(/valid http/);
    expect(http.requests).toHaveLength(0);
  });

  it('tolera payload sin healthy ni version', async () => {
    const http = fakeHttp(() => json({}));
    await expect(probeOpenCodeServer(DEFAULT_OPENCODE_SERVER_URL, http)).resolves.toEqual({
      healthy: false,
      version: null,
    });
  });
});

describe('mapProviders', () => {
  it('mapea modelos como mapa de objetos y hereda baseUrl/kind de la plantilla', () => {
    const providers = mapProviders({
      providers: [
        {
          id: 'groq',
          name: 'Groq',
          models: { 'llama-3.1-8b': { name: 'Llama 3.1 8B', limit: { context: 131072 }, tool_call: true } },
        },
      ],
    });
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      id: 'groq',
      label: 'Groq',
      kind: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      requiresKey: true,
    });
    expect(providers[0]?.models).toEqual([
      { id: 'llama-3.1-8b', label: 'Llama 3.1 8B', contextWindow: 131072, supportsTools: true, source: 'api' },
    ]);
  });

  it('acepta modelos como array y el shape { all: [...] }', () => {
    const providers = mapProviders({
      all: [{ id: 'x', options: { baseURL: 'https://api.x.dev/v1' }, models: [{ id: 'm1' }] }],
    });
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ id: 'x', baseUrl: 'https://api.x.dev/v1', kind: 'openai-compatible' });
    expect(providers[0]?.models).toEqual([{ id: 'm1', label: 'm1', source: 'api' }]);
  });

  it('opencode-go usa la plantilla Go y enruta MiniMax a messages', () => {
    const providers = mapProviders({
      providers: [{ id: 'opencode-go', models: { 'minimax-m3': {}, 'glm-5.3': {} } }],
    });
    expect(providers[0]).toMatchObject({
      id: 'opencode-go',
      kind: 'opencode',
      baseUrl: 'https://opencode.ai/zen/go/v1',
    });
    expect(providers[0]?.models.map((model) => [model.id, model.api])).toEqual([
      ['minimax-m3', 'messages'],
      ['glm-5.3', 'chat-completions'],
    ]);
  });

  it('alias opencode -> plantilla Zen y ruteo por modelo', () => {
    const providers = mapProviders({
      providers: [
        {
          id: 'opencode',
          models: { 'claude-opus-4-8': {}, 'gpt-5.5': {}, 'deepseek-v4-pro': {} },
        },
      ],
    });
    expect(providers[0]).toMatchObject({
      id: 'opencode',
      kind: 'opencode',
      baseUrl: 'https://opencode.ai/zen/v1',
    });
    expect(providers[0]?.models.map((model) => [model.id, model.api])).toEqual([
      ['claude-opus-4-8', 'messages'],
      ['gpt-5.5', 'responses'],
      ['deepseek-v4-pro', 'chat-completions'],
    ]);
  });

  it('omite proveedores sin baseUrl ni plantilla conocida', () => {
    expect(mapProviders({ providers: [{ id: 'desconocido', models: {} }] })).toEqual([]);
  });

  it('deduplica ids y tolera payload no parseado', () => {
    expect(mapProviders(null)).toEqual([]);
    expect(mapProviders({ providers: [{ id: 'groq' }, { id: 'groq' }] })).toHaveLength(1);
  });
});

describe('fetchOpenCodeServerCatalog', () => {
  it('hace health + providers y devuelve el catálogo normalizado', async () => {
    const http = fakeHttp((request) => {
      if (request.url.endsWith(OPENCODE_HEALTH_PATH)) return json({ healthy: true, version: '9' });
      return json({ providers: [{ id: 'groq', models: { m1: {} } }] });
    });

    const catalog = await fetchOpenCodeServerCatalog('http://127.0.0.1:4096/', http);
    expect(catalog).toMatchObject({ baseUrl: 'http://127.0.0.1:4096', health: { healthy: true, version: '9' } });
    expect(catalog.providers[0]?.id).toBe('groq');
    expect(http.requests.map((request) => request.url)).toEqual([
      `http://127.0.0.1:4096${OPENCODE_HEALTH_PATH}`,
      `http://127.0.0.1:4096${OPENCODE_PROVIDERS_PATH}`,
    ]);
  });

  it('lanza si el servidor está unhealthy', async () => {
    const http = fakeHttp(() => json({ healthy: false }));
    await expect(fetchOpenCodeServerCatalog(DEFAULT_OPENCODE_SERVER_URL, http)).rejects.toThrow(/unhealthy/);
  });

  it('lanza si /config/providers falla', async () => {
    const http = fakeHttp((request) =>
      request.url.endsWith(OPENCODE_HEALTH_PATH) ? json({ healthy: true }) : json({}, 404),
    );
    await expect(fetchOpenCodeServerCatalog(DEFAULT_OPENCODE_SERVER_URL, http)).rejects.toThrow(/HTTP 404/);
  });
});

describe('mapProviders adversarial', () => {
  it('ignora providers/all que no son arrays', () => {
    expect(mapProviders({ providers: 'x', all: { id: 'y' } })).toEqual([]);
  });

  it('tolera models null o no array', () => {
    const providers = mapProviders({
      providers: [{ id: 'x', options: { baseURL: 'https://api.x.dev/v1' }, models: null }],
    });
    expect(providers[0]?.models).toEqual([]);
  });

  it('descarta entradas basura dentro de models en forma array', () => {
    const providers = mapProviders({
      providers: [
        {
          id: 'x',
          options: { baseURL: 'https://api.x.dev/v1' },
          models: [{ id: 'ok' }, null, 3, ['a'], { name: 'sin-id' }],
        },
      ],
    });
    expect(providers[0]?.models).toEqual([{ id: 'ok', label: 'ok', source: 'api' }]);
  });

  it('deduplica modelos por id preservando el primero', () => {
    const providers = mapProviders({
      providers: [{ id: 'x', options: { baseURL: 'https://api.x.dev/v1' }, models: [{ id: 'a' }, { id: 'a', name: 'B' }] }],
    });
    expect(providers[0]?.models).toEqual([{ id: 'a', label: 'a', source: 'api' }]);
  });

  it('conserva un modelo con id __proto__ sin romper', () => {
    const providers = mapProviders(
      JSON.parse('{"providers":[{"id":"x","options":{"baseURL":"https://api.x.dev/v1"},"models":{"__proto__":{"name":"proto"}}}]}'),
    );
    expect(providers[0]?.models).toEqual([{ id: '__proto__', label: 'proto', source: 'api' }]);
  });

  it('no envenena Object.prototype con ids __proto__ de proveedor y modelo', () => {
    mapProviders(
      JSON.parse('{"providers":[{"id":"__proto__","options":{"baseURL":"https://api.x.dev/v1"},"models":{"__proto__":{"name":"p"}}}]}'),
    );
    expect(({} as Record<string, unknown>).name).toBeUndefined();
  });

  it('conserva un proveedor con id __proto__ si trae baseUrl válida', () => {
    const providers = mapProviders(
      JSON.parse('{"providers":[{"id":"__proto__","options":{"baseURL":"https://api.x.dev/v1"},"models":{}}]}'),
    );
    expect(providers[0]?.id).toBe('__proto__');
  });

  it('cae a la baseUrl de la plantilla si options.baseURL es inválida', () => {
    const known = mapProviders({ providers: [{ id: 'groq', options: { baseURL: 'not-a-url' }, models: {} }] });
    expect(known[0]?.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('omite un proveedor desconocido con baseURL inválida', () => {
    expect(mapProviders({ providers: [{ id: 'desconocido', options: { baseURL: 'not-a-url' }, models: {} }] })).toEqual([]);
  });
});
