/**
 * Markdown (subconjunto) → `.docx` real, sin dependencias.
 *
 * El modelo devuelve Markdown; este writer lo convierte a Word en el
 * dispositivo para descargar. ZIP manual con entradas STORED (sin compresión:
 * válido igual) + XML mínimo de Word (estilos built-in, listas con sangría
 * literal, tablas con bordes). Abre en Word, LibreOffice y visores Android.
 *
 * Alcance: títulos 1-3, párrafos, negrita/cursiva/código/enlaces en línea,
 * listas con un nivel de anidado arbitrario, tablas GFM, citas, `---`.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type InlineRun = { text: string; bold: boolean; italic: boolean; mono: boolean };

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'list'; ordered: boolean; depth: number; runs: InlineRun[] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'rule' }
  | { type: 'quote'; runs: InlineRun[] };

/** Caracteres que Word rechaza en el XML (rompen la apertura). */
function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function escapeXml(text: string): string {
  return sanitizeText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Divide en runs con formato; los marcadores sin par quedan literales. */
function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|\[[^\]\n]+\]\([^)\n]+\))/g;
  let position = 0;
  let match: RegExpExecArray | null;
  const push = (chunk: string, bold: boolean, italic: boolean, mono: boolean): void => {
    if (chunk !== '') runs.push({ text: chunk, bold, italic, mono });
  };
  while ((match = pattern.exec(text)) !== null) {
    push(text.slice(position, match.index), false, false, false);
    const token = match[0];
    if (token.startsWith('`')) {
      push(token.slice(1, -1), false, false, true);
    } else if (token.startsWith('**')) {
      push(token.slice(2, -2), true, false, false);
    } else if (token.startsWith('[')) {
      const label = /^\[([^\]]+)\]/.exec(token);
      push(label?.[1] ?? token, false, false, false);
    } else {
      push(token.slice(1, -1), false, true, false);
    }
    position = match.index + token.length;
  }
  push(text.slice(position), false, false, false);
  return runs.filter((run) => run.text !== '');
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && line[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) cells.shift();
  if (!trimmed.endsWith('|')) {
    cells.push(current.trim());
  } else if (current.trim() !== '') {
    cells.push(current.trim());
  }
  return cells;
}

function isSeparatorRow(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  return /^\|?[:|-]+\|?$/.test(compact) && compact.includes('-');
}

/** Bloques desde Markdown; líneas sueltas se unen al párrafo anterior. */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let inFence = false;
  let fence: string[] = [];

  const flushParagraph = (): void => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text !== '') blocks.push({ type: 'paragraph', runs: parseInline(text) });
  };
  const flushFence = (): void => {
    if (fence.length > 0) blocks.push({ type: 'code', text: fence.join('\n') });
    fence = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inFence) {
        inFence = false;
        flushFence();
      } else {
        inFence = true;
        flushParagraph();
      }
      index += 1;
      continue;
    }
    if (inFence) {
      fence.push(line);
      index += 1;
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading !== null) {
      flushParagraph();
      const level = Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, runs: parseInline((heading[2] ?? '').trim()) });
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote !== null) {
      flushParagraph();
      blocks.push({ type: 'quote', runs: parseInline((quote[1] ?? '').trim()) });
      index += 1;
      continue;
    }
    const bullet = /^([-*+])\s+(.+)$/.exec(trimmed);
    const numbered = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (bullet !== null || numbered !== null) {
      flushParagraph();
      const indent = line.match(/^ */)?.[0].length ?? 0;
      const depth = Math.floor(indent / 2);
      if (bullet !== null) {
        blocks.push({ type: 'list', ordered: false, depth, runs: parseInline((bullet[2] ?? '').trim()) });
      } else {
        const digits = numbered?.[1] ?? '1';
        blocks.push({
          type: 'list',
          ordered: true,
          depth,
          runs: [{ text: `${digits}. `, bold: false, italic: false, mono: false }, ...parseInline((numbered?.[2] ?? '').trim())],
        });
      }
      index += 1;
      continue;
    }
    if (trimmed.includes('|') && index + 1 < lines.length && isSeparatorRow(lines[index + 1] ?? '')) {
      flushParagraph();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim() !== '') {
        rows.push(splitTableRow((lines[index] ?? '').trim()));
        index += 1;
      }
      const width = Math.max(header.length, ...rows.map((row) => row.length));
      const pad = (row: string[]): string[] => [...row, ...Array<string>(Math.max(0, width - row.length)).fill('')];
      blocks.push({ type: 'table', header: pad(header), rows: rows.map(pad) });
      continue;
    }
    paragraph.push(trimmed);
    index += 1;
  }
  flushParagraph();
  if (inFence) flushFence();
  return blocks;
}

