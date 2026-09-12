import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import type { KeyVault } from '@/domain/ports/KeyVault';
import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import { getProviderTemplate } from '@/domain/providers/catalog';
import type { ProviderTemplate } from '@/domain/providers/catalog';
import { createDefaultSettings } from '@/domain/settings/defaults';
import { migrateSettings } from '@/domain/settings/migrate';
import type { AgentBudget } from '@/domain/types/agent';
import type { ModelInfo, ProviderConfig, ProviderKind } from '@/domain/types/provider';
import type {
  AppSettings,
  ChatDefaults,
  HistoryBudget,
  Locale,
  ProxySettings,
  SearchSettings,
  ThemeMode,
  ToolSettings,
} from '@/domain/types/settings';
import { newId as defaultNewId } from '@/shared/utils/ids';

import { mergeApiModels, normalizeDefaultModelId } from './providerModels';
import { LocalProviderConfigRepository, sanitizeModelInfos } from './providerStorage';
import type { ProviderConfigRepository } from './providerStorage';
import { hasProviderDraftErrors, isProviderKind, validateProviderDraft } from './validation';

/** Refs canónicos de las API keys de búsqueda (la de proveedores es `provider:<id>`). */
export const SEARCH_KEY_REFS = { brave: 'search:brave', tavily: 'search:tavily' } as const;

export type SettingsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type AddProviderInput =
  | { type: 'template'; templateId: string }
  | { type: 'manual'; label: string; kind: ProviderKind; baseUrl: string; requiresKey: boolean };

export type ProviderPatch = Partial<
  Pick<
    ProviderConfig,
    'label' | 'kind' | 'baseUrl' | 'requiresKey' | 'models' | 'defaultModelId' | 'quirks' | 'extraHeaders'
  >
>;

export type SettingsPatch = Partial<
  Pick<AppSettings, 'locale' | 'theme' | 'activeProviderId' | 'lastModelByProvider' | 'onboardingCompleted'>
> & {
  chat?: Partial<ChatDefaults>;
  history?: Partial<HistoryBudget>;
  agent?: Partial<AgentBudget>;
  tools?: Partial<ToolSettings>;
  search?: Partial<SearchSettings>;
  proxy?: Partial<ProxySettings>;
};

/** Dependencias del store: `AppServices` es estructuralmente asignable. */
export interface SettingsStoreServices {
  settings: SettingsRepository;
  keys: KeyVault;
  createAdapter(config: ProviderConfig): Promise<ProviderAdapter>;
}

export interface SettingsStoreOptions {
  providers?: ProviderConfigRepository;
  now?: () => number;
  newId?: () => string;
}

export interface SettingsState {
  settings: AppSettings;
  providers: ProviderConfig[];
  keyPresence: Record<string, boolean>;
  ready: boolean;
  status: SettingsStatus;
  error: string | null;
  refreshingProviderId: string | null;
  load(): Promise<void>;
  patch(patch: SettingsPatch): Promise<void>;
  save(): Promise<void>;
  addProvider(input: AddProviderInput): Promise<ProviderConfig | null>;
  updateProvider(id: string, patch: ProviderPatch): Promise<boolean>;
  removeProvider(id: string): Promise<boolean>;
  saveApiKey(ref: string, secret: string): Promise<boolean>;
  refreshModels(providerId: string): Promise<ModelInfo[] | null>;
  setActiveProvider(id: string | null): Promise<void>;
  setModelForProvider(providerId: string, modelId: string | null): Promise<void>;
  dismissError(): void;
  chatDefaults(): ChatDefaults;
  agentBudget(): AgentBudget;
  historyBudget(): HistoryBudget;
  search(): SearchSettings;
  proxy(): ProxySettings;
  appearance(): { theme: ThemeMode; locale: Locale };
}

export type SettingsStore = UseBoundStore<StoreApi<SettingsState>>;

