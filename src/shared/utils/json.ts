import type { Result } from './Result';
import { err, ok } from './Result';

/** JSON.parse sin throw: devuelve Result con Error legible. */
export function safeJsonParse<T>(text: string): Result<T, Error> {
  try {
    return ok(JSON.parse(text) as T);
  } catch (error) {
    return err(error instanceof Error ? error : new Error('Invalid JSON'));
  }
}

/**
 * Extrae el primer objeto JSON balanceado de un texto arbitrario (p. ej. el
 * output de un modelo con prosa alrededor). Ignora llaves dentro de strings y
 * respeta escapes. Devuelve `null` si no hay objeto balanceado.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** Recorta a `maxChars` conservando cabeza y cola unidas por un marcador. */
export function truncateMiddle(text: string, maxChars: number, marker = '…'): string {
  const limit = Math.max(0, Math.floor(maxChars));
  if (text.length <= limit) return text;
  if (limit <= marker.length) return marker.slice(0, limit);
  const keep = limit - marker.length;
  const headLength = Math.floor(keep * 0.6);
  const tailLength = keep - headLength;
  const tail = tailLength > 0 ? text.slice(text.length - tailLength) : '';
  return `${text.slice(0, headLength)}${marker}${tail}`;
}
