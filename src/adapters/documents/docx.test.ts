import { describe, expect, it, vi } from 'vitest';

import { extractDocxMarkdown, extractDocxText } from './docx';

describe('extractDocxText', () => {
  it('devuelve el texto crudo del loader', async () => {
    const load = vi.fn(async () => ({
      extractRawText: vi.fn(async () => ({ value: 'Demanda\n/contra Gómez' })),
    }));
    const text = await extractDocxText(new ArrayBuffer(8), load);
    expect(text).toBe('Demanda\n/contra Gómez');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('propaga el fallo del loader (el llamador lo traduce a aviso)', async () => {
    const load = vi.fn(async () => {
      throw new Error('nope');
    });
    await expect(extractDocxText(new ArrayBuffer(8), load)).rejects.toThrow('nope');
  });

  it('en Node usa `buffer` primero (el build con `fs` no acepta arrayBuffer)', async () => {
    const seen: string[] = [];
    const extractRawText = vi.fn(async (input: unknown) => {
      const shape = (input as { arrayBuffer?: unknown }).arrayBuffer !== undefined ? 'arrayBuffer' : 'buffer';
      seen.push(shape);
      if (shape === 'arrayBuffer') throw new Error('Could not find file in options');
      return { value: 'texto por buffer' };
    });
    const load = vi.fn(async () => ({ extractRawText }));
    const text = await extractDocxText(new ArrayBuffer(8), load);
    expect(text).toBe('texto por buffer');
    expect(seen[0]).toBe('buffer');
  });

  it('ante otro error no reintenta y lo propaga', async () => {
    const extractRawText = vi.fn(async () => {
      throw new Error('docx corrupto');
    });
    const load = vi.fn(async () => ({ extractRawText }));
    await expect(extractDocxText(new ArrayBuffer(8), load)).rejects.toThrow('docx corrupto');
    expect(extractRawText).toHaveBeenCalledTimes(1);
  });
});

describe('extractDocxMarkdown', () => {
  it('devuelve Markdown estructural desde el HTML de mammoth', async () => {
    const convertToHtml = vi.fn(async () => ({
      value: '<h1>Demanda</h1><ul><li>Hecho uno</li></ul>',
    }));
    const load = vi.fn(async () => ({ extractRawText: vi.fn(), convertToHtml }));
    const markdown = await extractDocxMarkdown(new ArrayBuffer(8), load);
    expect(markdown).toBe('# Demanda\n\n- Hecho uno');
  });

  it('cae al texto crudo sin HTML disponible o con HTML vacío', async () => {
    const raw = vi.fn(async () => ({ value: 'texto crudo' }));
    const withoutHtml = vi.fn(async () => ({ extractRawText: raw }));
    await expect(extractDocxMarkdown(new ArrayBuffer(8), withoutHtml)).resolves.toBe('texto crudo');

    const emptyHtml = vi.fn(async () => ({
      extractRawText: raw,
      convertToHtml: vi.fn(async () => ({ value: '<div></div>' })),
    }));
    await expect(extractDocxMarkdown(new ArrayBuffer(8), emptyHtml)).resolves.toBe('texto crudo');
  });
});
