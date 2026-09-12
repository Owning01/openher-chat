import { describe, expect, it } from 'vitest';

import type { HttpClient, HttpRequest, HttpResponse } from '@/domain/ports/HttpClient';

import { probeProxy } from './proxyProbe';

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

describe('probeProxy', () => {
  it('rechaza URLs inválidas sin tocar la red', async () => {
    const http = new ScriptedHttp(async () => ({ status: 200, headers: {}, text: '' }));

    const result = await probeProxy(http, 'ftp://proxy.test');

    expect(result).toEqual({ ok: false, code: 'invalid_url' });
    expect(http.calls).toHaveLength(0);
  });

  it('considera conectado un /health 2xx', async () => {
    const http = new ScriptedHttp(async () => ({ status: 204, headers: {}, text: '' }));

    const result = await probeProxy(http, 'https://proxy.test/');

    expect(result).toEqual({ ok: true });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.url).toBe('https://proxy.test/health');
  });

  it('si /health falla prueba POST {base}/v1/search', async () => {
    const http = new ScriptedHttp(async (request) =>
      request.url.endsWith('/health')
        ? { status: 500, headers: {}, text: 'boom' }
        : { status: 200, headers: {}, text: '{"results":[]}' },
    );

    const result = await probeProxy(http, 'https://proxy.test');

    expect(result).toEqual({ ok: true });
    expect(http.calls).toHaveLength(2);
    expect(http.calls[1]?.method).toBe('POST');
    expect(http.calls[1]?.url).toBe('https://proxy.test/v1/search');
  });

  it('reporta el status cuando el endpoint de búsqueda responde no-2xx', async () => {
    const http = new ScriptedHttp(async (request) =>
      request.url.endsWith('/health')
        ? { status: 404, headers: {}, text: '' }
        : { status: 403, headers: {}, text: 'forbidden' },
    );

    const result = await probeProxy(http, 'https://proxy.test');

    expect(result).toEqual({ ok: false, code: 'http_error', status: 403 });
  });

  it('reporta error de red si nada responde', async () => {
    const http = new ScriptedHttp(async () => {
      throw new Error('sin red');
    });

    const result = await probeProxy(http, 'https://proxy.test');

    expect(result).toEqual({ ok: false, code: 'network' });
    expect(http.calls).toHaveLength(2);
  });
});
