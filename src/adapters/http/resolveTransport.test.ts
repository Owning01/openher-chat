import { describe, expect, it, vi } from 'vitest';
import type { StreamResult } from '@/domain/ports/HttpClient';
import { createHttpError } from './FetchHttpClient';
import { createStreamTransport } from './resolveTransport';
import type { StreamPostRequest } from './fetchStream';
import { fakeResponse, readableFrom } from './testUtils';

const signal = new AbortController().signal;

function request(overrides: Partial<StreamPostRequest> = {}): StreamPostRequest {
  return {
    url: 'https://api.test/chat/completions',
    headers: { 'Content-Type': 'application/json' },
    body: { stream: true },
    signal,
    ...overrides,
  };
}

function unusedCapacitor() {
  return vi.fn(async () => ({ status: 200, headers: {}, text: '' }));
}

describe('createStreamTransport', () => {
  it('stream ok en nativo → sse sin tocar CapacitorHttp', async () => {
    const stream = readableFrom(['data: hola\n\n']);
    const capacitor = unusedCapacitor();
    const transport = createStreamTransport({
      isNative: () => true,
      postStreamImpl: async () => ({ mode: 'sse', stream }),
      capacitorHttpImpl: capacitor,
    });
    const result = await transport.post(request());
    expect(result).toEqual({ mode: 'sse', stream });
    expect(capacitor).not.toHaveBeenCalled();
  });

  it('fetch nativo falla antes del primer byte → reintenta buffered con CapacitorHttp', async () => {
    const capacitor = vi.fn(async (): Promise<{ status: number; headers: Record<string, string>; text: string }> => ({
      status: 200,
      headers: {},
      text: '{"choices":[]}',
    }));
    const transport = createStreamTransport({
      isNative: () => true,
      postStreamImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
      capacitorHttpImpl: capacitor,
    });
    const result = await transport.post(request());
    expect(result).toEqual({ mode: 'buffered', status: 200, text: '{"choices":[]}' });
    expect(capacitor).toHaveBeenCalledTimes(1);
  });

  it('status no 2xx buffered se devuelve tal cual sin reintentar en nativo', async () => {
    const capacitor = unusedCapacitor();
    const transport = createStreamTransport({
      isNative: () => true,
      postStreamImpl: async (): Promise<StreamResult> => ({ mode: 'buffered', status: 401, text: '{"error":"bad key"}' }),
      capacitorHttpImpl: capacitor,
    });
    const result = await transport.post(request());
    expect(result).toEqual({ mode: 'buffered', status: 401, text: '{"error":"bad key"}' });
    expect(capacitor).not.toHaveBeenCalled();
  });

  it('en web no reintenta y propaga el error original', async () => {
    const capacitor = unusedCapacitor();
    const transport = createStreamTransport({
      isNative: () => false,
      postStreamImpl: async () => {
        throw new TypeError('CORS blocked');
      },
      capacitorHttpImpl: capacitor,
    });
    await expect(transport.post(request())).rejects.toThrow('CORS blocked');
    expect(capacitor).not.toHaveBeenCalled();
  });

  it('abort no dispara el fallback nativo', async () => {
    const capacitor = unusedCapacitor();
    const controller = new AbortController();
    const transport = createStreamTransport({
      isNative: () => true,
      postStreamImpl: async () => {
        throw createHttpError('aborted', 'aborted');
      },
      capacitorHttpImpl: capacitor,
    });
    controller.abort();
    await expect(transport.post(request({ signal: controller.signal }))).rejects.toMatchObject({ kind: 'aborted' });
    expect(capacitor).not.toHaveBeenCalled();
  });

  it('si el fallback nativo también falla, propaga el error nativo', async () => {
    const transport = createStreamTransport({
      isNative: () => true,
      postStreamImpl: async () => {
        throw new TypeError('fetch down');
      },
      capacitorHttpImpl: async () => {
        throw createHttpError('network', 'native down');
      },
    });
    await expect(transport.post(request())).rejects.toThrow('native down');
  });

  it('integra postStream real: stream 2xx → sse y fallo de fetch → buffered', async () => {
    const stream = readableFrom(['data: x\n\n']);
    const viaStream = createStreamTransport({
      isNative: () => true,
      fetchImpl: async () => fakeResponse({ body: stream }),
      capacitorHttpImpl: unusedCapacitor(),
    });
    await expect(viaStream.post(request())).resolves.toEqual({ mode: 'sse', stream });

    const viaFallback = createStreamTransport({
      isNative: () => true,
      fetchImpl: async () => {
        throw new TypeError('CORS');
      },
      capacitorHttpImpl: async () => ({ status: 200, headers: {}, text: 'done' }),
    });
    await expect(viaFallback.post(request())).resolves.toEqual({ mode: 'buffered', status: 200, text: 'done' });
  });
});
