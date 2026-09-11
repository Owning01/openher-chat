import type { KeyVault } from '@/domain/ports/KeyVault';

export const KEY_STORAGE_PREFIX = 'openher.key.';

/** Secretos locales por ref (`provider:<id>`, `search:<provider>`); nunca se loguean ni salen del dispositivo. */
export class LocalKeyVault implements KeyVault {
  async has(ref: string): Promise<boolean> {
    const storage = getLocalStorage();
    if (storage === null) return false;
    try {
      return storage.getItem(KEY_STORAGE_PREFIX + ref) !== null;
    } catch {
      return false;
    }
  }

  async get(ref: string): Promise<string | null> {
    const storage = getLocalStorage();
    if (storage === null) return null;
    try {
      return storage.getItem(KEY_STORAGE_PREFIX + ref);
    } catch {
      return null;
    }
  }

  async set(ref: string, secret: string): Promise<void> {
    const storage = getLocalStorage();
    if (storage === null) return;
    storage.setItem(KEY_STORAGE_PREFIX + ref, secret);
  }

  async remove(ref: string): Promise<void> {
    const storage = getLocalStorage();
    if (storage === null) return;
    storage.removeItem(KEY_STORAGE_PREFIX + ref);
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