function runXml(run: InlineRun): string {
  const props: string[] = [];
  if (run.bold) props.push('<w:b/>');
  if (run.italic) props.push('<w:i/>');
  if (run.mono) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/>');
  const text = escapeXml(run.text);
  if (text === '') return '';
  return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraphXml(runs: InlineRun[], style: string, extraPr = ''): string {
  const body = runs.map(runXml).join('') || '<w:r><w:t xml:space="preserve"></w:t></w:r>';
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraPr}</w:pPr>${body}</w:p>`;
}

function blockXml(block: Block): string {
  switch (block.type) {
    case 'heading':
      return paragraphXml(block.runs, `Heading${block.level}`);
    case 'paragraph':
      return paragraphXml(block.runs, 'Normal');
    case 'quote':
      return paragraphXml(
        block.runs.map((run) => ({ ...run, italic: true })),
        'Normal',
        '<w:ind w:left="360"/>',
      );
    case 'list': {
      const left = 360 * (block.depth + 1);
      const bullet = block.ordered ? '' : '• ';
      const runs =
        bullet === '' ? block.runs : [{ text: bullet, bold: false, italic: false, mono: false }, ...block.runs];
      return paragraphXml(runs, 'Normal', `<w:ind w:left="${left}" w:hanging="180"/>`);
    }
    case 'code': {
      const lines = block.text.split('\n');
      return lines
        .map((line) =>
          paragraphXml(
            [{ text: line === '' ? ' ' : line, bold: false, italic: false, mono: true }],
            'Normal',
            '<w:shd w:fill="F2F2F2" w:val="clear"/>',
          ),
        )
        .join('');
    }
    case 'rule':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:color="999999" w:space="1" w:sz="6" w:val="single"/></w:pBdr></w:pPr></w:p>';
    case 'table': {
      const cell = (text: string, bold: boolean): string => {
        const runs = parseInline(text).map((run) => (bold ? { ...run, bold: true } : run));
        return `<w:tc><w:tcPr><w:tcW w:type="auto" w:w="0"/></w:tcPr>${paragraphXml(runs, 'Normal')}</w:tc>`;
      };
      const row = (cells: string[], isHeader: boolean): string =>
        `<w:tr>${cells.map((text) => cell(text, isHeader)).join('')}</w:tr>`;
      return (
        '<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/>' +
        '<w:tblBorders><w:top w:color="999999" w:space="0" w:sz="4" w:val="single"/>' +
        '<w:left w:color="999999" w:space="0" w:sz="4" w:val="single"/>' +
        '<w:bottom w:color="999999" w:space="0" w:sz="4" w:val="single"/>' +
        '<w:right w:color="999999" w:space="0" w:sz="4" w:val="single"/>' +
        '<w:insideH w:color="999999" w:space="0" w:sz="4" w:val="single"/>' +
        '<w:insideV w:color="999999" w:space="0" w:sz="4" w:val="single"/></w:tblBorders></w:tblPr>' +
        row(block.header, true) +
        block.rows.map((cells) => row(cells, false)).join('') +
        '</w:tbl>'
      );
    }
  }
}

const WORD_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Partes del `.docx` (XML plano): testeable sin tocar el ZIP. */
export function buildDocxParts(markdown: string): Record<string, string> {
  const blocks = parseBlocks(markdown);
  const body = blocks.length === 0 ? '<w:p/>' : blocks.map(blockXml).join('');
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>',
    'docProps/core.xml':
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:creator>OpenHer Chat</dc:creator>' +
      '<dc:title>Documento exportado</dc:title>' +
      '</cp:coreProperties>',
    'word/document.xml':
      `<?xml version="1.0" encoding="UTF-8"?><w:document ${WORD_NS}><w:body>${body}` +
      '<w:sectPr><w:pgSz w:h="16838" w:w="11906"/><w:pgMar w:bottom="1418" w:left="1418" w:right="1418" w:top="1418"/></w:sectPr>' +
      '</w:body></w:document>',
  };
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Bytes(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] as number ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pushU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

/**
 * ZIP mínimo con entradas STORED (sin compresión): válido para Word y no
 * necesita dependencias. Nombres ASCII, fechas fijas (salida determinista).
 */
function zipStored(parts: Record<string, Uint8Array>): Uint8Array {
  const bytes: number[] = [];
  const central: number[] = [];
  for (const [name, data] of Object.entries(parts)) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32Bytes(data);
    const localOffset = bytes.length;
    pushU32(bytes, 0x04034b50);
    pushU16(bytes, 20);
    pushU16(bytes, 0x0800);
    pushU16(bytes, 0);
    pushU16(bytes, 0x21);
    pushU16(bytes, 0x21);
    pushU32(bytes, crc);
    pushU32(bytes, data.length);
    pushU32(bytes, data.length);
    pushU16(bytes, nameBytes.length);
    pushU16(bytes, 0);
    for (const byte of nameBytes) bytes.push(byte);
    for (const byte of data) bytes.push(byte);

    pushU32(central, 0x02014b50);
    pushU16(central, 20);
    pushU16(central, 20);
    pushU16(central, 0x0800);
    pushU16(central, 0);
    pushU16(central, 0x21);
    pushU16(central, 0x21);
    pushU32(central, crc);
    pushU32(central, data.length);
    pushU32(central, data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU16(central, 0);
    pushU32(central, 0);
    pushU32(central, localOffset);
    for (const byte of nameBytes) central.push(byte);
  }
  const centralOffset = bytes.length;
  for (const byte of central) bytes.push(byte);
  pushU32(bytes, 0x06054b50);
  pushU16(bytes, 0);
  pushU16(bytes, 0);
  pushU16(bytes, Object.keys(parts).length);
  pushU16(bytes, Object.keys(parts).length);
  pushU32(bytes, central.length);
  pushU32(bytes, centralOffset);
  pushU16(bytes, 0);
  return new Uint8Array(bytes);
}

/**
 * Markdown → bytes `.docx` listos para descargar. Determinista: mismo input,
 * mismos bytes. Nunca lanza con strings (el XML se sanea).
 */
export function markdownToDocx(markdown: string): Uint8Array {
  const parts = buildDocxParts(typeof markdown === 'string' ? markdown : '');
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, xml] of Object.entries(parts)) encoded[name] = new TextEncoder().encode(xml);
  return zipStored(encoded);
}
