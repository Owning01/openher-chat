import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { CapacitorHttpClient } from '@/adapters/http/CapacitorHttpClient';
import { createStreamTransport } from '@/adapters/http/resolveTransport';
import { createFirebaseAuth } from '@/adapters/auth/FirebaseAuth';
import { createFirestoreSync } from '@/adapters/sync/FirestoreSync';
import { createLegalCorpus } from '@/adapters/legal/LegalCorpus';
import type { LegalCorpus } from '@/adapters/legal/LegalCorpus';
import { createProviderAdapter } from '@/adapters/providers';
import { IndexedDbConversations } from '@/adapters/storage/IndexedDbConversations';
import { IndexedDbLegalCases } from '@/adapters/storage/IndexedDbLegalCases';
import { IndexedDbLegalPacks } from '@/adapters/storage/IndexedDbLegalPacks';
import { IndexedDbSkills } from '@/adapters/storage/IndexedDbSkills';
import { LocalKeyVault } from '@/adapters/storage/LocalKeyVault';
import { LocalSettingsRepository } from '@/adapters/storage/LocalSettingsRepository';
import { createToolRegistry } from '@/adapters/tools';
import { createLegalToolRegistry } from '@/adapters/tools/legal';
import type { LegalGapEntry } from '@/adapters/tools/legal';
import type { AuthPort } from '@/domain/ports/AuthPort';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { HttpClient, StreamTransport } from '@/domain/ports/HttpClient';
import type { KeyVault } from '@/domain/ports/KeyVault';
import type { LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type { LegalPackStore } from '@/domain/ports/LegalPackStore';
import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { SettingsRepository } from '@/domain/ports/SettingsRepository';
import type { SkillRepository } from '@/domain/ports/SkillRepository';
import type { CloudSyncPort } from '@/domain/ports/SyncPort';
import { composeToolRegistries } from '@/domain/tools/composeRegistry';
import type { ProviderConfig } from '@/domain/types/provider';
import type { AppSettings } from '@/domain/types/settings';
import type { Skill } from '@/domain/types/skill';
import type { ToolRegistry } from '@/domain/types/tools';
import { newId } from '@/shared/utils/ids';

import { readFirebaseConfig } from './firebaseConfig';

export interface AppServices {
  conversations: ConversationRepository;
  settings: SettingsRepository;
  keys: KeyVault;
  http: HttpClient;
  transport: StreamTransport;
  /** Sólo existe si hay configuración de Firebase: si falta, la app es local-first sin login. */
  auth?: AuthPort;
  /**
   * Espejo de configuración en Firestore. Sólo existe con config de Firebase;
   * sin él la app es local-first (el bloque de nube no se muestra).
   */
  sync?: CloudSyncPort;
  /** Expediente, packs y corpus del modo legal (opcionales para no romper literales viejos de test). */
  legalCases?: LegalCaseRepository;
  legalPacks?: LegalPackStore;
  legalCorpus?: LegalCorpus;
  /** Skills guardadas en el dispositivo que el agente puede cargar con `load_skill`. */
  skills?: SkillRepository;
  createAdapter(config: ProviderConfig): Promise<ProviderAdapter>;
  /**
   * Seam de tools web + legales: sin `legalCaseId` devuelve sólo las tools web
   * (modo general); con `legalCaseId` compone además `legal_search`/`cite_article`
   * y persiste los gaps en el expediente (opcional para dobles de test).
   */
  createTools?: (settings: AppSettings, context?: CreateToolsContext) => ToolRegistry;
}

/** Contexto del turno para componer tools: el vínculo caso↔conversación vive en `Conversation.legalCaseId`. */
export interface CreateToolsContext {
  conversationId?: string | null;
  legalCaseId?: string | null;
  /** Snapshot de skills del turno; el chat las resuelve una vez por run. */
  skills?: readonly Skill[];
}

export interface CreateServicesOverrides {
  conversations?: ConversationRepository;
  settings?: SettingsRepository;
  keys?: KeyVault;
  http?: HttpClient;
  transport?: StreamTransport;
  auth?: AuthPort;
  sync?: CloudSyncPort;
  legalCases?: LegalCaseRepository;
  legalPacks?: LegalPackStore;
  legalCorpus?: LegalCorpus;
  skills?: SkillRepository;
}

export interface CreateServicesOptions {
  /**
   * UID de Firebase para particionar el storage por usuario. Ausente o
   * `null` = partición legacy compartida (fase sin sesión).
   */
  userId?: string | null;
}

/** Arma los servicios reales; los tests inyectan dobles vía `overrides`. */
export function createServices(
  overrides: CreateServicesOverrides = {},
  options: CreateServicesOptions = {},
): AppServices {
  // Dueño de los datos locales; los overrides con dobles lo ignoran.
  const ownerId = options.userId ?? null;
  const conversations = overrides.conversations ?? new IndexedDbConversations({ ownerId });
  const settings = overrides.settings ?? new LocalSettingsRepository(undefined, ownerId);
  const keys = overrides.keys ?? new LocalKeyVault(ownerId);
  const http = overrides.http ?? new CapacitorHttpClient();
  const transport = overrides.transport ?? createStreamTransport();
  const auth = overrides.auth ?? createAuthFromEnv();
  const sync = overrides.sync ?? createSyncFromEnv();
  const legalCases = overrides.legalCases ?? new IndexedDbLegalCases({ ownerId });
  const legalPacks = overrides.legalPacks ?? new IndexedDbLegalPacks({ ownerId });
  // El corpus usa el `http` del servicio y el pack store real; el manifiesto y
  // la base quedan con los defaults (`legal/packs/index.json` relativo al origen,
  // asset same-origin servido en `public/legal/packs/`).
  const legalCorpus = overrides.legalCorpus ?? createLegalCorpus({ http, packs: legalPacks });
  const skills = overrides.skills ?? new IndexedDbSkills({ ownerId });

  return {
    ...(auth === undefined ? {} : { auth }),
    ...(sync === undefined ? {} : { sync }),
    conversations,
    settings,
    keys,
    http,
    transport,
    legalCases,
    legalPacks,
    legalCorpus,
    skills,
    async createAdapter(config: ProviderConfig): Promise<ProviderAdapter> {
      const apiKey = config.keyRef === null ? undefined : ((await keys.get(config.keyRef)) ?? undefined);
      let openCodeProxyUrl: string | undefined;
      try {
        openCodeProxyUrl = (await settings.load()).proxy.openCodeProxyUrl ?? undefined;
      } catch {
        openCodeProxyUrl = undefined;
      }
      return createProviderAdapter(config, { transport, http, now: Date.now, apiKey, openCodeProxyUrl });
    },
    createTools: (settings, context) => {
      const web = createToolRegistry(settings, { http, keys, now: Date.now, skills: context?.skills });
      const legalCaseId = context?.legalCaseId;
      // Sin caso legal (ausente, nulo o vacío) el modo es general: sólo tools web, sin cambios.
      if (typeof legalCaseId !== 'string' || legalCaseId.trim() === '') return web;
      const legal = createLegalToolRegistry({
        corpus: legalCorpus,
        cases: legalCases,
        caseId: legalCaseId,
        reportGap: (entry) => {
          void persistLegalGap(legalCases, legalCaseId, entry);
        },
      });
      return composeToolRegistries(web, legal);
    },
  };
}

/** Auth sólo se activa si el build trae la config de Firebase (`.env.local`). */
function createAuthFromEnv(): AuthPort | undefined {
  const config = readFirebaseConfig();
  if (config === null) return undefined;
  return createFirebaseAuth(config);
}

/** El espejo en la nube usa la misma condición que Auth (sólo con config). */
function createSyncFromEnv(): CloudSyncPort | undefined {
  const config = readFirebaseConfig();
  if (config === null) return undefined;
  return createFirestoreSync(config);
}

/**
 * Persiste un gap legal en el expediente del contexto. Decisión: se guarda con
 * el `caseId` del contexto sin resolver el caso en `legalCases` (el vínculo
 * caso↔conversación ya lo trae el caller); nunca lanza ni loguea (sin secretos
 * en logs): el fallo degrada a no-op como en las tools.
 */
function persistLegalGap(
  cases: LegalCaseRepository,
  caseId: string,
  entry: LegalGapEntry,
): Promise<void> {
  const gap = {
    id: newId('gap'),
    caseId,
    query: entry.query,
    ...(entry.missingNorm === undefined ? {} : { missingNorm: entry.missingNorm }),
    ...(entry.missingArticle === undefined ? {} : { missingArticle: entry.missingArticle }),
    at: Date.now(),
  };
  return cases.appendGap(gap).catch(() => undefined);
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
