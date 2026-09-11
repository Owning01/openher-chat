import { describe, expect, it } from 'vitest';
import type { FetchInit } from './FetchHttpClient';
import { postStream } from './fetchStream';
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

describe('postStream', () => {
  it('2xx con body → mode sse con el stream original', async () => {
    const body = readableFrom(['data: hola\n\n']);
    const result = await postStream(request(), async () => fakeResponse({ body }));
    expect(result).toEqual({ mode: 'sse', stream: body });
  });

  it('status no 2xx → buffered con status y texto, sin lanzar', async () => {
    const result = await postStream(request(), async () => fakeResponse({ status: 429, text: '{"error":"slow down"}' }));
    expect(result).toEqual({ mode: 'buffered', status: 429, text: '{"error":"slow down"}' });
  });

  it('2xx sin body → buffered con el texto completo', async () => {
    const result = await postStream(request(), async () => fakeResponse({ status: 204, text: '' }));
    expect(result).toEqual({ mode: 'buffered', status: 204, text: '' });
  });

  it('envía method POST, headers y body serializado', async () => {
    const calls: FetchInit[] = [];
    await postStream(request(), async (_url, init) => {
      calls.push(init);
      return fakeResponse({ body: readableFrom(['']) });
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['Content-Type']).toBe('application/json');
    expect(calls[0]?.body).toBe('{"stream":true}');
  });

  it('fallo de red → HttpError network', async () => {
    await expect(
      postStream(request(), async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toMatchObject({ kind: 'network', message: 'Failed to fetch' });
  });

  it('abort del caller → HttpError aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      postStream(request({ signal: controller.signal }), async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