export function createSettingsStore(services: SettingsStoreServices, options: SettingsStoreOptions = {}): SettingsStore {
  const settingsRepo = services.settings;
  const keys = services.keys;
  const providerRepo = options.providers ?? new LocalProviderConfigRepository();
  const now = options.now ?? (() => Date.now());
  const generateId = options.newId ?? (() => defaultNewId('provider'));

  return create<SettingsState>((set, get) => ({
    settings: createDefaultSettings(now()),
    providers: [],
    keyPresence: {},
    ready: false,
    status: 'idle',
    error: null,
    refreshingProviderId: null,

    async load() {
      if (get().status === 'loading') return;
      set({ status: 'loading', error: null });
      try {
        const [settings, providers] = await Promise.all([settingsRepo.load(), providerRepo.load()]);
        const keyPresence = await readKeyPresence(keys, providers);
        set({ settings, providers, keyPresence, ready: true, status: 'ready' });
      } catch (error) {
        set({ status: 'error', ready: false, error: toErrorMessage(error) });
      }
    },

    async patch(patch) {
      const previous = get().settings;
      const timestamp = now();
      const next = migrateSettings(mergeSettings(previous, patch, timestamp), timestamp);
      set({ settings: next, error: null });
      try {
        await settingsRepo.save(next);
      } catch (error) {
        set({ settings: previous, error: toErrorMessage(error) });
      }
    },

    async save() {
      const { settings, providers } = get();
      try {
        await Promise.all([settingsRepo.save(settings), providerRepo.save(providers)]);
      } catch (error) {
        set({ error: toErrorMessage(error) });
      }
    },

    async addProvider(input) {
      const created = buildProvider(input, { providers: get().providers, now: now(), newId: generateId });
      if (created === null) {
        set({ error: input.type === 'template' ? 'Unknown provider template' : 'Invalid provider configuration' });
        return null;
      }

      // Un reload a mitad del wizard repite el mismo alta: devuelve el existente en vez de duplicarlo.
      const duplicate = findProviderByKindAndBaseUrl(get().providers, created);
      if (duplicate !== undefined) {
        set({ error: null });
        return duplicate;
      }

      const previousProviders = get().providers;
      const previousSettings = get().settings;
      const settings = withProviderAdded(previousSettings, created, now());
      set({ providers: [...previousProviders, created], settings, error: null });

      try {
        await providerRepo.save(get().providers);
        await settingsRepo.save(settings);
        const keyRef = created.keyRef;
        if (keyRef !== null) {
          set((state) => ({ keyPresence: { ...state.keyPresence, [keyRef]: false } }));
        }
        return created;
      } catch (error) {
        set({ providers: previousProviders, settings: previousSettings, error: toErrorMessage(error) });
        return null;
      }
    },

    async updateProvider(id, patch) {
      const existing = get().providers.find((provider) => provider.id === id);
      if (existing === undefined) return false;

      const updated = applyProviderPatch(existing, patch, now());
      if (updated === null) {
        set({ error: 'Invalid provider configuration' });
        return false;
      }

      const previousProviders = get().providers;
      const nextProviders = previousProviders.map((provider) => (provider.id === id ? updated : provider));
      set({ providers: nextProviders, error: null });
      try {
        await providerRepo.save(nextProviders);
        return true;
      } catch (error) {
        set({ providers: previousProviders, error: toErrorMessage(error) });
        return false;
      }
    },

    async removeProvider(id) {
      const existing = get().providers.find((provider) => provider.id === id);
      if (existing === undefined) return false;

      const previousProviders = get().providers;
      const previousSettings = get().settings;
      const timestamp = now();
      const nextProviders = previousProviders.filter((provider) => provider.id !== id);
      const activeProviderId =
        previousSettings.activeProviderId === id
          ? (nextProviders[0]?.id ?? null)
          : previousSettings.activeProviderId;
      const nextSettings = migrateSettings(
        {
          ...previousSettings,
          activeProviderId,
          lastModelByProvider: omitKey(previousSettings.lastModelByProvider, id),
          updatedAt: timestamp,
        },
        timestamp,
      );
      set({ providers: nextProviders, settings: nextSettings, error: null });

      try {
        await providerRepo.save(nextProviders);
        await settingsRepo.save(nextSettings);
        const keyRef = existing.keyRef;
        if (keyRef !== null) {
          await keys.remove(keyRef);
          set((state) => ({ keyPresence: omitKey(state.keyPresence, keyRef) }));
        }
        return true;
      } catch (error) {
        set({ providers: previousProviders, settings: previousSettings, error: toErrorMessage(error) });
        return false;
      }
    },

    async saveApiKey(ref, secret) {
      const value = secret.trim();
      set({ error: null });
      try {
        if (value === '') await keys.remove(ref);
        else await keys.set(ref, value);
        set((state) => ({ keyPresence: { ...state.keyPresence, [ref]: value !== '' } }));
        return true;
      } catch (error) {
        set({ error: toErrorMessage(error) });
        return false;
      }
    },

    async refreshModels(providerId) {
      const provider = get().providers.find((entry) => entry.id === providerId);
      if (provider === undefined) return null;

      set({ refreshingProviderId: providerId, error: null });
      try {
        const adapter = await services.createAdapter(provider);
        const apiModels = await adapter.listModels();
        const current = get().providers.find((entry) => entry.id === providerId) ?? provider;
        const models = mergeApiModels(current.models, apiModels);
        const updated: ProviderConfig = {
          ...current,
          models,
          defaultModelId: normalizeDefaultModelId(current.defaultModelId, models),
          updatedAt: now(),
        };
        const previousProviders = get().providers;
        const nextProviders = previousProviders.map((entry) => (entry.id === providerId ? updated : entry));
        set({ providers: nextProviders });
        try {
          await providerRepo.save(nextProviders);
          return models;
        } catch (error) {
          set({ providers: previousProviders, error: toErrorMessage(error) });
          return null;
        }
      } catch (error) {
        set({ error: toErrorMessage(error) });
        return null;
      } finally {
        set({ refreshingProviderId: null });
      }
    },

    async setActiveProvider(id) {
      if (id !== null && !get().providers.some((provider) => provider.id === id)) return;
      await get().patch({ activeProviderId: id });
    },

    async setModelForProvider(providerId, modelId) {
      const provider = get().providers.find((entry) => entry.id === providerId);
      if (provider === undefined) return;
      if (modelId !== null && !provider.models.some((model) => model.id === modelId)) return;

      const timestamp = now();
      const previousProviders = get().providers;
      const previousSettings = get().settings;
      const nextProviders = previousProviders.map((entry) =>
        entry.id === providerId ? { ...entry, defaultModelId: modelId, updatedAt: timestamp } : entry,
      );
      const lastModelByProvider = { ...previousSettings.lastModelByProvider };
      if (modelId === null) delete lastModelByProvider[providerId];
      else lastModelByProvider[providerId] = modelId;
      const nextSettings = migrateSettings(
        { ...previousSettings, lastModelByProvider, updatedAt: timestamp },
        timestamp,
      );
      set({ providers: nextProviders, settings: nextSettings, error: null });

      try {
        await Promise.all([providerRepo.save(nextProviders), settingsRepo.save(nextSettings)]);
      } catch (error) {
        set({ providers: previousProviders, settings: previousSettings, error: toErrorMessage(error) });
      }
    },

    dismissError: () => set({ error: null }),

    chatDefaults: () => get().settings.chat,
    agentBudget: () => get().settings.agent,
    historyBudget: () => get().settings.history,
    search: () => get().settings.search,
    proxy: () => get().settings.proxy,
    appearance: () => ({ theme: get().settings.theme, locale: get().settings.locale }),
  }));
}

