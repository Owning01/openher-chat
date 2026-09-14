import type { KeyVault } from '@/domain/ports/KeyVault';

export const KEY_STORAGE_PREFIX = 'openher.key.';

/**
 * Clave efectiva de un secreto: `openher.key.<ref>` sin owner,
 * `openher.key.<owner>:<ref>` con owner.
 */
export function keyStorageKey(ref: string, ownerId?: string | null): string {
  if (ownerId === null || ownerId === undefined || ownerId === '') return KEY_STORAGE_PREFIX + ref;
  return `${KEY_STORAGE_PREFIX}${ownerId}:${ref}`;
}

/** Secretos locales por ref (`provider:<id>`, `search:<provider>`); nunca se loguean ni salen del dispositivo. */
export class LocalKeyVault implements KeyVault {
  private readonly ownerId: string | null;

  constructor(ownerId: string | null = null) {
    this.ownerId = ownerId;
  }

  async has(ref: string): Promise<boolean> {
    const storage = getLocalStorage();
    if (storage === null) return false;
    try {
      return storage.getItem(this.keyFor(ref)) !== null;
    } catch {
      return false;
    }
  }

  async get(ref: string): Promise<string | null> {
    const storage = getLocalStorage();
    if (storage === null) return null;
    try {
      return storage.getItem(this.keyFor(ref));
    } catch {
      return null;
    }
  }

  async set(ref: string, secret: string): Promise<void> {
    const storage = getLocalStorage();
    if (storage === null) return;
    storage.setItem(this.keyFor(ref), secret);
  }

  async remove(ref: string): Promise<void> {
    const storage = getLocalStorage();
    if (storage === null) return;
    storage.removeItem(this.keyFor(ref));
  }

  /** Clave instanciada para la ref indicada según el owner de este vault. */
  private keyFor(ref: string): string {
    return keyStorageKey(ref, this.ownerId);
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
