import { describe, expect, it, vi } from 'vitest';

import type { HttpClient, HttpResponse } from '@/domain/ports/HttpClient';

import { checkForUpdate } from './checkForUpdate';

function fakeHttp(handler: (url: string) => Promise<HttpResponse>): HttpClient {
  return {
    request: vi.fn(async (request) => handler(request.url)),
  };
}

function json(body: string, status = 200): HttpResponse {
  return { status, headers: {}, text: body };
}

const MANIFEST = { version: '2.0.0', apkUrl: 'https://example.com/app.apk' };

describe('checkForUpdate', () => {
  it('detecta una versión nueva', async () => {
    const http = fakeHttp(async () => json(JSON.stringify(MANIFEST)));
    await expect(checkForUpdate({ http, currentVersion: '1.0.0' })).resolves.toEqual({
      status: 'available',
      manifest: MANIFEST,
    });
  });

  it('marca al día cuando la versión es igual o menor', async () => {
    const http = fakeHttp(async () => json(JSON.stringify(MANIFEST)));
    await expect(checkForUpdate({ http, currentVersion: '2.0.0' })).resolves.toEqual({
      status: 'up-to-date',
      manifest: MANIFEST,
    });
    await expect(checkForUpdate({ http, currentVersion: '3.0.0' })).resolves.toMatchObject({
      status: 'up-to-date',
    });
  });

  it('usa la URL por defecto y la de override', async () => {
    const http = fakeHttp(async () => json(JSON.stringify(MANIFEST)));
    await checkForUpdate({ http, currentVersion: '1.0.0' });
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }));

    await checkForUpdate({ http, currentVersion: '1.0.0', manifestUrl: 'http://192.168.1.15:8123/version.json' });
    expect(http.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: 'http://192.168.1.15:8123/version.json' }),
    );
  });

  it('devuelve error sin lanzar', async () => {
    const notFound = fakeHttp(async () => json('nope', 404));
    await expect(checkForUpdate({ http: notFound, currentVersion: '1.0.0' })).resolves.toEqual({
      status: 'error',
      message: 'HTTP 404',
    });

    const brokenJson = fakeHttp(async () => json('{'));
    await expect(checkForUpdate({ http: brokenJson, currentVersion: '1.0.0' })).resolves.toEqual({
      status: 'error',
      message: 'invalid JSON',
    });

    const invalidManifest = fakeHttp(async () => json('{"version":"1"}'));
    await expect(checkForUpdate({ http: invalidManifest, currentVersion: '1.0.0' })).resolves.toEqual({
      status: 'error',
      message: 'invalid manifest',
    });

    const throwing = fakeHttp(async () => {
      throw new Error('offline');
    });
    await expect(checkForUpdate({ http: throwing, currentVersion: '1.0.0' })).resolves.toEqual({
      status: 'error',
      message: 'offline',
    });
  });
});
