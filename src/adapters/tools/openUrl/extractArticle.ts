/**
 * Extracción de artículo legible desde HTML. Usa `DOMParser` cuando existe y
 * cae a regex tolerante cuando no (entornos sin DOM / tests). Nunca ejecuta
 * scripts y colapsa whitespace. Cap por defecto: 8000 code points.
 */

import { collapseWhitespace, parseAttributes, stripTags } from '../html';

export const ARTICLE_TEXT_LIMIT = 8000;

export interface ExtractedArticle {
  title: string;
  description: string;
  text: string;
  truncated: boolean;
}

export interface ExtractArticleOptions {
  maxChars?: number;
}

export function extractArticle(html: string, options: ExtractArticleOptions = {}): ExtractedArticle {
  const limit = normalizeLimit(options.maxChars ?? ARTICLE_TEXT_LIMIT);
  if (typeof DOMParser !== 'undefined') {
    const fromDom = extractWithDom(html, limit);
    if (fromDom !== null) return fromDom;
  }
  return extractWithRegex(html, limit);
}

/** Corta a `maxChars` code points informando si hubo truncado (head simple). */
export function capArticleText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const limit = normalizeLimit(maxChars);
  const codePoints = Array.from(text);
  if (codePoints.length <= limit) return { text, truncated: false };
  return { text: codePoints.slice(0, limit).join(''), truncated: true };
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function extractWithDom(html: string, limit: number): ExtractedArticle | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const title = domTitle(doc);
  const description = metaContent(doc, ['description', 'og:description', 'twitter:description']) ?? '';
  const container = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;
  if (container === null) return { title, description, text: '', truncated: false };
  const noisy = Array.from(container.querySelectorAll('script,style,noscript,template,svg,iframe,canvas,form'));
  // Se reemplazan por un espacio (no se eliminan) para no pegar palabras vecinas:
  // `<p>Hola<script>…</script>Texto</p>` → "Hola Texto".
  for (const node of noisy) node.replaceWith(' ');
  const capped = capArticleText(collapseWhitespace(container.textContent ?? ''), limit);
  return { title, description, text: capped.text, truncated: capped.truncated };
}

function domTitle(doc: Document): string {
  return metaContent(doc, ['og:title', 'twitter:title']) ?? doc.title.trim();
}

function metaContent(doc: Document, keys: readonly string[]): string | null {
  for (const meta of Array.from(doc.querySelectorAll('meta'))) {
    const name = (meta.getAttribute('property') ?? meta.getAttribute('name') ?? '').toLowerCase();
    if (!keys.includes(name)) continue;
    const content = meta.getAttribute('content');
    if (content !== null && content.trim() !== '') return content.trim();
  }
  return null;
}

function extractWithRegex(html: string, limit: number): ExtractedArticle {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?(?:<\/noscript\s*>|$)/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?(?:<\/template\s*>|$)/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?(?:<\/svg\s*>|$)/gi, ' ')
    .replace(/<iframe\b[^>]*>[\s\S]*?(?:<\/iframe\s*>|$)/gi, ' ');
  const title = regexMetaContent(cleaned, ['og:title', 'twitter:title']) ?? regexTitleTag(cleaned);
  const description = regexMetaContent(cleaned, ['description', 'og:description', 'twitter:description']) ?? '';
  const region =
    regexRegion(cleaned, 'article') ?? regexRegion(cleaned, 'main') ?? regexRegion(cleaned, 'body') ?? cleaned;
  const capped = capArticleText(collapseWhitespace(stripTags(region)), limit);
  return { title, description, text: capped.text, truncated: capped.truncated };
}

function regexTitleTag(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return match === null ? '' : collapseWhitespace(stripTags(match[1] ?? ''));
}

function regexMetaContent(html: string, keys: readonly string[]): string | null {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const name = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (!keys.includes(name)) continue;
    const content = attrs.content;
    if (content !== undefined && content.trim() !== '') return collapseWhitespace(stripTags(content));
  }
  return null;
}

function regexRegion(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i');
  const match = regex.exec(html);
  return match === null ? null : match[1] ?? null;
}
