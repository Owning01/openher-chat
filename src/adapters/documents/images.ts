/**
 * Compresión de imágenes en el dispositivo (canvas nativo, sin dependencias).
 * Reduce fotos/capturas a un JPEG acotado para cuidar contexto e IndexedDB.
 * Sin canvas disponible (tests/jsdom) cae al dataUrl crudo con cota de tamaño.
 */
import { IMAGE_JPEG_QUALITY, IMAGE_MAX_DIM, MAX_IMAGE_BYTES } from '@/domain/documents/documents';

export interface CompressedImage {
  dataUrl: string;
  mime: string;
}

export interface ImageCompressEnv {
  createImageBitmap?: typeof createImageBitmap;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement | null;
  readAsDataUrl?: (blob: Blob) => Promise<string>;
}

/** Supera la cota cruda: el llamador lo traduce a rechazo `too-large`. */
export class ImageTooLargeError extends Error {
  constructor() {
    super('image-too-large');
    this.name = 'ImageTooLargeError';
  }
}

const SMALL_PASSTHROUGH_BYTES = 1_500_000;
const PASSTHROUGH_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

export async function compressImageFile(file: File, env: ImageCompressEnv = {}): Promise<CompressedImage> {
  if (file.size > MAX_IMAGE_BYTES) throw new ImageTooLargeError();
  const mime = file.type.toLowerCase().split(';')[0]?.trim() ?? '';

  const bitmap = await tryDecode(file, env.createImageBitmap);
  const canvasFactory = env.createCanvas ?? defaultCreateCanvas;
  if (bitmap === null || canvasFactory === undefined) {
    return { dataUrl: await readDataUrl(file, env.readAsDataUrl), mime: mime !== '' ? mime : 'image/jpeg' };
  }

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width <= 0 || height <= 0) {
      return { dataUrl: await readDataUrl(file, env.readAsDataUrl), mime: mime !== '' ? mime : 'image/jpeg' };
    }
    const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(width, height));
    if (scale === 1 && file.size <= SMALL_PASSTHROUGH_BYTES && PASSTHROUGH_MIMES.includes(mime)) {
      return { dataUrl: await readDataUrl(file, env.readAsDataUrl), mime };
    }
    const canvas = canvasFactory(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    if (canvas === null) {
      return { dataUrl: await readDataUrl(file, env.readAsDataUrl), mime: mime !== '' ? mime : 'image/jpeg' };
    }
    const context = canvas.getContext('2d');
    if (context === null) {
      return { dataUrl: await readDataUrl(file, env.readAsDataUrl), mime: mime !== '' ? mime : 'image/jpeg' };
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas);
    if (blob === null) {
      return { dataUrl: await readDataUrl(file, env.readAsDataUrl), mime: mime !== '' ? mime : 'image/jpeg' };
    }
    return { dataUrl: await readDataUrl(blob, env.readAsDataUrl), mime: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

async function tryDecode(
  file: File,
  createBitmap: typeof createImageBitmap | undefined,
): Promise<ImageBitmap | null> {
  if (createBitmap === undefined) return null;
  try {
    return await createBitmap(file);
  } catch {
    return null;
  }
}

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', IMAGE_JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

/**
 * dataUrl de un blob: `FileReader` primero (navegador, WebView y jsdom),
 * `arrayBuffer` + base64 como respaldo (Node sin DOM).
 */
async function readDataUrl(blob: Blob, readAsDataUrl?: (blob: Blob) => Promise<string>): Promise<string> {
  if (readAsDataUrl !== undefined) return readAsDataUrl(blob);
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('unreadable-image'));
      };
      reader.onerror = (): void => reject(reader.error ?? new Error('unreadable-image'));
      reader.readAsDataURL(blob);
    });
  }
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  const base64 = btoa(binary);
  const mime = blob.type !== '' ? blob.type : 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}
