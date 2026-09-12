import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { CapacitorHttpClient } from '@/adapters/http/CapacitorHttpClient';
import { createStreamTransport } from '@/adapters/http/resolveTransport';
import { createProviderAdapter } from '@/adapters/providers';
import { IndexedDbConversations } from '@/adapters/storage/IndexedDbConversations';
import { LocalKeyVault } from '@/adapters/storage/LocalKeyVault';
import { LocalSettingsRepository } from '@/adapters/storage/LocalSettingsRepository';
import { createToolRegistry } from '@/adapters/tools';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { HttpClient, StreamTransport } from '@/domain/ports/HttpClient';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import type { ProviderConfig } from '@/domain/types/provider';
import type { AppSettings } from '@/domain/types/settings';
import type { ToolRegistry } from '@/domain/types/tools';

export interface AppServices {
  conversations: ConversationRepository;
  settings: SettingsRepository;
  keys: KeyVault;
  http: HttpClient;
  transport: StreamTransport;
  createAdapter(config: ProviderConfig): Promise<ProviderAdapter>;
  /** Seam de tools web: el chat lo inyecta en modo investigación (opcional para dobles de test). */
  createTools?: (settings: AppSettings) => ToolRegistry;
}

export interface CreateServicesOverrides {
  conversations?: ConversationRepository;
  settings?: SettingsRepository;
  keys?: KeyVault;
  http?: HttpClient;
  transport?: StreamTransport;
}

/** Arma los servicios reales; los tests inyectan dobles vía `overrides`. */
export function createServices(overrides: CreateServicesOverrides = {}): AppServices {
  const conversations = overrides.conversations ?? new IndexedDbConversations();
  const settings = overrides.settings ?? new LocalSettingsRepository();
  const keys = overrides.keys ?? new LocalKeyVault();
  const http = overrides.http ?? new CapacitorHttpClient();
  const transport = overrides.transport ?? createStreamTransport();

  return {
    conversations,
    settings,
    keys,
    http,
    transport,
    async createAdapter(config: ProviderConfig): Promise<ProviderAdapter> {
      const apiKey = config.keyRef === null ? undefined : ((await keys.get(config.keyRef)) ?? undefined);
      return createProviderAdapter(config, { transport, http, now: Date.now, apiKey });
    },
    createTools: (settings) => createToolRegistry(settings, { http, keys, now: Date.now }),
  };
}

const ServicesContext = createContext<AppServices | null>(null);

export interface ServicesProviderProps {
  services: AppServices;
  children: ReactNode;
}

export function ServicesProvider({ services, children }: ServicesProviderProps) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return services;
}
