import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapacitorHttpClient } from './CapacitorHttpClient';
import type { NativeHttpRequest, NativeHttpPlugin } from './CapacitorHttpClient';

describe('CapacitorHttpClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('en nativo declara que no controla redirects (CapacitorHttp los sigue internamente → open_url exige proxy)', () => {
    const client = new CapacitorHttpClient({ isNative: () => true, nativeHttp: { request: async () => ({ status: 200, data: '' }) } });
    expect(client.supportsRedirectControl).toBe(false);
  });

  it('en web delega en el fallback y declara control de redirects', async () => {
    const fallback = { request: vi.fn(async () => ({ status: 200, headers: {}, text: 'web' })) };
    const client = new CapacitorHttpClient({ isNative: () => false, fallback });
    expect(client.supportsRedirectControl).toBe(true);
    await expect(client.request({ url: 'https://api.test/models', method: 'GET' })).resolves.toEqual({
      status: 200,
      headers: {},
      text: 'web',
    });
    expect(fallback.request).toHaveBeenCalledTimes(1);
  });

  it('en web propaga redirect manual al fallback fetch', async () => {
    const fallback = { request: vi.fn(async () => ({ status: 200, headers: {}, text: 'ok' })) };
    const client = new CapacitorHttpClient({ isNative: () => false, fallback });
    await client.request({ url: 'https://page.test/article', method: 'GET', redirect: 'manual' });
    expect(fallback.request).toHaveBeenCalledWith({ url: 'https://page.test/article', method: 'GET', redirect: 'manual' });
  });

  it('en nativo normaliza {status, data, headers} y serializa el body', async () => {
    const native = {
      request: vi.fn(async (_options: NativeHttpRequest) => ({
        status: 429,
        data: { error: 'slow down' },
        headers: { 'retry-after': '1' },
      })),
    };
    const client = new CapacitorHttpClient({ isNative: () => true, nativeHttp: native });
    const response = await client.request({ url: 'https://api.test/chat', method: 'POST', body: { a: 1 } });
    expect(response).toEqual({ status: 429, headers: { 'retry-after': '1' }, text: '{"error":"slow down"}' });
    const options = native.request.mock.calls[0]?.[0];
    expect(options?.data).toBe('{"a":1}');
    expect(options?.responseType).toBe('text');
    expect(options?.headers['Content-Type']).toBe('application/json');
  });

  it('en nativo conserva data string y normaliza header ausente a {}', async () => {
    const native: NativeHttpPlugin = { request: async () => ({ status: 200, data: 'plain text' }) };
    const client = new CapacitorHttpClient({ isNative: () => true, nativeHttp: native });
    await expect(client.request({ url: 'https://api.test/chat', method: 'POST', body: 'x' })).resolves.toEqual({
      status: 200,
      headers: {},
      text: 'plain text',
    });
  });

  it('abort del caller rechaza con HttpError aborted', async () => {
    const native: NativeHttpPlugin = { request: () => new Promise<never>(() => undefined) };
    const client = new CapacitorHttpClient({ isNative: () => true, nativeHttp: native });
    const controller = new AbortController();
    const pending = client.request({ url: 'https://api.test/chat', method: 'POST', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('timeout manual en nativo → HttpError timeout', async () => {
    vi.useFakeTimers();
    const native: NativeHttpPlugin = { request: () => new Promise<never>(() => undefined) };
    const client = new CapacitorHttpClient({ isNative: () => true, nativeHttp: native });
    const pending = client.request({ url: 'https://api.test/chat', method: 'POST', timeoutMs: 25 });
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
  });

  it('error nativo → HttpError network', async () => {
    const native: NativeHttpPlugin = {
      request: async () => {
        throw new Error('native exploded');
      },
    };
    const client = new CapacitorHttpClient({ isNative: () => true, nativeHttp: native });
    await expect(client.request({ url: 'https://api.test/chat', method: 'POST' })).rejects.toMatchObject({
      kind: 'network',
      message: 'native exploded',
    });
  });
});
