/**
 * HTML estructural (el que emite mammoth para `.docx`) → Markdown compacto
 * para la IA: consume menos tokens que el HTML y conserva lo que el texto
 * crudo pierde (títulos, listas, tablas). Puro, sin dependencias, nunca
 * lanza con input desconocido (las etiquetas raras se degradan a texto).
 *
 * Alcance deliberado: h1-h6, párrafos, listas (anidadas), citas, tablas GFM,
 * negrita/cursiva/enlaces/código en línea e imágenes como placeholder. Sin
 * estilos, clases, footnotes ni scripts.
 */

interface Token {
  kind: 'open' | 'close' | 'text';
  name: string;
  attrs: string;
  text: string;
}

const VOID_ELEMENTS = new Set(['br', 'hr', 'img']);

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?\/?>|([^<>]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[3] !== undefined) {
      tokens.push({ kind: 'text', name: '', attrs: '', text: match[3] });
      continue;
    }
    const name = (match[1] ?? '').toLowerCase();
    const isClose = match[0].startsWith('</');
    const selfClosed = match[0].endsWith('/>') || VOID_ELEMENTS.has(name);
    if (!isClose) tokens.push({ kind: 'open', name, attrs: match[2] ?? '', text: '' });
    if (isClose || selfClosed) tokens.push({ kind: 'close', name, attrs: '', text: '' });
  }
  return tokens;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => safeChar(Number(digits)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeChar(parseInt(hex, 16)));
}

/** Punto de código válido o reemplazo (una entidad rota no tumba el documento). */
function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '�';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '�';
  }
}

function readAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (match === null) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function collapseSpaces(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ');
}

interface Cursor {
  tokens: Token[];
  position: number;
}

function peek(cursor: Cursor): Token | null {
  return cursor.tokens[cursor.position] ?? null;
}

/** Texto en línea hasta el cierre indicado (o fin); etiquetas de bloque se ignoran. */
function parseInline(cursor: Cursor, stopName: string | null): string {
  const parts: string[] = [];
  for (;;) {
    const token = peek(cursor);
    if (token === null) break;
    if (token.kind === 'close') {
      // `<b>`/`</b>` y `<i>`/`</i>` cierran como strong/em (mammoth normaliza,
      // pero un HTML ajeno puede traer cualquiera de las dos formas).
      const name = token.name === 'b' ? 'strong' : token.name === 'i' ? 'em' : token.name;
      if (stopName !== null && name === stopName) {
        cursor.position += 1;
        break;
      }
      cursor.position += 1;
      continue;
    }
    if (token.kind === 'text') {
      parts.push(collapseSpaces(token.text));
      cursor.position += 1;
      continue;
    }
    // open
    cursor.position += 1;
    if (token.name === 'script' || token.name === 'style' || token.name === 'noscript' || token.name === 'template') {
      skipTag(cursor, token.name);
      continue;
    }
    switch (token.name) {
      case 'br':
        parts.push('\n');
        break;
      case 'strong':
      case 'b': {
        const inner = parseInline(cursor, 'strong').trim();
        parts.push(inner === '' ? '' : `**${inner}**`);
        break;
      }
      case 'em':
      case 'i': {
        const inner = parseInline(cursor, 'em').trim();
        parts.push(inner === '' ? '' : `*${inner}*`);
        break;
      }
      case 'code': {
        const inner = parseInline(cursor, 'code').trim();
        parts.push(inner === '' ? '' : `\`${inner}\``);
        break;
      }
      case 'a': {
        const href = readAttr(token.attrs, 'href');
        const inner = parseInline(cursor, 'a').trim();
        parts.push(href !== null && inner !== '' ? `[${inner}](${href})` : inner);
        break;
      }
      case 'img': {
        const alt = readAttr(token.attrs, 'alt') ?? readAttr(token.attrs, 'src');
        parts.push(alt !== null && alt.trim() !== '' ? `[imagen: ${alt.trim()}]` : '[imagen]');
        break;
      }
      default:
        parts.push(parseInline(cursor, token.name));
        break;
    }
  }
  return parts.join('').replace(/ +/g, ' ');
}