interface BuildProviderContext {
  providers: readonly ProviderConfig[];
  now: number;
  newId: () => string;
}

function buildProvider(input: AddProviderInput, context: BuildProviderContext): ProviderConfig | null {
  if (input.type === 'template') {
    const template = getProviderTemplate(input.templateId);
    return template === undefined ? null : providerFromTemplate(template, context);
  }

  if (hasProviderDraftErrors(validateProviderDraft(input))) return null;
  const id = uniqueProviderId(context.newId(), context.providers);
  return {
    id,
    label: input.label.trim(),
    kind: input.kind,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    requiresKey: input.requiresKey,
    keyRef: input.requiresKey ? `provider:${id}` : null,
    models: [],
    defaultModelId: null,
    createdAt: context.now,
    updatedAt: context.now,
  };
}

function providerFromTemplate(template: ProviderTemplate, context: BuildProviderContext): ProviderConfig {
  const id = uniqueProviderId(template.id, context.providers);
  const config: ProviderConfig = {
    id,
    label: template.label,
    kind: template.kind,
    baseUrl: template.baseUrl,
    requiresKey: template.requiresKey,
    keyRef: template.requiresKey ? `provider:${id}` : null,
    models: template.models.map((model) => ({ ...model })),
    defaultModelId: template.defaultModelId,
    createdAt: context.now,
    updatedAt: context.now,
  };
  if (template.quirks !== undefined) config.quirks = { ...template.quirks };
  return config;
}

