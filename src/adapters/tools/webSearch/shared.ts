import type { HttpClient, HttpRequest } from '@/domain/ports/HttpClient';
import { ToolExecutionError } from '../errors';

/** Timeout de red por request de proveedor (el tool timeout del registry es 15s). */
export const PROVIDER_TIMEOUT_MS = 15_000;

/** Ejecuta un request JSON y normaliza status/parseo a `ToolExecutionError`. */
export async function requestJson(http: HttpClient, request: HttpRequest, label: string): Promise<unknown> {
  const response = await http.request(request);
  if (response.status === 401 || response.status === 403) {
    throw new ToolExecutionError('no_provider', `${label} rejected the API key (HTTP ${response.status}). Check the key in Settings.`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ToolExecutionError('http_error', `${label} responded with HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new ToolExecutionError('parse_error', `${label} returned an invalid JSON response.`);
  }
}
