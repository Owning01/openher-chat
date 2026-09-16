import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';
import type { ToolExecutionContext } from '@/domain/types/tools';

import { createXSearchTool, X_SEARCH_TOOL_NAME } from './index';

const CONTEXT: ToolExecutionContext = { signal: new AbortController().signal, conversationId: 'conv-test' };

class ScriptedHttp implements HttpClient {
  readonly calls: HttpRequest[] = [];
  private readonly handler: (request: HttpRequest) => Promise<HttpResponse>;

  constructor(handler: (request: HttpRequest) => Promise<HttpResponse>) {
    this.handler = handler;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.calls.push(request);
    return this.handler(request);
  }
}

const ok = (text: string): HttpResponse => ({ status: 200, headers: {}, text });

describe('x_search', () => {
  it('con user pide sus últimas publicaciones y normaliza @', async () => {
    const http = new ScriptedHttp(async () => ok('{"ok":true,"data":[]}'));
    const tool = createXSearchTool({ http, baseUrl: 'https://x-api.example.com/' });

    const result = await tool.execute({ user: '@OpenAI', count: 5 }, CONTEXT);

    expect(tool.name).toBe(X_SEARCH_TOOL_NAME);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('"ok":true');
    expect(http.calls[0]?.url).toBe('https://x-api.example.com/x/user-posts?user=OpenAI&count=5');
    expect(http.calls[0]?.method).toBe('GET');
  });

  it('sin user/query/feed devuelve invalid_args sin tocar la red', async () => {
    const http = new ScriptedHttp(async () => ok('{}'));
    const tool = createXSearchTool({ http, baseUrl: 'https://x-api.example.com' });

    const result = await tool.execute({}, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_args');
    expect(result.content).toContain('usuario de X');
    expect(http.calls).toHaveLength(0);
  });

  it('mapea HTTP no-2xx y error de red', async () => {
    const failing = new ScriptedHttp(async () => ({ status: 429, headers: {}, text: 'rate limited' }));
    const tool = createXSearchTool({ http: failing, baseUrl: 'https://x-api.example.com' });
    const throttled = await tool.execute({ user: 'x' }, CONTEXT);
    expect(throttled.ok).toBe(false);
    expect(throttled.error?.code).toBe('http_error');
    expect(throttled.content).toContain('HTTP 429');

    const down = new ScriptedHttp(async () => {
      throw new Error('sin red');
    });
    const toolDown = createXSearchTool({ http: down, baseUrl: 'https://x-api.example.com' });
    const offline = await toolDown.execute({ user: 'x' }, CONTEXT);
    expect(offline.ok).toBe(false);
    expect(offline.error?.code).toBe('network');
  });

  it('rechaza baseUrl inválida al construir', () => {
    const http = new ScriptedHttp(async () => ok('{}'));
    expect(() => createXSearchTool({ http, baseUrl: 'no-es-url' })).toThrow();
  });
});
