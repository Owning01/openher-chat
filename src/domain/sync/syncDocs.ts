/**
 * Documentos del espejo en la nube (`users/{uid}/sync/...`). Separados para
 * auditar reglas: `config` sin secretos, `secrets` solo keyRef→secreto.
 * Puros y testeables; el transporte (Firestore) vive en adapters.
 */
import type { AppSettings } from '../types/settings';
import type { ProviderConfig } from '../types/provider';
import type { SharedSettings, SharePayload } from '../settings/share';
import { parseSharePayload } from '../settings/share';

export interface SyncConfigDoc {
  version: 1;
  updatedAt: number;
  providers: { config: ProviderConfig }[];
  settings: SharedSettings;
}

export interface SyncSecretsDoc {
  version: 1;
  updatedAt: number;
  keys: Record<string, string>;
}

/** Parte el payload en los dos documentos (nunca lanza con input válido). */
export function toSyncDocs(payload: SharePayload): { config: SyncConfigDoc; secrets: SyncSecretsDoc } {
  const keys: Record<string, string> = {};
  for (const entry of payload.providers) {
    if (entry.secret !== null && entry.config.keyRef !== null) keys[entry.config.keyRef] = entry.secret;
  }
  return {
    config: {
      version: 1,
      updatedAt: payload.exportedAt,
      providers: payload.providers.map((entry) => ({ config: entry.config })),
      settings: payload.settings,
    },
    secrets: { version: 1, updatedAt: payload.exportedAt, keys },
  };
}

/**
 * Recompone el payload (`null` si algún documento es inválido). Los secretos
 * faltantes quedan en `null` (el llamador los pide a mano). Nunca lanza.
 */
export function fromSyncDocs(configDoc: unknown, secretsDoc: unknown): SharePayload | null {
  const config = asRecord(configDoc);
  const secrets = asRecord(secretsDoc);
  if (config === null || secrets === null) return null;
  if (config.version !== 1 || secrets.version !== 1) return null;
  if (!Array.isArray(config.providers)) return null;
  if (typeof config.updatedAt !== 'number' || !Number.isFinite(config.updatedAt)) return null;
  const keys = asRecord(secrets.keys);
  if (keys === null) return null;
  for (const value of Object.values(keys)) {
    if (typeof value !== 'string' || value === '') return null;
  }
  const providers: SharePayload['providers'] = [];
  for (const entry of config.providers) {
    const record = asRecord(entry);
    if (record === null) return null;
    const keyRef = (asRecord(record.config)?.keyRef ?? null) as string | null;
    const secret = keyRef === null ? null : (keys[keyRef] as string | undefined) ?? null;
    providers.push({ config: record.config, secret } as SharePayload['providers'][number]);
  }
  return parseSharePayload({
    app: 'openher-chat',
    version: 1,
    exportedAt: config.updatedAt,
    providers,
    settings: config.settings,
  });
}

/**
 * `true` si el cambio de ajustes amerita subir (solo viaja el subset
 * compartible: proveedor activo, modelo por proveedor, chat e idioma).
 */
export function isShareRelevant(previous: AppSettings, next: AppSettings): boolean {
  return (
    previous.activeProviderId !== next.activeProviderId ||
    previous.locale !== next.locale ||
    JSON.stringify(previous.lastModelByProvider) !== JSON.stringify(next.lastModelByProvider) ||
    JSON.stringify(previous.chat) !== JSON.stringify(next.chat)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
