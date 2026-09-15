/**
 * Adjuntos de texto del chat: lectura local sin dependencias.
 *
 * Decisión: sin librerías nuevas (PDF/DOCX/imágenes requieren parser externo)
 * sólo se aceptan archivos de texto plano (`.txt`, `.md`, `.json`, …). Se leen
 * con `File.text()` en el dispositivo y se inyectan delimitados en el mensaje;
 * pasan por redacción/consentimiento igual que el texto tipeado.
 */

/** Máximo de archivos de texto/documento por mensaje (cota de contexto). */
export const MAX_ATTACHMENTS = 10;

/** Máximo de caracteres por archivo; el resto se trunca y se marca. */
export const MAX_ATTACHMENT_CHARS = 30_000;

/** Extensiones de texto aceptadas (minúsculas, con punto). */
export const TEXT_EXTENSIONS: readonly string[] = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.py',
];

export interface AttachmentDraft {
  id: string;
  name: string;
  text: string;
  truncated: boolean;
  /** Etiqueta del bloque (`Archivo adjunto` por defecto; `Documento Word/PDF`). */
  sourceLabel?: string;
}

export type AttachmentRejection = 'unsupported' | 'too-many';

/** `true` si el archivo es texto legible sin dependencias (mime o extensión). */
export function isSupportedAttachment(name: string, mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Recorta al presupuesto y marca si hubo truncado (puro, testeable). */
export function toAttachmentDraft(id: string, name: string, text: string): AttachmentDraft {
  if (text.length <= MAX_ATTACHMENT_CHARS) return { id, name, text, truncated: false };
  return { id, name, text: text.slice(0, MAX_ATTACHMENT_CHARS), truncated: true };
}

/**
 * Lee un archivo como texto. Usa `File.text()` y cae a `FileReader` en
 * motores que no lo implementan (jsdom viejos, WebView antiguos).
 */
export function readAttachmentText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = (): void => reject(reader.error ?? new Error('unreadable'));
    reader.readAsText(file);
  });
}

/** Buffer de un archivo: `arrayBuffer()` con caída a `FileReader` (WebView antiguos). */
export function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('unreadable'));
    };
    reader.onerror = (): void => reject(reader.error ?? new Error('unreadable'));
    reader.readAsArrayBuffer(file);
  });
}

/** Bloque delimitado de un adjunto para inyectar en el mensaje. */
export function formatAttachmentBlock(attachment: AttachmentDraft): string {
  const body = attachment.truncated ? `${attachment.text}\n[…truncado]` : attachment.text;
  const label = attachment.sourceLabel ?? 'Archivo adjunto';
  return `## ${label}: ${attachment.name}\n\`\`\`\n${body}\n\`\`\``;
}

/** Mensaje final: borrador + bloques de adjuntos (el borrador puede ir vacío). */
export function composeMessageWithAttachments(draft: string, attachments: readonly AttachmentDraft[]): string {
  const blocks = attachments.map(formatAttachmentBlock);
  const trimmed = draft.trim();
  if (trimmed === '') return blocks.join('\n\n');
  if (blocks.length === 0) return draft;
  return `${trimmed}\n\n${blocks.join('\n\n')}`;
}
