import type { LegalPackStore } from '@/domain/ports/LegalPackStore';
import type { InstalledPack, LegalPack } from '@/domain/types/legal';
import { INSTALLED_AT_INDEX, LEGAL_PACKS_STORE, getDb } from './idb';
import type { StoredLegalPack } from './idb';

export interface LegalPackStorageDeps {
  now: () => number;
  ownerId?: string | null;
}

const DEFAULT_DEPS: LegalPackStorageDeps = { now: () => Date.now() };

/**
 * Store real de packs instalados sobre IndexedDB v2. Fuente única de "packs
 * instalados" en el dispositivo: el contenido completo vive sólo acá.
 */
export class IndexedDbLegalPacks implements LegalPackStore {
  private readonly now: () => number;
  private readonly ownerId: string | null;

  constructor(deps: Partial<LegalPackStorageDeps> = {}) {
    this.now = deps.now ?? DEFAULT_DEPS.now;
    this.ownerId = deps.ownerId ?? null;
  }

  /** Metadatos de los packs instalados, en orden `(installedAt, id)`, sin contenido. */
  async listInstalled(): Promise<InstalledPack[]> {
    const db = await getDb(this.ownerId);
    const stored = await db.getAllFromIndex(LEGAL_PACKS_STORE, INSTALLED_AT_INDEX);
    return stored.map(toInstalledPack);
  }

  /** Pack completo por id (sin los metadatos de instalación), o `null` si no está. */
  async get(id: string): Promise<LegalPack | null> {
    const db = await getDb(this.ownerId);
    const stored = await db.get(LEGAL_PACKS_STORE, id);
    return stored === undefined ? null : toLegalPack(stored);
  }

  /** Instala o reemplaza por `id` (upsert) y devuelve los metadatos persistidos. */
  async install(pack: LegalPack, bytes: number): Promise<InstalledPack> {
    const stored: StoredLegalPack = { ...pack, installedAt: this.now(), bytes };
    const db = await getDb(this.ownerId);
    await db.put(LEGAL_PACKS_STORE, stored);
    return toInstalledPack(stored);
  }

  async remove(id: string): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.delete(LEGAL_PACKS_STORE, id);
  }
}

/** Metadatos sin el contenido; descarta `provisions`/`norms` y el resto del pack. */
function toInstalledPack(stored: StoredLegalPack): InstalledPack {
  return {
    id: stored.id,
    version: stored.version,
    hash: stored.hash,
    installedAt: stored.installedAt,
    bytes: stored.bytes,
  };
}

/** Contenido completo, sin `installedAt`/`bytes` (metadatos del registro de instalación). */
function toLegalPack(stored: StoredLegalPack): LegalPack {
  const { installedAt: _installedAt, bytes: _bytes, ...pack } = stored;
  return pack;
}
