/** Helpers de HTML sin dependencias, tolerantes a marcado malformado. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '\u00b7',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
};

/** Decodifica entidades numéricas (dec/hex) y las básicas con nombre. */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (match: string, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return isCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return isCodePoint(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/** Quita comentarios y tags y decodifica entidades (sin parser de DOM). */
export function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' '));
}

/** Colapsa todo whitespace a un espacio simple y recorta extremos. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Extrae atributos `nombre="valor"` / `nombre='valor'` / `nombre=valor` (claves en minúscula). */
export function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tag)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === '') continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function isCodePoint(code: number): boolean {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff;
}
