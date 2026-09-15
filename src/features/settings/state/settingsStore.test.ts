import { beforeEach, describe, expect, it } from 'vitest';

import type { KeyVault } from '@/domain/ports/KeyVault';
import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { LegalSettings } from '@/domain/types/legal';
import type { ModelInfo, ProviderConfig } from '@/domain/types/provider';
import { MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { LocalProviderConfigRepository, PROVIDERS_STORAGE_KEY } from './providerStorage';
import type { ProviderConfigRepository } from './providerStorage';
import { SEARCH_KEY_REFS, createSettingsStore } from './settingsStore';
import type { ImportedProvider } from './settingsStore';

const NOW = 1_700_000_000_000;

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    label: 'Proveedor',
    kind: 'openai-compatible',
    baseUrl: 'https://api.test/v1',
    requiresKey: true,
    keyRef: 'provider:p1',
    models: [],
    defaultModelId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fakeAdapter(config: ProviderConfig, models: ModelInfo[]): ProviderAdapter {
  return {
    providerId: config.id,
    kind: config.kind,
    capabilities: () => ({ streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: false }),
    async listModels() {
      return models.map((model) => ({ ...model }));
    },
    async *streamChat() {},
  };
}

interface HarnessOptions {
  settings?: MemorySettingsRepository;
  providers?: ProviderConfigRepository;
  keys?: KeyVault;
  adapterModels?: ModelInfo[];
  createAdapter?: (config: ProviderConfig) => Promise<ProviderAdapter>;
}

function createHarness(options: HarnessOptions = {}) {
  localStorage.clear();
  let clock = NOW;
  let sequence = 0;
  const repo = options.settings ?? new MemorySettingsRepository({ now: () => clock });
  const keys = options.keys ?? new MemoryKeyVault();
  const providerRepo = options.providers ?? new LocalProviderConfigRepository(() => clock);
  const adapterConfigs: ProviderConfig[] = [];
  const models = options.adapterModels ?? [{ id: 'm1', label: 'Modelo 1', source: 'api' as const }];
  const store = createSettingsStore(
    {
      settings: repo,
      keys,
      createAdapter:
        options.createAdapter ??
        (async (config) => {
          adapterConfigs.push(config);
          return fakeAdapter(config, models);
        }),
    },
    { providers: providerRepo, now: () => clock, newId: () => `p${++sequence}` },
  );
  return {
    store,
    repo,
    keys,
    providerRepo,
    adapterConfigs,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

class FailingSettingsRepository extends MemorySettingsRepository {
  override async save(): Promise<void> {
    throw new Error('cuota agotada');
  }
}

class FailingProviderRepository extends LocalProviderConfigRepository {
  override async save(): Promise<void> {
    throw new Error('sin espacio');
  }
}

function imported(
  id: string,
  baseUrl: string,
  kind: ImportedProvider['kind'] = 'openai-compatible',
): ImportedProvider {
  return { id, label: id, kind, baseUrl, requiresKey: true, models: [] };
}

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load hidrata settings, proveedores y presencia de keys', async () => {
    const { store, repo, keys, providerRepo } = createHarness();
    await keys.set('provider:p1', 'sk-1');
    await providerRepo.save([makeProvider()]);
    await repo.save({ ...createDefaultSettings(1000), locale: 'en' });

    await store.getState().load();

    const state = store.getState();
    expect(state.ready).toBe(true);
    expect(state.status).toBe('ready');
    expect(state.settings.locale).toBe('en');
    expect(state.providers).toHaveLength(1);
    expect(state.keyPresence['provider:p1']).toBe(true);
    expect(state.keyPresence[SEARCH_KEY_REFS.brave]).toBe(false);
    expect(state.keyPresence[SEARCH_KEY_REFS.tavily]).toBe(false);
    expect(state.error).toBeNull();
  });

  it('agrega un proveedor manual, lo persiste y lo activa', async () => {
    const { store, providerRepo } = createHarness();
    await store.getState().load();

    const created = await store.getState().addProvider({
      type: 'manual',
      label: '  Local  ',
      kind: 'openai-compatible',
      baseUrl: 'https://api.local/v1/',
      requiresKey: true,
    });

    expect(created).not.toBeNull();
    if (created === null) return;
    expect(created.id).toBe('p1');
    expect(created.label).toBe('Local');
    expect(created.baseUrl).toBe('https://api.local/v1');
    expect(created.keyRef).toBe('provider:p1');
    expect(created.createdAt).toBe(NOW);

    const state = store.getState();
    expect(state.settings.activeProviderId).toBe('p1');
    expect(state.keyPresence['provider:p1']).toBe(false);
    expect(await providerRepo.load()).toEqual(state.providers);
  });

  it('rechaza proveedores con label vacío o URL no http(s)', async () => {
    const { store } = createHarness();
    await store.getState().load();

    const created = await store.getState().addProvider({
      type: 'manual',
      label: ' ',
      kind: 'openai-compatible',
      baseUrl: 'ftp://api.local',
      requiresKey: true,
    });

    expect(created).toBeNull();
    expect(store.getState().providers).toHaveLength(0);
    expect(store.getState().error).not.toBeNull();
  });

  it('deduplica un proveedor con el mismo kind y baseUrl (reload mid-wizard)', async () => {
    const { store, providerRepo } = createHarness();
    await store.getState().load();

    const first = await store.getState().addProvider({ type: 'template', templateId: 'groq' });
    const second = await store.getState().addProvider({ type: 'template', templateId: 'groq' });

    expect(first?.id).toBe('groq');
    expect(second).toEqual(first);
    expect(store.getState().providers).toHaveLength(1);
    expect(await providerRepo.load()).toHaveLength(1);
    expect(store.getState().error).toBeNull();
  });

  it('deduplica por host case-insensitive y slash final sin alterar el path', async () => {
    const { store } = createHarness();
    await store.getState().load();

    const first = await store.getState().addProvider({
      type: 'manual',
      label: 'Groq',
      kind: 'openai-compatible',
      baseUrl: 'https://api.groq.com/openai/v1',
      requiresKey: true,
    });
    const second = await store.getState().addProvider({
      type: 'manual',
      label: 'Groq duplicado',
      kind: 'openai-compatible',
      baseUrl: 'https://API.GROQ.COM/openai/v1/',
      requiresKey: true,
    });

    expect(first?.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(second).toEqual(first);
    expect(store.getState().providers).toHaveLength(1);
    expect(store.getState().error).toBeNull();
  });

  it('crea proveedores desde plantilla y evita ids duplicados si la baseUrl cambió', async () => {
    const { store } = createHarness();
    await store.getState().load();

    const first = await store.getState().addProvider({ type: 'template', templateId: 'groq' });

    expect(first?.id).toBe('groq');
    expect(first?.label).toBe('Groq');
    expect(first?.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(first?.quirks).toEqual({ includeUsage: true, sendToolChoice: true });
    if (first === null) return;

    await store.getState().updateProvider(first.id, { baseUrl: 'https://proxy.local/groq' });
    const second = await store.getState().addProvider({ type: 'template', templateId: 'groq' });
    expect(second?.id).toBe('groq-2');
    expect(second?.keyRef).toBe('provider:groq-2');
  });

  it('falla con una plantilla desconocida', async () => {
    const { store } = createHarness();
    await store.getState().load();

    const created = await store.getState().addProvider({ type: 'template', templateId: 'inexistente' });

    expect(created).toBeNull();
    expect(store.getState().error).not.toBeNull();
  });

  it('actualiza un proveedor y persiste; rechaza patches inválidos', async () => {
    const { store, providerRepo } = createHarness();
    await store.getState().load();
    const created = await store.getState().addProvider({
      type: 'manual',
      label: 'Original',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: true,
    });
    if (created === null) return;

    const updated = await store.getState().updateProvider(created.id, {
      label: 'Renombrado',
      baseUrl: 'https://api2.test/v1',
    });

    expect(updated).toBe(true);
    expect(store.getState().providers[0]?.label).toBe('Renombrado');
    expect((await providerRepo.load())[0]?.baseUrl).toBe('https://api2.test/v1');

    const invalid = await store.getState().updateProvider(created.id, { baseUrl: 'ftp://nope' });
    expect(invalid).toBe(false);
    expect(store.getState().providers[0]?.baseUrl).toBe('https://api2.test/v1');
  });

  it('elimina un proveedor, reasigna el activo y limpia su key', async () => {
    const { store, keys, repo } = createHarness();
    await store.getState().load();
    const first = await store.getState().addProvider({
      type: 'manual',
      label: 'Primero',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: true,
    });
    const second = await store.getState().addProvider({
      type: 'manual',
      label: 'Segundo',
      kind: 'openai-compatible',
      baseUrl: 'https://api2.test/v1',
      requiresKey: true,
    });
    if (first === null || second === null) return;

    await store.getState().saveApiKey('provider:p1', 'sk-secreta');
    await store.getState().removeProvider(first.id);

    const state = store.getState();
    expect(state.providers.map((provider) => provider.id)).toEqual([second.id]);
    expect(state.settings.activeProviderId).toBe(second.id);
    expect(state.keyPresence['provider:p1']).toBeUndefined();
    expect(await keys.get('provider:p1')).toBeNull();
    expect((await repo.load()).activeProviderId).toBe(second.id);
  });

  it('saveApiKey escribe solo el KeyVault y nunca la config serializada', async () => {
    const { store, keys, repo } = createHarness();
    await store.getState().load();
    await store.getState().addProvider({
      type: 'manual',
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: true,
    });

    expect(await store.getState().saveApiKey('provider:p1', 'sk-secreta')).toBe(true);

    expect(await keys.get('provider:p1')).toBe('sk-secreta');
    expect(store.getState().keyPresence['provider:p1']).toBe(true);
    expect(JSON.stringify(await repo.load())).not.toContain('sk-secreta');
    expect(localStorage.getItem(PROVIDERS_STORAGE_KEY) ?? '').not.toContain('sk-secreta');

    expect(await store.getState().saveApiKey('provider:p1', '')).toBe(true);
    expect(await keys.get('provider:p1')).toBeNull();
    expect(store.getState().keyPresence['provider:p1']).toBe(false);
  });

  it('saveApiKey reporta el fracaso del KeyVault sin marcar presencia', async () => {
    const failingKeys: KeyVault = {
      has: async () => false,
      get: async () => null,
      set: async () => {
        throw new Error('vault lleno');
      },
      remove: async () => undefined,
    };
    const { store } = createHarness({ keys: failingKeys });
    await store.getState().load();

    const saved = await store.getState().saveApiKey(SEARCH_KEY_REFS.brave, 'sk-brave');

    expect(saved).toBe(false);
    expect(store.getState().error).toBe('vault lleno');
    expect(store.getState().keyPresence[SEARCH_KEY_REFS.brave]).toBe(false);
  });

  it('refreshModels fusiona el catálogo de la API con los manuales y conserva overrides', async () => {
    const { store, adapterConfigs } = createHarness({
      adapterModels: [
        { id: 'm1', label: 'Modelo API', source: 'api' },
        { id: 'm3', label: 'Modelo nuevo', source: 'api' },
      ],
    });
    await store.getState().load();
    const created = await store.getState().addProvider({
      type: 'manual',
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: true,
    });
    if (created === null) return;
    await store.getState().updateProvider(created.id, {
      models: [
        { id: 'm1', label: 'Override', source: 'manual', contextWindow: 4096, supportsTools: true },
        { id: 'm2', label: 'Manual', source: 'manual' },
      ],
      defaultModelId: 'm2',
    });

    const models = await store.getState().refreshModels(created.id);

    expect(models).not.toBeNull();
    expect(adapterConfigs).toHaveLength(1);
    const provider = store.getState().providers[0];
    expect(provider?.models).toEqual([
      { id: 'm1', label: 'Modelo API', source: 'api', contextWindow: 4096, supportsTools: true },
      { id: 'm3', label: 'Modelo nuevo', source: 'api' },
      { id: 'm2', label: 'Manual', source: 'manual' },
    ]);
    expect(provider?.defaultModelId).toBe('m2');
    expect(store.getState().refreshingProviderId).toBeNull();
  });

  it('refreshModels reporta el error del adapter sin tocar el catálogo', async () => {
    const { store } = createHarness({
      createAdapter: async () => {
        throw new Error('sin red');
      },
    });
    await store.getState().load();
    const created = await store.getState().addProvider({
      type: 'manual',
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: true,
    });
    if (created === null) return;

    const models = await store.getState().refreshModels(created.id);

    expect(models).toBeNull();
    expect(store.getState().error).toBe('sin red');
    expect(store.getState().providers[0]?.models).toEqual([]);
    expect(store.getState().refreshingProviderId).toBeNull();
  });

  it('patch persiste y aplica los clamps de migrateSettings', async () => {
    const { store, repo } = createHarness();
    await store.getState().load();

    await store.getState().patch({
      chat: { temperature: 5 },
      search: { maxResults: 99 },
      agent: { maxSteps: 0 },
      history: { keepLastTurns: 999 },
    });

    const settings = store.getState().settings;
    expect(settings.chat.temperature).toBe(2);
    expect(settings.search.maxResults).toBe(10);
    expect(settings.agent.maxSteps).toBe(1);
    expect(settings.history.keepLastTurns).toBe(50);
    expect((await repo.load()).chat.temperature).toBe(2);
  });

  it('patch con NaN o Infinity conserva el valor previo', async () => {
    const { store, repo } = createHarness();
    await store.getState().load();
    await store.getState().patch({ chat: { temperature: 1.5 }, agent: { maxTotalTokens: 30_000 }, search: { maxResults: 7 } });

    await store.getState().patch({
      chat: { temperature: Number.NaN },
      agent: { maxTotalTokens: Number.POSITIVE_INFINITY },
      search: { maxResults: Number.NEGATIVE_INFINITY },
    });

    const settings = store.getState().settings;
    expect(settings.chat.temperature).toBe(1.5);
    expect(settings.agent.maxTotalTokens).toBe(30_000);
    expect(settings.search.maxResults).toBe(7);
    const persisted = await repo.load();
    expect(persisted.chat.temperature).toBe(1.5);
    expect(persisted.agent.maxTotalTokens).toBe(30_000);
    expect(persisted.search.maxResults).toBe(7);
  });

  it('patch revierte si la persistencia falla', async () => {
    const repo = new FailingSettingsRepository({ now: () => NOW });
    const { store } = createHarness({ settings: repo });
    await store.getState().load();
    const before = store.getState().settings.chat.temperature;

    await store.getState().patch({ chat: { temperature: 1.5 } });

    expect(store.getState().error).toBe('cuota agotada');
    expect(store.getState().settings.chat.temperature).toBe(before);
  });

  it('addProvider revierte si falla la persistencia del catálogo', async () => {
    const { store } = createHarness({ providers: new FailingProviderRepository(() => NOW) });
    await store.getState().load();

    const created = await store.getState().addProvider({
      type: 'manual',
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: true,
    });

    expect(created).toBeNull();
    expect(store.getState().providers).toHaveLength(0);
    expect(store.getState().settings.activeProviderId).toBeNull();
    expect(store.getState().error).toBe('sin espacio');
  });

  it('setActiveProvider solo acepta ids existentes y persiste', async () => {
    const { store, repo } = createHarness();
    await store.getState().load();
    const first = await store.getState().addProvider({
      type: 'manual',
      label: 'Primero',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: false,
    });
    const second = await store.getState().addProvider({
      type: 'manual',
      label: 'Segundo',
      kind: 'openai-compatible',
      baseUrl: 'https://api2.test/v1',
      requiresKey: false,
    });
    if (first === null || second === null) return;

    await store.getState().setActiveProvider(second.id);
    expect(store.getState().settings.activeProviderId).toBe(second.id);
    expect((await repo.load()).activeProviderId).toBe(second.id);

    await store.getState().setActiveProvider('inexistente');
    expect(store.getState().settings.activeProviderId).toBe(second.id);
  });

  it('setModelForProvider fija el default del proveedor y lastModelByProvider', async () => {
    const { store, repo, providerRepo } = createHarness();
    await store.getState().load();
    const created = await store.getState().addProvider({
      type: 'manual',
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: false,
    });
    if (created === null) return;
    await store.getState().updateProvider(created.id, {
      models: [
        { id: 'm1', label: 'M1', source: 'manual' },
        { id: 'm2', label: 'M2', source: 'manual' },
      ],
      defaultModelId: 'm1',
    });

    await store.getState().setModelForProvider(created.id, 'm2');

    expect(store.getState().providers[0]?.defaultModelId).toBe('m2');
    expect(store.getState().settings.lastModelByProvider[created.id]).toBe('m2');
    expect((await providerRepo.load())[0]?.defaultModelId).toBe('m2');
    expect((await repo.load()).lastModelByProvider[created.id]).toBe('m2');

    await store.getState().setModelForProvider(created.id, 'inexistente');
    expect(store.getState().providers[0]?.defaultModelId).toBe('m2');
  });

  it('expone helpers de selección de settings', async () => {
    const { store } = createHarness();
    await store.getState().load();

    expect(store.getState().chatDefaults().temperature).toBe(0.7);
    expect(store.getState().agentBudget().maxSteps).toBe(6);
    expect(store.getState().historyBudget().keepLastTurns).toBe(6);
    expect(store.getState().search().maxResults).toBe(5);
    expect(store.getState().proxy()).toEqual({ mode: 'direct', baseUrl: null });
    expect(store.getState().appearance()).toEqual({ theme: 'system', locale: 'es' });
  });

  it('importProviders con catálogo vacío no toca storage ni falla', async () => {
    const { store } = createHarness({ providers: new FailingProviderRepository(() => NOW) });
    await store.getState().load();

    const result = await store.getState().importProviders([]);

    expect(result).toEqual({ added: 0, skipped: 0 });
  });

  it('importProviders deduplica por kind+baseUrl dentro del mismo catálogo', async () => {
    const { store } = createHarness();
    await store.getState().load();

    const result = await store.getState().importProviders([
      imported('a', 'https://api.dup/v1'),
      imported('b', 'https://api.dup/v1/'),
    ]);

    expect(result).toEqual({ added: 1, skipped: 1 });
  });

  it('importProviders genera sufijo cuando el id colisiona con distinto baseUrl', async () => {
    const { store } = createHarness();
    await store.getState().load();
    await store.getState().addProvider({
      type: 'manual',
      label: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.test/v1',
      requiresKey: false,
    });

    await store.getState().importProviders([imported('p1', 'https://api.otro/v1')]);

    expect(store.getState().providers.map((provider) => provider.id)).toEqual(['p1', 'p1-2']);
  });

  it('importProviders revierte el estado si falla la persistencia de settings', async () => {
    const { store } = createHarness({ settings: new FailingSettingsRepository({ now: () => NOW }) });
    await store.getState().load();

    await store.getState().importProviders([imported('p1', 'https://api.test/v1')]);

    expect(store.getState().providers).toEqual([]);
  });

  it('importProviders no deja proveedores persistidos si falla settings (regresión atomicidad)', async () => {
    const { store, providerRepo } = createHarness({ settings: new FailingSettingsRepository({ now: () => NOW }) });
    await store.getState().load();

    const result = await store.getState().importProviders([imported('p1', 'https://api.atomic/v1')]);

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(store.getState().providers).toEqual([]);
    await expect(providerRepo.load()).resolves.toEqual([]);
  });

  it('patch legal parcial persiste sin resetear el resto de la sección', async () => {
    const { store, repo } = createHarness();
    await store.getState().load();
    const before = store.getState().settings.legal;

    await store.getState().patch({ legal: { enabled: true } });

    const legal = store.getState().settings.legal;
    expect(legal.enabled).toBe(true);
    // El merge conserva los valores no tocados por el patch.
    expect(legal.defaultJurisdiction).toBe(before.defaultJurisdiction);
    expect(legal.retrieval).toEqual(before.retrieval);
    expect(legal.analysis).toEqual(before.analysis);
    expect(legal.anonymization).toBe(before.anonymization);
    expect((await repo.load()).legal.enabled).toBe(true);
  });

  it('patches legales sucesivos acumulan sin destruirse entre sí', async () => {
    const { store } = createHarness();
    await store.getState().load();

    await store.getState().patch({ legal: { defaultJurisdiction: 'caba' } });
    await store.getState().patch({ legal: { enabled: true } });

    const legal = store.getState().settings.legal;
    expect(legal.defaultJurisdiction).toBe('caba');
    expect(legal.enabled).toBe(true);
  });

  it('patch legal con valores inválidos se sanea vía migrateSettings', async () => {
    const { store } = createHarness();
    await store.getState().load();

    await store.getState().patch({ legal: { anonymization: 'optional' } });
    expect(store.getState().settings.legal.anonymization).toBe('optional');

    const invalida = 'nunca' as unknown as LegalSettings['anonymization'];
    await store.getState().patch({ legal: { anonymization: invalida } });

    expect(store.getState().settings.legal.anonymization).toBe('required');
  });

  it('el helper legal devuelve la sección actual', async () => {
    const { store } = createHarness();
    await store.getState().load();

    await store.getState().patch({ legal: { enabled: true, defaultJurisdiction: 'caba' } });

    expect(store.getState().legal()).toEqual(store.getState().settings.legal);
    expect(store.getState().legal().enabled).toBe(true);
    expect(store.getState().legal().defaultJurisdiction).toBe('caba');
  });
});

describe('settingsStore - configuración compartida', () => {
  it('exporta proveedores, secretos y ajustes mínimos', async () => {
    const { store } = createHarness();
    await store.getState().load();
    await store.getState().addProvider({ type: 'manual', label: 'Go', kind: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1', requiresKey: true });
    const created = store.getState().providers[0];
    if (created === undefined) throw new Error('sin proveedor');
    await store.getState().saveApiKey(created.keyRef ?? '', 'sk-hijo');
    await store.getState().patch({
      activeProviderId: created.id,
      lastModelByProvider: { [created.id]: 'muse-spark-1.3-contributor' },
      chat: { thinking: 'high' },
    });

    const payload = await store.getState().exportShareConfig();

    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0]?.secret).toBe('sk-hijo');
    expect(payload.settings.activeProviderId).toBe(created.id);
    expect(payload.settings.chat.thinking).toBe('high');
    expect(payload.settings.lastModelByProvider[created.id]).toBe('muse-spark-1.3-contributor');
  });

  it('aplica un paquete en un store vacío: crea, guarda keys y activa modelo', async () => {
    const origen = createHarness();
    await origen.store.getState().load();
    await origen.store.getState().addProvider({ type: 'manual', label: 'Go', kind: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1', requiresKey: true });
    const created = origen.store.getState().providers[0];
    if (created === undefined) throw new Error('sin proveedor');
    await origen.store.getState().saveApiKey(created.keyRef ?? '', 'sk-hijo');
    await origen.store.getState().patch({
      activeProviderId: created.id,
      lastModelByProvider: { [created.id]: 'muse-spark-1.3-contributor' },
      chat: { thinking: 'high' },
    });
    const payload = await origen.store.getState().exportShareConfig();

    const destino = createHarness();
    await destino.store.getState().load();
    const result = await destino.store.getState().applyShareConfig(payload);

    expect(result).toEqual({ added: 1, reused: 0, keysSet: 1, keysMissing: 0 });
    const state = destino.store.getState();
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.id).toBe(created.id);
    expect(state.settings.activeProviderId).toBe(created.id);
    expect(state.settings.chat.thinking).toBe('high');
    expect(state.settings.lastModelByProvider[created.id]).toBe('muse-spark-1.3-contributor');
    expect(await destino.keys.get(state.providers[0]?.keyRef ?? '')).toBe('sk-hijo');
    expect(state.keyPresence[state.providers[0]?.keyRef ?? '']).toBe(true);
  });

  it('no pisa un proveedor equivalente del destino y cuenta faltantes de key', async () => {
    const destino = createHarness();
    await destino.store.getState().load();
    await destino.store.getState().addProvider({ type: 'manual', label: 'Ya lo tengo', kind: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1', requiresKey: true });

    const origen = createHarness();
    await origen.store.getState().load();
    await origen.store.getState().addProvider({ type: 'manual', label: 'Go del hijo', kind: 'opencode', baseUrl: 'https://opencode.ai/zen/go/v1', requiresKey: true });
    const payload = await origen.store.getState().exportShareConfig();
    expect(payload.providers[0]?.secret).toBeNull();

    const result = await destino.store.getState().applyShareConfig(payload);

    expect(result.added).toBe(0);
    expect(result.reused).toBe(1);
    expect(result.keysMissing).toBe(1);
    expect(destino.store.getState().providers[0]?.label).toBe('Ya lo tengo');
  });
});
