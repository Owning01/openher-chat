/**
 * Extracción de PDF con `pdfjs-dist`: capa de texto por página (con marcas
 * `[página N]`) y render a JPEG de las páginas escaneadas sin texto.
 *
 * Sin worker configurado pdfjs corre en el hilo principal (fake worker): evita
 * empaquetar el worker en Vite/Capacitor a cambio de más CPU en PDFs largos,
 * acotado por `MAX_PDF_PAGES`. Todo corre en el dispositivo; nada se sube.
 */
import {
  IMAGE_JPEG_QUALITY,
  MAX_PDF_PAGES,
  MAX_PDF_RENDER_PAGES,
} from '@/domain/documents/documents';

export interface PdfJsTextItem {
  str?: unknown;
  /** pdfjs marca fin de línea; ausente en fakes viejos (se unen como antes). */
  hasEOL?: unknown;
}

export interface PdfJsViewport {
  width: number;
  height: number;
}

export interface PdfJsPage {
  getTextContent(): Promise<{ items: PdfJsTextItem[] }>;
  getViewport(options: { scale: number }): PdfJsViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }): {
    promise: Promise<void>;
  };
}

export interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
}

export interface PdfJsLib {
  getDocument(options: { data: Uint8Array }): { promise: Promise<PdfJsDocument> };
}

export type PdfJsLoader = () => Promise<PdfJsLib>;

async function defaultPdfJsLoader(): Promise<PdfJsLib> {
  const mod = await import('pdfjs-dist');
  return {
    getDocument: (options) => {
      const task = mod.getDocument({ data: options.data });
      return {
        promise: task.promise.then((doc) => ({
          numPages: doc.numPages,
          getPage: async (pageNumber: number): Promise<PdfJsPage> => {
            const page = await doc.getPage(pageNumber);
            return {
              getTextContent: async () => ({
                items: (await page.getTextContent()).items.map((item) => ({
                  str: 'str' in item && typeof item.str === 'string' ? item.str : undefined,
                  hasEOL: 'hasEOL' in item && item.hasEOL === true ? true : undefined,
                })),
              }),
              getViewport: (viewportOptions) => {
                const viewport = page.getViewport(viewportOptions);
                return { width: viewport.width, height: viewport.height };
              },
              render: (renderOptions) => ({
                promise: page
                  .render({
                    canvasContext: renderOptions.canvasContext,
                    viewport: page.getViewport({ scale: 1.5 }),
                    canvas: renderOptions.canvasContext.canvas,
                  })
                  .promise.then(() => undefined),
              }),
            };
          },
        })),
      };
    },
  };
}

export interface RenderedPdfPage {
  name: string;
  mime: string;
  dataUrl: string;
}

export interface ExtractedPdf {
  /** Texto de todas las páginas con marcas `[página N]`; puede ser `''`. */
  text: string;
  /** `true` si el PDF tenía más páginas que `MAX_PDF_PAGES`. */
  truncatedPages: boolean;
  /** Páginas sin texto extraíble (escaneadas). */
  emptyPages: number;
  /** Páginas escaneadas renderizadas a JPEG (máximo `MAX_PDF_RENDER_PAGES`). */
  renderedImages: RenderedPdfPage[];
}

export interface PdfRenderEnv {
  /** Crea un canvas; ausente (tests/jsdom) = sin render, sólo texto. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement | null;
}

/**
 * Texto de la página reconstruyendo líneas: los ítems pdfjs traen `hasEOL`
 * al terminar la línea visual y se preservan como `\n` (en Markdown es salto
 * suave; las líneas vacías separan párrafos). Sin `hasEOL` (fakes viejos) se
 * une como antes en una sola línea.
 */
function pageText(items: PdfJsTextItem[]): string {
  if (!items.some((item) => item.hasEOL === true)) {
    return joinWords(items);
  }
  const lines: string[] = [];
  let line: PdfJsTextItem[] = [];
  for (const item of items) {
    line.push(item);
    if (item.hasEOL === true) {
      lines.push(joinWords(line));
      line = [];
    }
  }
  if (line.length > 0) lines.push(joinWords(line));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function joinWords(items: PdfJsTextItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item.str === 'string' && item.str !== '') parts.push(item.str);
  }
  return parts.join('').replace(/[ \t]+/g, ' ').trim();
}

export async function extractPdf(
  baseName: string,
  data: ArrayBuffer,
  load: PdfJsLoader = defaultPdfJsLoader,
  env: PdfRenderEnv = {},
): Promise<ExtractedPdf> {
  const api = await load();
  const doc = await api.getDocument({ data: new Uint8Array(data) }).promise;
  const totalPages = Number.isFinite(doc.numPages) && doc.numPages > 0 ? Math.floor(doc.numPages) : 0;
  const pageCount = Math.min(totalPages, MAX_PDF_PAGES);

  const texts: string[] = [];
  const emptyPageNumbers: number[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const text = pageText((await page.getTextContent()).items);
    if (text === '') {
      emptyPageNumbers.push(pageNumber);
      texts.push(`[página ${pageNumber}]\n[sin texto extraíble: página escaneada o con imágenes]`);
    } else {
      texts.push(`[página ${pageNumber}]\n${text}`);
    }
  }

  const renderedImages: RenderedPdfPage[] = [];
  const createCanvas = env.createCanvas ?? defaultCreateCanvas;
  if (texts.join('\n').trim().length < 200 && emptyPageNumbers.length > 0 && createCanvas !== undefined) {
    for (const pageNumber of emptyPageNumbers.slice(0, MAX_PDF_RENDER_PAGES)) {
      const dataUrl = await renderPageToJpeg(doc, baseName, pageNumber, createCanvas).catch(() => null);
      if (dataUrl !== null) renderedImages.push(dataUrl);
    }
  }

  return {
    text: texts.join('\n\n'),
    truncatedPages: totalPages > pageCount,
    emptyPages: emptyPageNumbers.length,
    renderedImages,
  };
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

async function renderPageToJpeg(
  doc: PdfJsDocument,
  baseName: string,
  pageNumber: number,
  createCanvas: (width: number, height: number) => HTMLCanvasElement | null,
): Promise<RenderedPdfPage | null> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  if (canvas === null) return null;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
  if (!dataUrl.startsWith('data:image/jpeg')) return null;
  return { name: `${baseName}-p${pageNumber}.jpg`, mime: 'image/jpeg', dataUrl };
}
