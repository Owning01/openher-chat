import type { HttpClient } from '@/domain/ports/HttpClient';
import type { SearchProvider } from '@/domain/ports/SearchProvider';
import type { SourceRef } from '@/domain/types/chat';
import { ToolExecutionError } from '../errors';
import { collapseWhitespace, decodeHtmlEntities, parseAttributes, stripTags } from '../html';
import { PROVIDER_TIMEOUT_MS } from './shared';

export const DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';

export interface DuckDuckGoProviderDeps {
  http: HttpClient;
  now: () => number;
}

export function createDuckDuckGoProvider(deps: DuckDuckGoProviderDeps): SearchProvider {
  return {
    id: 'duckduckgo',
    async search(input) {
      const params = new URLSearchParams();
      params.set('q', input.query);
      const response = await deps.http.request({
        url: `${DUCKDUCKGO_HTML_ENDPOINT}?${params.toString()}`,
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        timeoutMs: PROVIDER_TIMEOUT_MS,
        signal: input.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new ToolExecutionError('http_error', `DuckDuckGo responded with HTTP ${response.status}.`);
      }
      return parseDuckDuckGoResults(response.text, deps.now()).slice(0, input.maxResults);
    },
  };
}

/** Parser tolerante: usa DOMParser cuando existe y cae a regex si no (tests/entornos raros). */
export function parseDuckDuckGoResults(html: string, accessedAt: number): SourceRef[] {
  const domResults = parseWithDom(html, accessedAt);
  if (domResults !== null && domResults.length > 0) return domResults;
  const regexResults = parseWithRegex(html, accessedAt);
  if (regexResults.length > 0) return regexResults;
  return domResults ?? regexResults;
}

interface RawDuckDuckGoEntry {
  href: string | null;
  title: string;
  snippet: string;
}

function parseWithDom(html: string, accessedAt: number): SourceRef[] | null {
  if (typeof DOMParser === 'undefined') return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const anchors = Array.from(doc.querySelectorAll('a.result__a'));
  if (anchors.length === 0) return [];
  const entries = anchors.map((anchor): RawDuckDuckGoEntry => {
    const container = anchor.closest('.result, .web-result');
    const snippet = container?.querySelector('.result__snippet') ?? null;
    return {
      href: anchor.getAttribute('href'),
      title: anchor.textContent ?? '',
      snippet: snippet?.textContent ?? '',
    };
  });
  return buildSources(entries, accessedAt);
}

function parseWithRegex(html: string, accessedAt: number): SourceRef[] {
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const blocks: Array<{ entry: RawDuckDuckGoEntry; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] ?? '');
    if (!hasClass(attrs.class, 'result__a')) continue;
    blocks.push({
      entry: {
        href: decodeHtmlEntities(attrs.href ?? ''),
        title: stripTags(match[2] ?? ''),
        snippet: '',
      },
      start: match.index,
      end: anchorRegex.lastIndex,
    });
  }
  const entries = blocks.map((block, index) => {
    const nextStart = blocks[index + 1]?.start ?? html.length;
    return { ...block.entry, snippet: extractSnippet(html.slice(block.end, nextStart)) };
  });
  return buildSources(entries, accessedAt);
}

function extractSnippet(block: string): string {
  const containerRegex = /<(a|td|div|span)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = containerRegex.exec(block)) !== null) {
    const attrs = parseAttributes(match[2] ?? '');
    if (hasClass(attrs.class, 'result__snippet')) return stripTags(match[3] ?? '');
  }
  return '';
}

function buildSources(entries: RawDuckDuckGoEntry[], accessedAt: number): SourceRef[] {
  const sources: SourceRef[] = [];
  for (const entry of entries) {
    const url = resolveDuckDuckGoUrl(entry.href);
    if (url === null) continue;
    const title = collapseWhitespace(entry.title);
    const snippet = collapseWhitespace(entry.snippet);
    const source: SourceRef = { url, title: title === '' ? url : title, accessedAt };
    if (snippet !== '') source.snippet = snippet;
    sources.push(source);
  }
  return sources;
}

/** Resuelve links `//duckduckgo.com/l/?uddg=...` a su URL destino. */
export function resolveDuckDuckGoUrl(href: string | null): string | null {
  if (href === null || href.trim() === '') return null;
  const raw = href.trim();
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const parsed = new URL(absolute, 'https://duckduckgo.com');
    if (parsed.hostname === 'duckduckgo.com' || parsed.hostname.endsWith('.duckduckgo.com')) {
      const target = parsed.searchParams.get('uddg');
      if (target !== null && target.trim() !== '') return target;
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    return null;
  } catch {
    return null;
  }
}

function hasClass(value: string | undefined, className: string): boolean {
  return value !== undefined && value.split(/\s+/).includes(className);
}
