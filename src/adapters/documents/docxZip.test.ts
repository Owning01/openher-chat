import { describe, expect, it } from 'vitest';

import { markdownToDocx } from './docxWriter';

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = TABLE[(crc ^ byte) & 0xff] as number ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

// Validación estructural independiente del ZIP (EOCD, offsets, CRCs con
// implementación propia): lo que Word va a parsear byte por byte.
describe('docx zip estructural', () => {
  it('EOCD + central directory + CRCs + offsets consistentes', () => {
    const md = '# Demanda\n\nContra **Quiroga**.\n\n- Uno\n- Dos\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
    const bytes = markdownToDocx(md);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) {
      if (u32(view, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThanOrEqual(0);
    const count = u16(view, eocd + 10);
    expect(count).toBe(4);
    let offset = u32(view, eocd + 16);
    const names: string[] = [];
    for (let entry = 0; entry < count; entry += 1) {
      expect(u32(view, offset)).toBe(0x02014b50);
      const method = u16(view, offset + 10);
      const crc = u32(view, offset + 16);
      const size = u32(view, offset + 24);
      const nameLen = u16(view, offset + 28);
      const extraLen = u16(view, offset + 30);
      const commentLen = u16(view, offset + 32);
      const localOffset = u32(view, offset + 42);
      const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLen));
      names.push(name);
      expect(method).toBe(0);
      expect(u32(view, localOffset)).toBe(0x04034b50);
      const localNameLen = u16(view, localOffset + 26);
      const localExtraLen = u16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const data = bytes.slice(dataStart, dataStart + size);
      expect(crc32(data)).toBe(crc);
      offset += 46 + nameLen + extraLen + commentLen;
    }
    expect(names).toContain('word/document.xml');
    expect(names).toContain('[Content_Types].xml');
  });
});
