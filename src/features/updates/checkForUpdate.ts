import type { HttpClient } from '@/domain/ports/HttpClient';

import { isNewerVersion, parseUpdateManifest, UPDATE_MANIFEST_URL } from './manifest';
import type { UpdateManifest } from './manifest';

export type UpdateCheckResult =
  | { status: 'available'; manifest: UpdateManifest }
  | { status: 'up-to-date'; manifest: UpdateManifest }
  | { status: 'error'; message: string };

export interface CheckForUpdateOptions {
  http: HttpClient;
  currentVersion: string;
  manifestUrl?: string;
  signal?: AbortSignal;
}

/**
 * Descarga y valida el manifiesto de actualización, comparándolo con la versión
 * actual. Nunca lanza: cualquier fallo se traduce a `{ status: 'error' }`.
 */
export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const url = options.manifestUrl ?? UPDATE_MANIFEST_URL;
  try {
    const response = await options.http.request({
      url,
      method: 'GET',
      headers: { accept: 'application/json' },
      timeoutMs: 15000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (response.status !== 200) return { status: 'error', message: `HTTP ${response.status}` };

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      return { status: 'error', message: 'invalid JSON' };
    }

    const manifest = parseUpdateManifest(parsed);
    if (manifest === null) return { status: 'error', message: 'invalid manifest' };

    return isNewerVersion(manifest.version, options.currentVersion)
      ? { status: 'available', manifest }
      : { status: 'up-to-date', manifest };
  } catch (cause) {
    return { status: 'error', message: cause instanceof Error ? cause.message : String(cause) };
  }
}
