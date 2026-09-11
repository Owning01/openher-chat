import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchHttpClient } from './FetchHttpClient';
import type { FetchLike } from './FetchHttpClient';
import { fakeResponse } from './testUtils';

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function hangingFetch(): FetchLike {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
}

describe('FetchHttpClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve HttpResponse aunque el status sea de error (no lanza)', async () => {
    const client = new FetchHttpClient({
      fetchImpl: async () =>
        fakeResponse({ status: 401, headers: [['content-type', 'application/json']], text: '{"error":"bad key"}' }),
    });
    const response = await client.request({ url: 'https://api.test/models', method: 'GET' });
    expect(response).toEqual({ status: 401, headers: { 'content-type': 'application/json' }, text: '{"error":"bad key"}' });
  });

  it('serializa body de objeto, agrega Content-Type y respeta method', async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const client = new FetchHttpClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return fakeResponse({ text: '{"ok":true}' });
      },
    });
    await client.request({ url: 'https://api.test/chat', method: 'POST', body: { model: 'm' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.test/chat');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"model":"m"}');
    expect(calls[0]?.init.headers['Content-Type']).toBe('application/json');
  });

  it('no pisa un Content-Type provisto por el caller', async () => {
    const calls: Array<Parameters<FetchLike>[1]> = [];
    const client = new FetchHttpClient({
      fetchImpl: async (_url, init) => {
        calls.push(init);
        return fakeResponse();
      },
    });
    await client.request({
      url: 'https://api.test/chat',
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-extra': '1' },
      body: 'hola',
    });
    expect(calls[0]?.headers['content-type']).toBe('text/plain');
    expect(calls[0]?.headers['Content-Type']).toBeUndefined();
    expect(calls[0]?.headers['x-extra']).toBe('1');
    expect(calls[0]?.body).toBe('hola');
  });

  it('signal del caller disparado a mitad → HttpError aborted', async () => {
    const client = new FetchHttpClient({ fetchImpl: hangingFetch() });
    const controller = new AbortController();
    const pending = client.request({ url: 'https://api.test/chat', method: 'POST', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('signal ya abortado falla de inmediato sin llamar a fetch', async () => {
    let called = false;
    const client = new FetchHttpClient({
      fetchImpl: async () => {
        called = true;
        return fakeResponse();
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.request({ url: 'https://api.test/chat', method: 'GET', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(called).toBe(false);
  });

  it('timeout manual → HttpError timeout', async () => {
    vi.useFakeTimers();
    const client = new FetchHttpClient({ fetchImpl: hangingFetch() });
    const pending = client.request({ url: 'https://api.test/chat', method: 'POST', timeoutMs: 50 });
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it('error de red → HttpError network', async () => {
    const client = new FetchHttpClient({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(client.request({ url: 'https://api.test/chat', method: 'GET' })).rejects.toMatchObject({
      kind: 'network',
      message: 'Failed to fetch',
    });
  });
});
