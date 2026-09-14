import { describe, expect, it } from 'vitest';

import { createChatHarness, createProviderConfig } from './__fixtures__/chatTestHarness';
import { resolveModelTarget } from './chatStore';

const PROVIDERS = [
  createProviderConfig({
    id: 'groq',
    label: 'Groq',
    defaultModelId: 'llama-3.3-70b',
    models: [
      { id: 'llama-3.3-70b', label: 'Llama 3.3 70B', source: 'manual' },
      { id: 'mixtral', label: 'Mixtral', source: 'manual' },
    ],
  }),
  createProviderConfig({
    id: 'local',
    label: 'Local',
    defaultModelId: null,
    models: [],
  }),
];

const SETTINGS = { activeProviderId: 'groq', lastModelByProvider: { groq: 'mixtral' } };

describe('resolveModelTarget', () => {
  it('prioriza el target de la conversación', () => {
    expect(resolveModelTarget({ providerId: 'groq', modelId: 'llama-3.3-70b' }, SETTINGS, PROVIDERS)).toEqual({
      providerId: 'groq',
      modelId: 'llama-3.3-70b',
    });
  });

  it('cae al proveedor activo y al último modelo usado', () => {
    expect(resolveModelTarget(null, SETTINGS, PROVIDERS)).toEqual({ providerId: 'groq', modelId: 'mixtral' });
  });

  it('usa el default del proveedor y luego su primer modelo', () => {
    expect(resolveModelTarget(null, { activeProviderId: 'groq', lastModelByProvider: {} }, PROVIDERS)).toEqual({
      providerId: 'groq',
      modelId: 'llama-3.3-70b',
    });

    const withoutDefault = [
      createProviderConfig({
        id: 'groq',
        defaultModelId: null,
        models: [{ id: 'first', label: 'First', source: 'manual' }],
      }),
    ];
    expect(resolveModelTarget(null, { activeProviderId: 'groq', lastModelByProvider: {} }, withoutDefault)).toEqual({
      providerId: 'groq',
      modelId: 'first',
    });
  });

  it('ignora un proveedor de la conversación que ya no existe y usa el activo', () => {
    expect(resolveModelTarget({ providerId: 'borrado', modelId: 'x' }, SETTINGS, PROVIDERS)).toEqual({
      providerId: 'groq',
      modelId: 'mixtral',
    });
  });

  it('devuelve null sin proveedores o sin modelos', () => {
    expect(resolveModelTarget(null, SETTINGS, [])).toBeNull();
    expect(resolveModelTarget(null, { activeProviderId: 'local', lastModelByProvider: {} }, PROVIDERS)).toBeNull();
  });
});

describe('chatStore - setModel', () => {
  it('persiste el modelo en la conversación y en settings.lastModelByProvider', async () => {
    const h = createChatHarness();
    const conversation = await h.repo.create({ title: '' });
    await h.store.getState().load(conversation.id);

    await h.store.getState().setModel('provider-1', 'model-1');

    expect((await h.repo.get(conversation.id))?.modelId).toBe('model-1');
    expect((await h.repo.get(conversation.id))?.providerId).toBe('provider-1');
    expect((await h.settings.load()).lastModelByProvider['provider-1']).toBe('model-1');
  });

  it('sin conversación activa marca el proveedor activo para el chat nuevo', async () => {
    const h = createChatHarness();

    await h.store.getState().setModel('provider-2', 'model-9');

    const settings = await h.settings.load();
    expect(settings.activeProviderId).toBe('provider-2');
    expect(settings.lastModelByProvider['provider-2']).toBe('model-9');
  });
});
