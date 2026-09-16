import { PROXY_SEARCH_PATH, PROXY_TIMEOUT_MS, normalizeProxyBaseUrl } from '@/adapters/tools/proxy';
import type { HttpClient } from '@/domain/ports/HttpClient';

export type ProxyProbeResult =
  | { ok: true }
  | { ok: false; code: 'invalid_url' }
  | { ok: false; code: 'http_error'; status: number }
  | { ok: false; code: 'network' };

const HEALTH_TIMEOUT_MS = 8_000;

/**
 * Probe del proxy propio de OpenCode (VPS): `GET {base}/zen/go/v1/models`.
 * Ese endpoint responde 200 con la lista sin API key, así que 2xx = conectado.
 */
export async function probeOpenCodeProxy(http: HttpClient, baseUrl: string): Promise<ProxyProbeResult> {
  const base = normalizeProxyBaseUrl(baseUrl);
  if (base === null) return { ok: false, code: 'invalid_url' };
  try {
    const response = await http.request({
      url: `${base}/zen/go/v1/models`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, code: 'http_error', status: response.status };
  } catch {
    return { ok: false, code: 'network' };
  }
}
/**
 * Probe best-effort del proxy: `GET {base}/health` y, si no responde 2xx,
 * `POST {base}/v1/search` con una consulta mínima.
 */
export async function probeProxy(http: HttpClient, baseUrl: string): Promise<ProxyProbeResult> {
  const base = normalizeProxyBaseUrl(baseUrl);
  if (base === null) return { ok: false, code: 'invalid_url' };

  try {
    const health = await http.request({
      url: `${base}/health`,
      method: 'GET',
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    if (health.status >= 200 && health.status < 300) return { ok: true };
  } catch {
    // Sin `/health`: se prueba el endpoint real de búsqueda.
  }

  try {
    const response = await http.request({
      url: `${base}${PROXY_SEARCH_PATH}`,
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: { provider: 'duckduckgo', query: 'ping', count: 3, freshness: 'any' },
      timeoutMs: PROXY_TIMEOUT_MS,
    });
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, code: 'http_error', status: response.status };
  } catch {
    return { ok: false, code: 'network' };
  }
}
