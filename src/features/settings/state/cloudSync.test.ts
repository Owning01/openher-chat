import { beforeEach, describe, expect, it } from 'vitest';

import type { CloudSyncPort } from '@/domain/ports/SyncPort';
import { buildSharePayload } from '@/domain/settings/share';
import type { SharePayload } from '@/domain/settings/share';
import type { ProviderConfig } from '@/domain/types/provider';
import { MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { startCloudAutoSync, synchronizeWithCloud } from './cloudSync';
import type { SettingsStore } from './settingsStore';
import { createSettingsStore } from './settingsStore';

const CLOCK_START = 1_000_000;

function providerConfig(): ProviderConfig {
  return {
    id: 'opencode-go',
    label: 'OpenCode Go',
    kind: 'opencode',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requiresKey: true,
    keyRef: 'provider:opencode-go',
    models: [{ id: 'muse-spark-1.3-contributor', label: 'Muse Spark', source: 'api' }],
    defaultModelId: 'muse-spark-1.3-contributor',
    createdAt: CLOCK_START,
    updatedAt: CLOCK_START,
  };
}

function remotePayload(exportedAt: number, thinking: 'low' | 'max' = 'low'): SharePayload {
  return buildSharePayload({
    providers: [providerConfig()],
    secrets: { 'provider:opencode-go': 'sk-nube' },
    settings: {
      activeProviderId: 'opencode-go',
      lastModelByProvider: { 'opencode-go': 'muse-spark-1.3-contributor' },
      chat: { systemPrompt: '', temperature: 0.5, maxOutputTokens: null, thinking },
      locale: 'es',
    },
    now: exportedAt,
  });
}

interface Harness {
  store: SettingsStore;
  pushes: SharePayload[];
  pullCount(): number;
  cloud: CloudSyncPort;
  setClock(value: number): void;
}

function createHarness(pull: SharePayload | null | Error = null): Harness {
  localStorage.clear();
  let clock = CLOCK_START;
  const store = createSettingsStore(
    {
      settings: new MemorySettingsRepository(),
      keys: new MemoryKeyVault(),
      createAdapter: async () => {
        throw new Error('sin adaptador en tests de sync');
      },
    },
    { now: () => clock },
  );
  const pushes: SharePayload[] = [];
  let pullCalls = 0;
  const cloud: CloudSyncPort = {
    async pull() {
      pullCalls += 1;
      if (pull instanceof Error) throw pull;
      return pull === null ? null : (JSON.parse(JSON.stringify(pull)) as SharePayload);
    },
    async push(payload) {
      pushes.push(JSON.parse(JSON.stringify(payload)) as SharePayload);
    },
  };
  return { store, pushes, pullCount: () => pullCalls, cloud, setClock: (value: number) => { clock = value; } };
}

/** Deja el store local con un proveedor, su key y thinking alto. */
async function seedLocal(store: SettingsStore): Promise<ProviderConfig> {
  await store.getState().load();
  const created = await store.getState().addProvider({
    type: 'manual',
    label: 'OpenCode Go',
    kind: 'opencode',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requiresKey: true,
  });
  if (created === null) throw new Error('no se pudo crear el proveedor');
  await store.getState().saveApiKey(created.keyRef ?? '', 'sk-local');
  await store.getState().patch({
    activeProviderId: created.id,
    lastModelByProvider: { [created.id]: 'muse-spark-1.3-contributor' },
    chat: { thinking: 'high' },
  });
  return created;
}

beforeEach(() => {
  localStorage.clear();
});

describe('synchronizeWithCloud', () => {
  it('disabled sin tocar la red cuando el toggle está apagado', async () => {
    const h = createHarness();
    await h.store.getState().load();
    await h.store.getState().patch({ ui: { cloudSync: false } });

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('disabled');
    expect(h.pullCount()).toBe(0);
    expect(h.pushes).toHaveLength(0);
  });

  it('error sin red cuando el store no cargó (no pisa la nube con defaults)', async () => {
    const h = createHarness();
    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('error');
    expect(h.pushes).toHaveLength(0);
  });

  it('nube vacía + local vacío → in-sync sin escribir', async () => {
    const h = createHarness();
    await h.store.getState().load();

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('in-sync');
    expect(h.pushes).toHaveLength(0);
  });

  it('nube vacía + local con datos → pushed con el secreto', async () => {
    const h = createHarness();
    await seedLocal(h.store);

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('pushed');
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]?.providers[0]?.secret).toBe('sk-local');
    expect(h.pushes[0]?.settings.chat.thinking).toBe('high');
  });

  it('local vacío + nube con datos → pulled y listo para chatear', async () => {
    const h = createHarness(remotePayload(50_000));
    await h.store.getState().load();

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('pulled');

    const state = h.store.getState();
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.label).toBe('OpenCode Go');
    expect(state.settings.activeProviderId).toBe('opencode-go');
    expect(state.settings.chat.thinking).toBe('low');
    expect(state.keyPresence['provider:opencode-go']).toBe(true);
  });

  it('mismo contenido → in-sync sin escribir', async () => {
    const h = createHarness();
    const created = await seedLocal(h.store);
    const local = await h.store.getState().exportShareConfig();
    void created;
    const h2 = createHarness(local);
    await h2.store.getState().load();
    // Replica el mismo contenido en el segundo store para simular otro arranque.
    await h2.store.getState().applyShareConfig(local);

    expect(await synchronizeWithCloud(h2.store, h2.cloud)).toBe('in-sync');
    expect(h2.pushes).toHaveLength(0);
  });

  it('last-write-wins: nube más nueva → pulled', async () => {
    const h = createHarness(remotePayload(CLOCK_START + 5_000, 'low'));
    await seedLocal(h.store); // thinking local 'high', updatedAt = CLOCK_START

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('pulled');
    expect(h.store.getState().settings.chat.thinking).toBe('low');
    expect(h.pushes).toHaveLength(0);
  });

  it('last-write-wins: local más nuevo → pushed', async () => {
    const h = createHarness(remotePayload(CLOCK_START - 5_000, 'low'));
    await seedLocal(h.store);
    h.setClock(CLOCK_START + 9_000);
    await h.store.getState().patch({ chat: { thinking: 'max' } });

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('pushed');
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]?.settings.chat.thinking).toBe('max');
  });

  it('fallo de red → error con el local intacto', async () => {
    const h = createHarness(new Error('offline'));
    await seedLocal(h.store);
    const before = await h.store.getState().exportShareConfig();

    expect(await synchronizeWithCloud(h.store, h.cloud)).toBe('error');
    const after = await h.store.getState().exportShareConfig();
    expect(after.providers).toHaveLength(before.providers.length);
    expect(after.settings.chat.thinking).toBe('high');
  });
});

describe('startCloudAutoSync', () => {
  it('aplica la nube al arrancar y sube los cambios con antirrebote, sin ping-pong', async () => {
    const h = createHarness(remotePayload(50_000));
    await h.store.getState().load();

    const handle = startCloudAutoSync(h.store, h.cloud, { debounceMs: 5 });
    try {
      await expect(handle.ready).resolves.toBe('pulled');
      expect(h.store.getState().providers).toHaveLength(1);

      // Cambio local → se sube una sola vez.
      await h.store.getState().patch({ chat: { thinking: 'max' } });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(h.pushes).toHaveLength(1);
      expect(h.pushes[0]?.settings.chat.thinking).toBe('max');

      // Sin cambios no hay más escrituras.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(h.pushes).toHaveLength(1);
    } finally {
      handle.stop();
    }
  });

  it('stop() detiene las subidas programadas', async () => {
    const h = createHarness();
    await h.store.getState().load();
    const handle = startCloudAutoSync(h.store, h.cloud, { debounceMs: 5 });
    await handle.ready;
    handle.stop();

    await h.store.getState().patch({ chat: { thinking: 'max' } });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.pushes).toHaveLength(0);
  });
});
