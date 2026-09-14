import { beforeEach, describe, expect, it } from 'vitest';

import { CapacitorHttpClient } from '@/adapters/http/CapacitorHttpClient';
import { OPEN_URL_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '@/adapters/tools';
import { CITE_ARTICLE_TOOL_NAME, LEGAL_SEARCH_TOOL_NAME } from '@/adapters/tools/legal';
import type { HttpClient, HttpRequest, StreamTransport } from '@/domain/ports/HttpClient';
import type { ProviderConfig } from '@/domain/types/provider';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { AppSettings } from '@/domain/types/settings';
import type { LegalPack } from '@/domain/types/legal';
import {
  MemoryKeyVault,
  MemoryLegalCaseRepository,
  MemoryLegalPackStore,
  MemorySettingsRepository,
} from '@/test/fakes/MemoryRepos';

import type { AppServices, CreateToolsContext } from './services';
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

/** Harnés con stores legales en memoria para aislar los tests de IndexedDB. */
function createLegalHarness() {
  const keys = new MemoryKeyVault();
  const http: HttpClient = {
    async request() {
      return { status: 200, headers: {}, text: '{"data":[]}' };
    },
  };
  const transport: StreamTransport = {
    async post() {
      return { mode: 'buffered', status: 200, text: '{}' };
    },
  };
  const legalCases = new MemoryLegalCaseRepository();
  const legalPacks = new MemoryLegalPackStore();
  const services = createServices({ keys, http, transport, legalCases, legalPacks });
  return { services, legalCases, legalPacks };
}

/** Resuelve el registry vía el seam; lanza si el servicio no lo expone. */
function toolsOf(services: AppServices, settings: AppSettings, context?: CreateToolsContext) {
  const createTools = services.createTools;
  if (createTools === undefined) throw new Error('createTools no definido');
  return createTools(settings, context);
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

describe('createServices modo legal (T19)', () => {
  it('expone legalCases/legalPacks/legalCorpus definidos por defecto', () => {
    const services = createServices();

    expect(services.legalCases).toBeDefined();
    expect(services.legalPacks).toBeDefined();
    expect(services.legalCorpus).toBeDefined();
  });

  it('createTools sin contexto sólo expone las tools web (modo general)', () => {
    const { services } = createLegalHarness();
    const settings = createDefaultSettings(1);

    const names = toolsOf(services, settings)
      .list()
      .map((tool) => tool.name);

    expect(names).toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).toContain(OPEN_URL_TOOL_NAME);
    expect(names).not.toContain(LEGAL_SEARCH_TOOL_NAME);
    expect(names).not.toContain(CITE_ARTICLE_TOOL_NAME);
    expect(toolsOf(services, settings).get(LEGAL_SEARCH_TOOL_NAME)).toBeUndefined();
  });

  it('createTools con legalCaseId compone web + legales', () => {
    const { services } = createLegalHarness();
    const settings = createDefaultSettings(1);

    const registry = toolsOf(services, settings, { legalCaseId: 'case-1' });
    const names = registry
      .list()
      .map((tool) => tool.name);

    expect(names).toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).toContain(OPEN_URL_TOOL_NAME);
    expect(names).toContain(LEGAL_SEARCH_TOOL_NAME);
    expect(names).toContain(CITE_ARTICLE_TOOL_NAME);
    expect(registry.get(LEGAL_SEARCH_TOOL_NAME)?.name).toBe(LEGAL_SEARCH_TOOL_NAME);
    expect(registry.get(CITE_ARTICLE_TOOL_NAME)?.name).toBe(CITE_ARTICLE_TOOL_NAME);
  });

  it('createTools con legalCaseId null sólo expone las tools web', () => {
    const { services } = createLegalHarness();
    const settings = createDefaultSettings(1);

    const names = toolsOf(services, settings, { legalCaseId: null })
      .list()
      .map((tool) => tool.name);

    expect(names).toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).not.toContain(LEGAL_SEARCH_TOOL_NAME);
    expect(names).not.toContain(CITE_ARTICLE_TOOL_NAME);
  });
});

