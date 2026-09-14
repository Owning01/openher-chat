/**
 * Parser tolerante del catálogo de modelos expuesto por APIs OpenAI-compatible
 * (OpenAI, OpenCode Zen y compatibles). Compartido por los adapters para no
 * duplicar la normalización `{data|models:[...]}`.
 */

import type { ModelInfo } from '@/domain/types/provider';

/**
 * Convierte el body de `GET /models` en una lista de `ModelInfo`.
 * Nunca lanza: JSON inválido, formas inesperadas o entradas malformadas
 * degradan a `[]`. Deduplica por `id` preservando el orden de aparición.
 */
export function parseOpenAIModelList(text: string): ModelInfo[] {
  const parsed = parseJsonRecord(text);
  if (parsed === null) return [];
  const rawList = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : null;
  if (rawList === null) return [];

  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of rawList) {
    const record = asRecord(entry);
    if (record === null) continue;
    const rawId = record.id;
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const rawName = record.name;
    const label = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : id;
    models.push({ id, label, source: 'api' });
  }
  return models;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
