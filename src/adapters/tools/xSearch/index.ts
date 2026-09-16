/**
 * Tool `x_search`: acceso de lectura a X (Twitter) con la cuenta del dueño,
 * a través de un proxy propio (VPS con `xproxy/`, sesión configurada allí).
 *
 * Endpoints del proxy:
 *  - `GET /x/user-posts?user=<screenName>&count=<1..20>` — últimas publicaciones
 *    de una cuenta (lo más confiable).
 *  - `GET /x/feed?count=<1..20>` — timeline de inicio de la cuenta.
 *  - `GET /x/user?user=<screenName>` — perfil.
 *  - `POST /x/search` — búsqueda; best-effort (la API de X puede rechazarla).
 *
 * La tool no guarda credenciales: el proxy vive del lado del servidor.
 */
import type { HttpClient } from '@/domain/ports/HttpClient';
import type { ToolResult } from '@/domain/types/chat';
import type { ToolDefinition } from '@/domain/types/tools';

export const X_SEARCH_TOOL_NAME = 'x_search';
const X_TIMEOUT_MS = 45_000;
const X_MAX_RESULT_CHARS = 12_000;
const X_DEFAULT_COUNT = 10;
const X_MAX_COUNT = 20;

export interface XSearchDeps {
  http: HttpClient;
  /** Base del proxy X (p. ej. `https://zen.progajio.com/x-api`); sin barra final. */
  baseUrl: string;
  now?: () => number;
}

function normalizeBase(baseUrl: string): string | null {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function readCount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return X_DEFAULT_COUNT;
  return Math.min(X_MAX_COUNT, Math.max(1, Math.round(raw)));
}

function readString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** Recorta la respuesta a un tamaño razonable para el contexto del modelo. */
function truncate(text: string): string {
  if (text.length <= X_MAX_RESULT_CHARS) return text;
  return `${text.slice(0, X_MAX_RESULT_CHARS)}\n[…recortado]`;
}

export function createXSearchTool(deps: XSearchDeps): ToolDefinition {
  const base = normalizeBase(deps.baseUrl);
  if (base === null) throw new Error('x-search: baseUrl inválida');
  const now = deps.now ?? Date.now;

  return {
    name: X_SEARCH_TOOL_NAME,
    description:
      'Read recent posts from X (Twitter) using the user\'s own account. Use it for social signals during research: what a specific account said recently, or the user\'s home timeline. Prefer `user` (screen name, e.g. "elonmusk") because the search endpoint is unreliable. Returns JSON with post texts, authors, dates and metrics.',
    parameters: {
      type: 'object',
      properties: {
        user: {
          type: 'string',
          description:
            'X screen name (without @) to read recent posts from. When present, the tool returns that account\'s latest posts.',
        },
        query: {
          type: 'string',
          description:
            'Search terms (only used when `user` is absent). Best-effort: the X search API may reject it; in that case ask for a specific account instead.',
        },
        count: {
          type: 'integer',
          description: `How many posts to return (1-${X_MAX_COUNT}). Defaults to ${X_DEFAULT_COUNT}.`,
        },
        feed: {
          type: 'boolean',
          description: 'When true and no `user`/`query` is given, returns the account\'s home timeline.',
        },
      },
      required: [],
    },
    timeoutMs: X_TIMEOUT_MS,
    maxResultChars: X_MAX_RESULT_CHARS,
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const startedAt = now();
      const fail = (code: 'invalid_args' | 'network' | 'http_error', message: string): ToolResult => ({
        ok: false,
        content: message,
        error: { code, message },
        durationMs: Math.max(0, now() - startedAt),
      });

      const user = readString(args.user);
      const query = readString(args.query);
      const count = readCount(args.count);
      const feed = args.feed === true;
      if (user === null && query === null && !feed) {
        return fail('invalid_args', 'Falta indicar un usuario de X (`user`) para leer sus últimas publicaciones.');
      }

      const call = async (url: string, method: 'GET' | 'POST', body?: unknown): Promise<ToolResult> => {
        let response;
        try {
          response = await deps.http.request({
            url,
            method,
            headers: { Accept: 'application/json' },
            ...(body === undefined ? {} : { body }),
            timeoutMs: X_TIMEOUT_MS,
          });
        } catch {
          return fail('network', 'No se pudo conectar con el servicio de X.');
        }
        if (response.status < 200 || response.status >= 300) {
          return fail('http_error', `El servicio de X respondió HTTP ${response.status}: ${truncate(response.text)}`);
        }
        return {
          ok: true,
          content: truncate(response.text),
          provider: 'x',
          durationMs: Math.max(0, now() - startedAt),
        };
      };

      if (user !== null) {
        const encoded = encodeURIComponent(user.replace(/^@/, ''));
        return await call(`${base}/x/user-posts?user=${encoded}&count=${count}`, 'GET');
      }
      if (query !== null) {
        return await call(`${base}/x/search`, 'POST', { query, count, lang: 'es' });
      }
      return await call(`${base}/x/feed?count=${count}`, 'GET');
    },
  };
}
