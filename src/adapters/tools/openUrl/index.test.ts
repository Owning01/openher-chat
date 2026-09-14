import { describe, expect, it } from 'vitest';
import { FetchHttpClient } from '@/adapters/http/FetchHttpClient';
import { fakeResponse } from '@/adapters/http/testUtils';
import { FIXED_NOW, fakeHttp, httpError, jsonResponse, textResponse, toolContext } from '../__fixtures__/fakes';
import type { FakeHttpClient, HttpResponder } from '../__fixtures__/fakes';
import { ARTICLE_HTML } from '../__fixtures__/searchData';
import { MAX_RESPONSE_BYTES, OPEN_URL_TIMEOUT_MS, openUrl, parseReaderText } from './index';

const NOW = (): number => FIXED_NOW;

function withRedirectControl(responder: HttpResponder, supports: boolean): FakeHttpClient {
  return { ...fakeHttp(responder), supportsRedirectControl: supports };
}

describe('openUrl — validación y fetch directo', () => {
  it('rechaza argumentos vacíos con invalid_args y sin tocar la red', async () => {
    const http = fakeHttp(() => textResponse(''));
    const result = await openUrl({ url: '   ' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_args');
    expect(http.requests).toHaveLength(0);
  });

  it('bloquea localhost y loopback con blocked_url sin llamar a la red', async () => {
    const http = fakeHttp(() => textResponse(''));
    for (const url of ['http://localhost:8080/', 'https://127.0.0.1/', 'http://[::1]/']) {
      const result = await openUrl({ url }, toolContext(), { http, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('blocked_url');
    }
    expect(http.requests).toHaveLength(0);
  });

  it('extrae el artículo, mide duración y adjunta sources', async () => {
    let clock = 100;
    const http = fakeHttp(() => {
      clock = 130;
      return textResponse(ARTICLE_HTML, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    });
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), { http, now: () => clock });
    expect(result.ok).toBe(true);
    expect(result.durationMs).toBe(30);
    expect(result.content).toContain('Title: OG Title');
    expect(result.content).toContain('URL: https://example.com/post');
    expect(result.content).toContain('Description: Short description');
    expect(result.content).toContain('Heading First paragraph & more.');
    expect(result.sources).toEqual([
      {
        url: 'https://example.com/post',
        title: 'OG Title',
        snippet: 'Short description',
        accessedAt: 130,
      },
    ]);
    const request = http.requests[0];
    expect(request?.method).toBe('GET');
    expect(request?.timeoutMs).toBe(OPEN_URL_TIMEOUT_MS);
    expect(request?.headers?.Accept).toContain('text/html');
    expect(request?.redirect).toBe('manual');
  });

  it('mapea status HTTP a http_error', async () => {
    const http = fakeHttp(() => textResponse('not found', 404));
    const result = await openUrl({ url: 'https://example.com/missing' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('http_error');
  });

  it('descarta respuestas mayores a 2 MB antes de parsear', async () => {
    const http = fakeHttp(() => textResponse('x'.repeat(MAX_RESPONSE_BYTES + 1), 200, { 'Content-Type': 'text/html' }));
    const result = await openUrl({ url: 'https://example.com/huge' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('parse_error');
    expect(result.error?.message).toMatch(/2 MB/);
  });

  it('descarta por content-length declarado aunque el texto sea corto', async () => {
    const http = fakeHttp(() =>
      textResponse('corto', 200, { 'Content-Type': 'text/html', 'Content-Length': String(MAX_RESPONSE_BYTES + 1) }),
    );
    const result = await openUrl({ url: 'https://example.com/huge' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('parse_error');
    expect(result.error?.message).toMatch(/2 MB/);
  });

  it('mide bytes UTF-8 reales: multibyte bajo el cap de code units falla igual', async () => {
    const text = '€'.repeat(Math.ceil((MAX_RESPONSE_BYTES + 1) / 3));
    expect(text.length).toBeLessThan(MAX_RESPONSE_BYTES);
    const http = fakeHttp(() =>
      textResponse(`<html><body><main>${text}</main></body></html>`, 200, { 'Content-Type': 'text/html' }),
    );
    const result = await openUrl({ url: 'https://example.com/utf8' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('parse_error');
    expect(result.error?.message).toMatch(/2 MB/);
  });

  it('rechaza content-types que no son texto/HTML', async () => {
    const http = fakeHttp(() => textResponse('%PDF-1.7', 200, { 'Content-Type': 'application/pdf' }));
    const result = await openUrl({ url: 'https://example.com/doc.pdf' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('parse_error');
  });

  it('mapea timeout', async () => {
    const http = fakeHttp(() => {
      throw httpError('timeout');
    });
    const result = await openUrl({ url: 'https://example.com/slow' }, toolContext(), { http, now: NOW });
    expect(result.error?.code).toBe('timeout');
  });

  it('mapea fallo de red en navegador a cors_blocked', async () => {
    const http = fakeHttp(() => {
      throw httpError('network', 'failed to fetch');
    });
    const result = await openUrl({ url: 'https://example.com/cors' }, toolContext(), { http, now: NOW });
    expect(result.error?.code).toBe('cors_blocked');
    expect(result.error?.message).toMatch(/proxy/i);
  });

  it('trunca el artículo a 8000 y avisa al modelo', async () => {
    const long = 'palabra '.repeat(1500);
    const http = fakeHttp(() => textResponse(`<html><body><article><p>${long}</p></article></body></html>`));
    const result = await openUrl({ url: 'https://example.com/long' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('[Content truncated to the extraction limit.]');
  });
});

describe('openUrl — política de redirects (SSRF)', () => {
  it('con FetchHttpClient real, el fetch recibe redirect manual y el 302 queda bloqueado', async () => {
    const calls: Array<{ redirect?: string }> = [];
    const http = new FetchHttpClient({
      fetchImpl: async (_url, init) => {
        calls.push(init);
        return fakeResponse({ status: 302, headers: [['location', 'http://127.0.0.1/admin']] });
      },
    });
    const result = await openUrl({ url: 'https://example.com/redirect' }, toolContext(), { http, now: NOW });
    expect(calls[0]?.redirect).toBe('manual');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('blocked_url');
    expect(result.error?.message).toMatch(/proxy/i);
  });

  it('un 302 directo no se sigue: blocked_url accionable y request manual', async () => {
    const http = fakeHttp(() =>
      textResponse('', 302, { Location: 'http://169.254.169.254/latest/meta-data' }),
    );
    const result = await openUrl({ url: 'https://example.com/redirect' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('blocked_url');
    expect(result.error?.message).toMatch(/redirect/i);
    expect(result.error?.message).toMatch(/proxy/i);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.redirect).toBe('manual');
  });

  it('una respuesta opaca (status 0) también se trata como redirect bloqueado', async () => {
    const http = fakeHttp(() => textResponse('', 0));
    const result = await openUrl({ url: 'https://example.com/opaque' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('blocked_url');
    expect(result.error?.message).toMatch(/proxy/i);
  });

  it('sin control de redirects y sin proxy → blocked_url sin tocar la red', async () => {
    const http = withRedirectControl(() => textResponse(ARTICLE_HTML), false);
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('blocked_url');
    expect(result.error?.message).toMatch(/proxy/i);
    expect(http.requests).toHaveLength(0);
  });

  it('sin control de redirects pero con proxy configurado usa /v1/fetch', async () => {
    const http = withRedirectControl((request) => {
      expect(request.url).toBe('https://proxy.example.com/v1/fetch');
      return jsonResponse({ title: 'Proxy Title', text: 'Proxy body', contentType: 'text/html', truncated: false });
    }, false);
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), {
      http,
      now: NOW,
      proxyBaseUrl: 'https://proxy.example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Proxy Title');
    expect(result.content).toContain('Proxy body');
  });
});

describe('openUrl — proxy', () => {
  it('hace POST /v1/fetch al proxy y usa su payload', async () => {
    const http = fakeHttp((request) => {
      expect(request.url).toBe('https://proxy.example.com/v1/fetch');
      expect(request.method).toBe('POST');
      expect(request.body).toEqual({ url: 'https://example.com/post' });
      return jsonResponse({ title: 'Proxy Title', text: 'Proxy body text', contentType: 'text/html', truncated: false });
    });
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), {
      http,
      now: NOW,
      proxyBaseUrl: 'https://proxy.example.com',
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Title: Proxy Title');
    expect(result.content).toContain('Proxy body text');
    expect(result.sources?.[0]?.title).toBe('Proxy Title');
  });

  it('propaga payload de proxy inválido como parse_error', async () => {
    const http = fakeHttp(() => jsonResponse({ title: 'sin texto' }));
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), {
      http,
      now: NOW,
      proxyBaseUrl: 'https://proxy.example.com',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('parse_error');
  });
});

describe('openUrl — fallback de lector (navegador sin CORS)', () => {
  it('si el fetch directo falla, reintenta con el lector y extrae el markdown', async () => {
    const http = fakeHttp((request) => {
      if (request.url.startsWith('https://r.jina.ai/')) {
        return textResponse(
          'Title: Reader Title\nURL Source: https://example.com/post\nPublished Time: 2026-01-01T00:00:00Z\n\nMarkdown Content:\n# Heading\n\nCuerpo del articulo.',
          200,
          { 'Content-Type': 'text/plain; charset=utf-8' },
        );
      }
      throw httpError('network', 'failed to fetch');
    });
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), {
      http,
      now: NOW,
      readerFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Title: Reader Title');
    expect(result.content).toContain('Cuerpo del articulo.');
    expect(result.sources?.[0]?.title).toBe('Reader Title');
    expect(http.requests[1]?.url).toBe('https://r.jina.ai/https://example.com/post');
    expect(http.requests[1]?.headers?.Accept).toBe('text/plain');
  });

  it('sin readerFallback conserva el error cors_blocked accionable', async () => {
    const http = fakeHttp(() => {
      throw httpError('network', 'failed to fetch');
    });
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), { http, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('cors_blocked');
  });

  it('con proxy configurado no consulta al lector', async () => {
    const http = fakeHttp((request) => {
      expect(request.url.startsWith('https://r.jina.ai/')).toBe(false);
      return jsonResponse({ title: 'Proxy Title', text: 'Proxy body', contentType: 'text/html', truncated: false });
    });
    const result = await openUrl({ url: 'https://example.com/post' }, toolContext(), {
      http,
      now: NOW,
      proxyBaseUrl: 'https://proxy.example.com',
      readerFallback: true,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Proxy body');
    expect(http.requests).toHaveLength(1);
  });

  it('parseReaderText cae al texto completo sin marcador de markdown', () => {
    const parsed = parseReaderText('solo texto', 'https://fallback.example');
    expect(parsed.title).toBe('https://fallback.example');
    expect(parsed.text).toBe('solo texto');
  });
});