describe('createServices particionado por usuario', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('userId aísla los ajustes entre usuarios y respecto de la partición legacy', async () => {
    const alice = createServices({}, { userId: 'scope-settings-alice' });
    const bob = createServices({}, { userId: 'scope-settings-bob' });
    const legacy = createServices();

    const untouched = await bob.settings.load();
    await alice.settings.save({ ...(await alice.settings.load()), locale: 'en', theme: 'dark' });

    expect((await alice.settings.load()).locale).toBe('en');
    expect((await alice.settings.load()).theme).toBe('dark');
    expect((await bob.settings.load()).locale).toBe(untouched.locale);
    expect((await bob.settings.load()).theme).toBe(untouched.theme);
    expect((await legacy.settings.load()).locale).toBe(untouched.locale);
    expect((await legacy.settings.load()).theme).toBe(untouched.theme);
  });

  it('userId aísla las API keys entre usuarios y respecto de la partición legacy', async () => {
    const alice = createServices({}, { userId: 'scope-keys-alice' });
    const bob = createServices({}, { userId: 'scope-keys-bob' });
    const legacy = createServices();

    await alice.keys.set('provider:groq', 'sk-alice');

    expect(await alice.keys.get('provider:groq')).toBe('sk-alice');
    expect(await bob.keys.get('provider:groq')).toBeNull();
    expect(await legacy.keys.get('provider:groq')).toBeNull();
  });

  it('userId aísla las conversaciones en IndexedDB', async () => {
    const alice = createServices({}, { userId: 'scope-conv-alice' });
    const bob = createServices({}, { userId: 'scope-conv-bob' });
    const legacy = createServices();

    const conversation = await alice.conversations.create({ title: 'Secreta de Alice' });

    expect(await alice.conversations.get(conversation.id)).not.toBeNull();
    expect(await bob.conversations.get(conversation.id)).toBeNull();
    expect(await legacy.conversations.get(conversation.id)).toBeNull();
  });

  it('userId aísla los expedientes en IndexedDB', async () => {
    const alice = createServices({}, { userId: 'scope-cases-alice' });
    const bob = createServices({}, { userId: 'scope-cases-bob' });
    const legacy = createServices();
    const aliceCases = alice.legalCases;
    const bobCases = bob.legalCases;
    const legacyCases = legacy.legalCases;
    if (aliceCases === undefined || bobCases === undefined || legacyCases === undefined) {
      throw new Error('legalCases no definido');
    }

    const legalCase = await aliceCases.create({
      title: 'Expediente de Alice',
      jurisdiction: 'national',
      court: 'Juzgado de prueba',
      matter: 'civil',
      clientRole: 'plaintiff',
    });

    expect(await aliceCases.get(legalCase.id)).not.toBeNull();
    expect(await bobCases.get(legalCase.id)).toBeNull();
    expect(await legacyCases.get(legalCase.id)).toBeNull();
  });

  it('userId aísla los packs instalados en IndexedDB', async () => {
    const alice = createServices({}, { userId: 'scope-packs-alice' });
    const bob = createServices({}, { userId: 'scope-packs-bob' });
    const legacy = createServices();
    const alicePacks = alice.legalPacks;
    const bobPacks = bob.legalPacks;
    const legacyPacks = legacy.legalPacks;
    if (alicePacks === undefined || bobPacks === undefined || legacyPacks === undefined) {
      throw new Error('legalPacks no definido');
    }

    await alicePacks.install(makePack(), 12);

    expect(await alicePacks.get('pack-scope')).not.toBeNull();
    expect(await bobPacks.get('pack-scope')).toBeNull();
    expect(await legacyPacks.get('pack-scope')).toBeNull();
  });

  it('sin options mantiene la partición legacy compartida', async () => {
    const first = createServices();
    const second = createServices();

    await first.keys.set('provider:groq', 'sk-legacy');

    expect(await second.keys.get('provider:groq')).toBe('sk-legacy');
  });

  it('los overrides con dobles ignoran userId', async () => {
    const keys = new MemoryKeyVault();
    const settings = new MemorySettingsRepository();
    const alice = createServices({ keys, settings }, { userId: 'scope-dobles-alice' });
    const bob = createServices({ keys, settings }, { userId: 'scope-dobles-bob' });

    expect(alice.keys).toBe(keys);
    expect(alice.settings).toBe(settings);

    await alice.keys.set('provider:groq', 'sk-compartida');
    expect(await bob.keys.get('provider:groq')).toBe('sk-compartida');
  });
});

/** Pack mínimo válido para probar el aislamiento del store real. */
function makePack(): LegalPack {
  return {
    schema: 'openher.legal.pack/1',
    id: 'pack-scope',
    title: 'Pack de prueba',
    version: '1',
    publishedAt: '2026-01-01',
    jurisdiction: 'national',
    matter: 'civil',
    license: { name: 'Prueba', url: 'https://example.com', attribution: 'Prueba' },
    sources: [],
    norms: [],
    provisions: [],
    hash: 'hash-de-prueba',
  };
}
