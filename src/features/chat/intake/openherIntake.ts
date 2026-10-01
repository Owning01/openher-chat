/**
 * Gancho de intake para integraciones externas (p. ej. la extensión del
 * navegador): reciben texto y capturas de pantalla y los dejan en el composer
 * sin que el usuario tenga que pegar nada.
 *
 * Contrato: `window.__openherIntake({ text?, imageDataUrl?, imageName?, source? })`
 * devuelve una promesa. Es aditivo: si no llega nada, no cambia el estado.
 *
 * Privacidad: el texto y la imagen se procesan en el dispositivo (el mismo
 * camino que un archivo soltado sobre el chat); nada sale a otro origen.
 */

export interface OpenHerIntakePayload {
  /** Texto a agregar al composer (típicamente la selección de otra pestaña). */
  text?: string;
  /** Captura PNG/JPEG/WebP en base64 (`data:image/...;base64,...`). */
  imageDataUrl?: string;
  /** Nombre sugerido para el archivo (por defecto `captura.png`). */
  imageName?: string;
  /** Origen del envío, sólo informativo. */
  source?: string;
}

export interface OpenHerIntakeDeps {
  /** Agrega texto al composer sin pisar lo que el usuario ya escribió. */
  appendText(next: string): void;
  /** Reusa el camino normal de adjuntos (compresión, límites y avisos). */
  addFiles(files: readonly File[]): Promise<void>;
}

declare global {
  interface Window {
    /** Presente sólo mientras la app está montada (se limpia al desmontar). */
    __openherIntake?: (payload: OpenHerIntakePayload) => Promise<void>;
  }
}

/** Tope defensivo: evita que un payload enorme bloquee el composer. */
export const MAX_INTAKE_CHARS = 20_000;

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Convierte un data URL de imagen en `File`; `null` si no es una imagen válida. */
export function imageDataUrlToFile(dataUrl: string, name: string): File | null {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (match === null) return null;
  const mime = match[1];
  const base64 = match[2];
  if (base64 === undefined) return null;
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const fileName = name.trim() === '' ? `captura.${extension}` : name;
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], fileName, { type: mime });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Normaliza un payload desconocido; devuelve `null` si no hay nada que hacer. */
export function normalizeIntakePayload(value: unknown): OpenHerIntakePayload | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, MAX_INTAKE_CHARS) : '';
  const imageDataUrl = typeof value.imageDataUrl === 'string' ? value.imageDataUrl.trim() : '';
  const imageName = typeof value.imageName === 'string' ? value.imageName : 'captura.png';
  const source = typeof value.source === 'string' ? value.source : undefined;
  if (text === '' && imageDataUrl === '') return null;
  return { text, imageDataUrl, imageName, source };
}

/**
 * Publica el gancho en `window` y devuelve el cleanup (lo borra al desmontar,
 * sólo si sigue siendo el nuestro).
 */
export function installOpenHerIntake(deps: OpenHerIntakeDeps): () => void {
  const handler = async (payload: OpenHerIntakePayload): Promise<void> => {
    const normalized = normalizeIntakePayload(payload);
    if (normalized === null) return;
    const files: File[] = [];
    const dataUrl = normalized.imageDataUrl ?? '';
    if (dataUrl !== '') {
      const file = imageDataUrlToFile(dataUrl, normalized.imageName ?? 'captura.png');
      if (file !== null) files.push(file);
    }
    if (files.length > 0) await deps.addFiles(files);
    const text = normalized.text ?? '';
    if (text !== '') deps.appendText(text);
  };
  window.__openherIntake = handler;
  return () => {
    if (window.__openherIntake === handler) delete window.__openherIntake;
  };
}
