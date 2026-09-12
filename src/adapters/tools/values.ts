/** Type guards para respuestas JSON no confiables (`unknown` → forma estrecha). */

export type JsonObject = Record<string, unknown>;

export function asRecord(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

