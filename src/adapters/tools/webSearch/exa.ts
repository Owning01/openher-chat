/**
 * Proveedor Exa vía MCP, el mismo endpoint que usa OpenCode
 * (`https://mcp.exa.ai/mcp`). Es público (no requiere API key), habla JSON-RPC
 * 2.0 sobre HTTP y emite `Access-Control-Allow-Origin: *`, así que funciona
 * directamente desde el navegador sin proxy.
 *
 * La respuesta es SSE (`event: message` + `data: {result:{content:[{text}]}}`):
 * el texto trae un bloque por resultado con `Title/URL/Published/Author/Highlights`
 * separados por `---`.
 */

import type { HttpClient } from '@/domain/ports/HttpClient';
import type { SearchProvider } from '@/domain/ports/SearchProvider';
import type { SourceRef } from '@/domain/types/chat';
import { ToolExecutionError } from '../errors';
import { collapseWhitespace } from '../html';
import { asRecord } from '../values';
import { PROVIDER_TIMEOUT_MS } from './shared';

export const EXA_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';
export const EXA_SEARCH_TOOL = 'web_search_exa';

/** El bloque de highlights es largo; se recorta para el contexto del modelo. */
const MAX_SNIPPET_CHARS = 800;

export interface ExaProviderDeps {
  http: HttpClient;
  now: () => number;
  /** API key opcional: sube los límites del endpoint público (`?exaApiKey=`). */
  apiKey?: string | null;
}

export function createExaProvider(deps: ExaProviderDeps): SearchProvider {
  return {
    id: 'exa',
    async search(input) {
      const response = await deps.http.request({
        url: exaEndpoint(deps.apiKey),
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: EXA_SEARCH_TOOL,
            arguments: {
              query: input.query,
              type: 'auto',
              numResults: input.maxResults,
              livecrawl: 'fallback',
            },
          },
        },
        timeoutMs: PROVIDER_TIMEOUT_MS,
        signal: input.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new ToolExecutionError('http_error', `Exa search responded with HTTP ${response.status}.`);
      }
      const text = extractMcpText(response.text);
      if (text === null) {
        throw new ToolExecutionError('parse_error', 'Exa search returned an unexpected response.');
      }
      return parseExaResults(text, deps.now()).slice(0, input.maxResults);
    },
  };
}

function exaEndpoint(apiKey: string | null | undefined): string {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key === '') return EXA_MCP_ENDPOINT;
  return `${EXA_MCP_ENDPOINT}?exaApiKey=${encodeURIComponent(key)}`;
}

/** Extrae el texto del tool-result MCP desde JSON directo o desde frames SSE (`data:`). */
export function extractMcpText(body: string): string | null {
  const direct = extractTextFromFrame(body.trim());
  if (direct !== null) return direct;
  for (const line of body.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const payload = extractTextFromFrame(trimmed.slice('data:'.length).trim());
    if (payload !== null) return payload;
  }
  return null;
}

function extractTextFromFrame(json: string): string | null {
  if (!json.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  const result = root === null ? null : asRecord(root.result);
  const content = result === null ? null : result.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    const part = asRecord(item);
    const text = part === null ? null : part.text;
    if (typeof text === 'string' && text.trim() !== '') return text;
  }
  return null;
}

/** Parsea el texto de Exa (bloques separados por `---`) a `SourceRef[]`. */
export function parseExaResults(text: string, accessedAt: number): SourceRef[] {
  const sources: SourceRef[] = [];
  for (const block of text.split(/\n-{3,}\n/)) {
    const source = parseExaBlock(block.trim(), accessedAt);
    if (source !== null) sources.push(source);
  }
  return sources;
}

function parseExaBlock(block: string, accessedAt: number): SourceRef | null {
  if (block === '') return null;
  let title = '';
  let url = '';
  const highlights: string[] = [];
  let inHighlights = false;
  for (const line of block.split('\n')) {
    if (inHighlights) {
      highlights.push(line);
      continue;
    }
    if (line.startsWith('Title:')) {
      title = line.slice('Title:'.length).trim();
      continue;
    }
    if (line.startsWith('URL:')) {
      url = line.slice('URL:'.length).trim();
      continue;
    }
    if (line.startsWith('Highlights:')) inHighlights = true;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  const snippet = collapseWhitespace(highlights.join(' '));
  const source: SourceRef = { url, title: title === '' ? url : title, accessedAt };
  if (snippet !== '') {
    source.snippet = snippet.length > MAX_SNIPPET_CHARS ? `${snippet.slice(0, MAX_SNIPPET_CHARS)}…` : snippet;
  }
  return source;
}