/** Bloques hasta un cierre (`stopName`) o fin del stream. */
function parseBlocks(cursor: Cursor, stopName: string | null, listDepth: number): string[] {
  const blocks: string[] = [];
  for (;;) {
    const token = peek(cursor);
    if (token === null) return blocks;
    if (token.kind === 'close') {
      cursor.position += 1;
      if (stopName !== null && token.name === stopName) return blocks;
      continue;
    }
    if (token.kind === 'text') {
      const text = collapseSpaces(token.text).trim();
      cursor.position += 1;
      if (text !== '') blocks.push(text);
      continue;
    }
    cursor.position += 1;
    const name = token.name;
    if (name === 'script' || name === 'style' || name === 'noscript' || name === 'template') {
      skipTag(cursor, name);
    } else if (/^h[1-6]$/.test(name)) {
      const level = Number(name.slice(1));
      const inner = parseInline(cursor, name).trim();
      if (inner !== '') blocks.push(`${'#'.repeat(level)} ${inner}`);
    } else if (name === 'p' || name === 'div' || name === 'section' || name === 'article') {
      const inner = parseInline(cursor, name).trim();
      if (inner !== '') blocks.push(inner);
    } else if (name === 'blockquote') {
      const inner = parseBlocks(cursor, 'blockquote', listDepth)
        .map((line) => `> ${line}`)
        .join('\n');
      if (inner.trim() !== '') blocks.push(inner);
    } else if (name === 'ul' || name === 'ol') {
      const items = parseList(cursor, name, listDepth);
      if (items.length > 0) blocks.push(items.join('\n'));
    } else if (name === 'table') {
      const table = parseTable(cursor);
      if (table !== null) blocks.push(table);
    } else if (name === 'pre') {
      const inner = parseInline(cursor, 'pre').trim();
      if (inner !== '') blocks.push(`\`\`\`\n${inner}\n\`\`\``);
    } else if (name === 'hr') {
      blocks.push('---');
    } else if (name === 'br') {
      continue;
    } else {
      // span, sup, sub, small…: contenido en línea dentro del flujo.
      const inner = parseInline(cursor, name).trim();
      if (inner !== '') blocks.push(inner);
    }
  }
}

/** Salta un tag completo sin emitir nada (scripts, estilos). */
function skipTag(cursor: Cursor, name: string): void {
  let depth = 1;
  for (;;) {
    const token = peek(cursor);
    if (token === null) return;
    cursor.position += 1;
    if (token.kind === 'open' && token.name === name) depth += 1;
    if (token.kind === 'close' && token.name === name) {
      depth -= 1;
      if (depth === 0) return;
    }
  }
}

function parseList(cursor: Cursor, listName: string, depth: number): string[] {
  const items: string[] = [];
  let counter = 0;
  for (;;) {
    const token = peek(cursor);
    if (token === null) return items;
    if (token.kind === 'close' && token.name === listName) {
      cursor.position += 1;
      return items;
    }
    if (token.kind === 'open' && token.name === 'li') {
      cursor.position += 1;
      counter += 1;
      const prefix = listName === 'ol' ? `${counter}.` : '-';
      items.push(...parseListItem(cursor, prefix, depth));
      continue;
    }
    cursor.position += 1;
  }
}

function parseListItem(cursor: Cursor, prefix: string, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const head: string[] = [];
  const nested: string[] = [];
  for (;;) {
    const token = peek(cursor);
    if (token === null) return flushListItem(indent, prefix, head, nested);
    if (token.kind === 'close' && token.name === 'li') {
      cursor.position += 1;
      return flushListItem(indent, prefix, head, nested);
    }
    if (token.kind === 'open' && (token.name === 'ul' || token.name === 'ol')) {
      cursor.position += 1;
      nested.push(...parseList(cursor, token.name, depth + 1));
      continue;
    }
    if (token.kind === 'open' && token.name === 'p') {
      cursor.position += 1;
      const inner = parseInline(cursor, 'p').trim();
      if (inner !== '') head.push(inner);
      continue;
    }
    if (token.kind === 'text') {
      const text = collapseSpaces(token.text).trim();
      cursor.position += 1;
      if (text !== '') head.push(text);
      continue;
    }
    cursor.position += 1;
  }
}

function flushListItem(indent: string, prefix: string, head: string[], nested: string[]): string[] {
  const first = head.join(' ').trim();
  if (first === '' && nested.length === 0) return [];
  if (first === '') return nested;
  return [`${indent}${prefix} ${first}`, ...nested];
}

function parseTable(cursor: Cursor): string | null {
  const rows: string[][] = [];
  let current: string[] | null = null;
  for (;;) {
    const token = peek(cursor);
    if (token === null || (token.kind === 'close' && token.name === 'table')) {
      if (token !== null) cursor.position += 1;
      break;
    }
    if (token.kind === 'open' && (token.name === 'td' || token.name === 'th')) {
      const cellName = token.name;
      cursor.position += 1;
      const cell = parseInline(cursor, cellName).replace(/\n+/g, '; ').trim();
      current ??= [];
      current.push(cell.replace(/\|/g, '\\|'));
      continue;
    }
    if (token.kind === 'close' && token.name === 'tr') {
      cursor.position += 1;
      if (current !== null && current.some((cell) => cell !== '')) rows.push(current);
      current = null;
      continue;
    }
    cursor.position += 1;
  }
  const kept = rows.filter((row) => row.length > 0);
  if (kept.length === 0) return null;
  const width = Math.max(...kept.map((row) => row.length));
  const padded = kept.map((row) => [...row, ...Array<string>(Math.max(0, width - row.length)).fill('')]);
  const header = padded[0] ?? [];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...padded.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * Convierte HTML estructural a Markdown compacto. Entrada vacía o sin texto
 * → `''` (el llamador cae al texto crudo). Nunca lanza.
 */
export function htmlToMarkdown(html: string): string {
  if (typeof html !== 'string' || html.trim() === '') return '';
  try {
    const blocks = parseBlocks({ tokens: tokenize(html), position: 0 }, null, 0);
    return blocks
      .map((block) => block.replace(/[ \t]+\n/g, '\n').trim())
      .filter((block) => block !== '')
      .join('\n\n');
  } catch {
    return '';
  }
}
