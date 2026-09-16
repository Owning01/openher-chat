// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { extractPdf } from './pdf';

/**
 * Prueba con el pdfjs REAL y un PDF de verdad: cubre el entorno (p. ej. el
 * polyfill de `Uint8Array.prototype.toHex` que pdfjs 6 exige). Sin canvas
 * (jsdom): solo texto, igual que el Composer (no renderiza).
 */
describe('extractPdf con pdfjs real', () => {
  it('extrae el texto del recibo con marcas de página', async () => {
    const data = await readFile('src/adapters/documents/__fixtures__/recibo-alquiler.pdf');
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const pdf = await extractPdf('recibo-alquiler', buffer);
    expect(pdf.text).toContain('[página 1]');
    expect(pdf.text).toContain('RECIBO DE ALQUILER');
    expect(pdf.text).toContain('[página 2]');
    expect(pdf.text).toContain('DETALLE DE PAGOS');
    expect(pdf.truncatedPages).toBe(false);
  }, 30000);
});
