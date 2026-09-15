import { describe, expect, it, vi } from 'vitest';

import type { PdfJsDocument, PdfJsLib, PdfJsPage } from './pdf';
import { extractPdf } from './pdf';

function textPage(text: string): PdfJsPage {
  return {
    getTextContent: async () => ({ items: [{ str: text }] }),
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve() }),
  };
}

function fakeLib(pages: PdfJsPage[], numPages?: number): PdfJsLib {
  const doc: PdfJsDocument = {
    numPages: numPages ?? pages.length,
    getPage: async (pageNumber: number) => {
      const page = pages[pageNumber - 1];
      if (page === undefined) throw new Error('no-page');
      return page;
    },
  };
  return { getDocument: () => ({ promise: Promise.resolve(doc) }) };
}

describe('extractPdf', () => {
  it('extrae el texto con marcas de página', async () => {
    const load = vi.fn(async () => fakeLib([textPage('Demanda civil'), textPage('Prueba documental')]));
    const result = await extractPdf('expediente', new ArrayBuffer(8), load, { createCanvas: undefined });
    expect(result.text).toContain('[página 1]');
    expect(result.text).toContain('Demanda civil');
    expect(result.text).toContain('[página 2]');
    expect(result.truncatedPages).toBe(false);
    expect(result.emptyPages).toBe(0);
    expect(result.renderedImages).toEqual([]);
  });

  it('marca páginas escaneadas y las renderiza cuando no hay texto', async () => {
    const load = vi.fn(async () => fakeLib([textPage('   '), textPage('')]));
    const rendered: string[] = [];
    const createCanvas = vi.fn(() => {
      const canvas = {
        getContext: vi.fn(() => ({
          drawImage: vi.fn(),
        })),
        toDataURL: vi.fn(() => {
          rendered.push('page');
          return 'data:image/jpeg;base64,AAA';
        }),
      } as unknown as HTMLCanvasElement;
      return canvas;
    });
    const result = await extractPdf('escaneo', new ArrayBuffer(8), load, { createCanvas });
    expect(result.emptyPages).toBe(2);
    expect(result.text).toContain('sin texto extraíble');
    expect(rendered).toHaveLength(2);
    expect(result.renderedImages[0]?.name).toBe('escaneo-p1.jpg');
  });

  it('no renderiza cuando hay texto suficiente', async () => {
    const load = vi.fn(async () => fakeLib([textPage(`contenido largo ${'x'.repeat(300)}`)]));
    const createCanvas = vi.fn(() => null);
    const result = await extractPdf('doc', new ArrayBuffer(8), load, { createCanvas });
    expect(result.renderedImages).toEqual([]);
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it('marca el truncado cuando el PDF supera el máximo de páginas', async () => {
    const many = Array.from({ length: 45 }, (_, index) => textPage(`texto página ${index}`));
    const load = vi.fn(async () => fakeLib(many));
    const result = await extractPdf('largo', new ArrayBuffer(8), load, { createCanvas: undefined });
    expect(result.truncatedPages).toBe(true);
    expect(result.text).toContain('[página 40]');
    expect(result.text).not.toContain('[página 41]');
  });

  it('reconstruye líneas y párrafos con hasEOL', async () => {
    const page: PdfJsPage = {
      getTextContent: async () => ({
        items: [
          { str: 'Línea uno ', hasEOL: true },
          { str: 'Línea dos', hasEOL: true },
          { str: '', hasEOL: true },
          { str: 'Otro párrafo', hasEOL: true },
        ],
      }),
      getViewport: () => ({ width: 100, height: 100 }),
      render: () => ({ promise: Promise.resolve() }),
    };
    const load = vi.fn(async () => fakeLib([page]));
    const result = await extractPdf('doc', new ArrayBuffer(8), load, { createCanvas: undefined });
    expect(result.text).toContain('Línea uno\nLínea dos\n\nOtro párrafo');
  });
});
