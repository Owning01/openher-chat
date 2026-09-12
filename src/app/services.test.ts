import { describe, expect, it } from 'vitest';

import { CapacitorHttpClient } from '@/adapters/http/CapacitorHttpClient';
import type { HttpClient, HttpRequest, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderConfig } from '@/domain/types/provider';
import { MemoryKeyVault } from '@/test/fakes/MemoryRepos';

import { createServices } from './services';

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    label: 'Proveedor de prueba',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    requiresKey: true,
    keyRef: 'provider:p1',
    models: [],
    defaultModelId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createHarness() {
  const keys = new MemoryKeyVault();
  const requests: HttpRequest[] = [];
  const http: HttpClient = {
    async request(request) {
      requests.push(request);
      return { status: 200, headers: {}, text: '{"data":[]}' };
    },
  };
  const transport: StreamTransport = {
    async post() {
      return { mode: 'buffered', status: 200, text: '{}' };
    },
  };

  return { services: createServices({ keys, http, transport }), keys, requests, http };
}

describe('createServices', () => {
  it('usa CapacitorHttpClient por defecto (fallback web) y respeta el http inyectado', () => {
    expect(createServices().http).toBeInstanceOf(CapacitorHttpClient);

    const { services, http } = createHarness();
    expect(services.http).toBe(http);
  });

  it('createAdapter resuelve la API key desde el KeyVault y la usa en el adapter', async () => {
    const { services, keys, requests } = createHarness();
    await keys.set('provider:p1', 'sk-secreta');

    const adapter = await services.createAdapter(makeConfig());

    expect(adapter.providerId).toBe('p1');
    expect(adapter.kind).toBe('openai-compatible');
    await adapter.listModels();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers?.Authorization).toBe('Bearer sk-secreta');
  });

  it('sin keyRef no envía Authorization', async () => {
    const { services, requests } = createHarness();

    const adapter = await services.createAdapter(makeConfig({ requiresKey: false, keyRef: null }));
    await adapter.listModels();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers?.Authorization).toBeUndefined();
  });
});
