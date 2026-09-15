/**
 * Documentos del chat (M7): Word, PDF e imágenes. Puro y testeable; la
 * extracción real vive en `src/adapters/documents/*` con loaders inyectables.
 *
 * Decisión: `.docx` se extrae con `mammoth`, PDF con `pdfjs-dist` (capa de
 * texto + render de páginas escaneadas como fallback) y las imágenes se
 * comprimen con canvas nativo (sin dependencias). `.doc` binario viejo se
 * rechaza con aviso accionable: parsearlo exigiría otra librería pesada.
 */

/** Máximo de caracteres de texto extraído por documento; el resto se trunca y marca. */
export const MAX_DOCUMENT_CHARS = 60_000;

/** Máximo de bytes crudos aceptados por documento antes de extraer (cota de memoria en el móvil). */
export const MAX_DOCUMENT_BYTES = 20_000_000;

/** Máximo de páginas PDF a extraer por archivo (cota de tiempo en el móvil). */
export const MAX_PDF_PAGES = 40;

/** Máximo de páginas escaneadas a renderizar como imagen por PDF. */
export const MAX_PDF_RENDER_PAGES = 8;

/** Máximo de imágenes por mensaje (cota de contexto y de IndexedDB). */
export const MAX_IMAGES_PER_MESSAGE = 5;

/** Lado mayor máximo de una imagen comprimida (px). */
export const IMAGE_MAX_DIM = 1568;

/** Calidad JPEG de la compresión (0-1). */
export const IMAGE_JPEG_QUALITY = 0.82;

/** Máximo de bytes crudos aceptados por imagen antes de comprimir. */
export const MAX_IMAGE_BYTES = 8_000_000;

export type DocumentKind = 'text' | 'docx' | 'pdf' | 'image';

export type DocumentRejection = 'unsupported' | 'legacy-doc' | 'too-large' | 'too-many' | 'too-many-images';

/** Imagen lista para enviar: ya comprimida como dataUrl. */
export interface ImageDraft {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LEGACY_DOC_MIME = 'application/msword';

const IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp'];

/** Clasifica un archivo por mime/extensión. `null` = no soportado por el chat. */
export function classifyDocument(name: string, mime: string): DocumentKind | null {
  const normalizedMime = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalizedMime === DOCX_MIME || name.toLowerCase().endsWith('.docx')) return 'docx';
  if (normalizedMime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (IMAGE_MIMES.includes(normalizedMime)) return 'image';
  const lower = name.toLowerCase();
  if (IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'image';
  return null;
}

/** `true` si es un Word `.doc` binario viejo (sin parser en la app). */
export function isLegacyDoc(name: string, mime: string): boolean {
  const normalizedMime = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalizedMime === LEGACY_DOC_MIME) return true;
  const lower = name.toLowerCase();
  return lower.endsWith('.doc') && !lower.endsWith('.docx');
}

/** Recorta texto extraído al presupuesto y marca si hubo truncado. */
export function toDocumentDraftText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DOCUMENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true };
}

/** Bloque delimitado de un documento extraído para inyectar en el mensaje. */
export function formatDocumentBlock(sourceLabel: string, name: string, text: string, truncated: boolean): string {
  const body = truncated ? `${text}\n[…truncado]` : text;
  return `## ${sourceLabel}: ${name}\n\`\`\`\n${body}\n\`\`\``;
}