function uniqueProviderId(base: string, providers: readonly ProviderConfig[]): string {
  const existing = new Set(providers.map((provider) => provider.id));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function applyProviderPatch(existing: ProviderConfig, patch: ProviderPatch, timestamp: number): ProviderConfig | null {
  const merged: ProviderConfig = { ...existing, ...patch, updatedAt: timestamp };
  if (hasProviderDraftErrors(validateProviderDraft(merged))) return null;
  if (!isProviderKind(merged.kind)) return null;

  merged.label = merged.label.trim();
  merged.baseUrl = normalizeBaseUrl(merged.baseUrl);
  if (!merged.requiresKey) merged.keyRef = null;
  else if (merged.keyRef === null) merged.keyRef = `provider:${merged.id}`;

  if (patch.models !== undefined || patch.defaultModelId !== undefined) {
    merged.models = sanitizeModelInfos(merged.models);
    merged.defaultModelId = normalizeDefaultModelId(merged.defaultModelId, merged.models);
  }

  return merged;
}

function withProviderAdded(settings: AppSettings, provider: ProviderConfig, timestamp: number): AppSettings {
  const lastModelByProvider =
    provider.defaultModelId === null
      ? settings.lastModelByProvider
      : { ...settings.lastModelByProvider, [provider.id]: provider.defaultModelId };
  return migrateSettings(
    {
      ...settings,
      activeProviderId: settings.activeProviderId ?? provider.id,
      lastModelByProvider,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

function mergeSettings(current: AppSettings, patch: SettingsPatch, timestamp: number): unknown {
  return {
    ...current,
    ...patch,
    chat: patch.chat === undefined ? current.chat : mergeSection(current.chat, patch.chat),
    history: patch.history === undefined ? current.history : mergeSection(current.history, patch.history),
    agent: patch.agent === undefined ? current.agent : mergeSection(current.agent, patch.agent),
    tools: patch.tools === undefined ? current.tools : mergeSection(current.tools, patch.tools),
    search: patch.search === undefined ? current.search : mergeSection(current.search, patch.search),
    proxy: patch.proxy === undefined ? current.proxy : mergeSection(current.proxy, patch.proxy),
    updatedAt: timestamp,
  };
}

/**
 * Fusiona una sección descartando valores no finitos: `NaN`/`Infinity` jamás pisan
 * el valor previo con el default de fábrica de `migrateSettings`.
 */
function mergeSection<T extends object>(current: T, patch: Partial<T>): T {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/**
 * Normaliza la base del proveedor para comparar y almacenar sin duplicados:
 * host en minúsculas (los hosts son case-insensitive) y sin slashes finales.
 */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function findProviderByKindAndBaseUrl(
  providers: readonly ProviderConfig[],
  candidate: Pick<ProviderConfig, 'kind' | 'baseUrl'>,
): ProviderConfig | undefined {
  const baseUrl = normalizeBaseUrl(candidate.baseUrl);
  return providers.find(
    (provider) => provider.kind === candidate.kind && normalizeBaseUrl(provider.baseUrl) === baseUrl,
  );
}

async function readKeyPresence(keys: KeyVault, providers: readonly ProviderConfig[]): Promise<Record<string, boolean>> {
  const refs = new Set<string>(Object.values(SEARCH_KEY_REFS));
  for (const provider of providers) {
    if (provider.keyRef !== null) refs.add(provider.keyRef);
  }
  const entries = await Promise.all([...refs].map(async (ref) => [ref, await keys.has(ref)] as const));
  return Object.fromEntries(entries);
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) next[entryKey] = value;
  }
  return next;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { SettingsStoreProvider, useSettingsStore } from './SettingsStoreContext';
export type { SettingsStoreProviderProps } from './SettingsStoreContext';
