import type { Result } from '../../shared/utils/Result';
import { err, ok } from '../../shared/utils/Result';
import { extractFirstJsonObject, safeJsonParse } from '../../shared/utils/json';

export type ToolArguments = Record<string, unknown>;

/**
 * Convierte el texto de argumentos emitido por el modelo en un objeto JSON.
 * Limpia fences markdown y espacios, extrae el primer objeto balanceado y
 * devuelve un `Result`; nunca lanza.
 */
export function parseToolArguments(text: string): Result<ToolArguments, Error> {
  const cleaned = stripCodeFences(text);
  if (cleaned === '') return err(new Error('tool arguments are empty'));

  const objectText = extractFirstJsonObject(cleaned);
  if (objectText === null) return err(new Error('tool arguments contain no JSON object'));

  const parsed = safeJsonParse<unknown>(objectText);
  if (!parsed.ok) return err(new Error(`tool arguments are not valid JSON: ${parsed.error.message}`));

  // `extractFirstJsonObject` solo devuelve texto que empieza con `{`; si parsea, es un objeto.
  return ok(parsed.value as ToolArguments);
}

/** Quita un fence ```...``` inicial (con o sin lenguaje) y otro final si existen. */
function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const body = cleaned.slice(3);
    const newline = body.indexOf('\n');
    let inner: string;
    if (newline === -1) {
      inner = body;
    } else {
      const firstLine = body.slice(0, newline);
      inner = firstLine.includes('{') ? body : body.slice(newline + 1);
    }
    const closing = inner.lastIndexOf('```');
    cleaned = closing === -1 ? inner : inner.slice(0, closing);
  } else {
    const closing = cleaned.lastIndexOf('```');
    if (closing !== -1 && cleaned.slice(closing).trim() === '```') cleaned = cleaned.slice(0, closing);
  }
  return cleaned.trim();
}
