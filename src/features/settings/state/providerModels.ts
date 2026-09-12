import type { ModelInfo } from '@/domain/types/provider';

/**
 * Fusiona el catálogo descubierto por API con los modelos previos: conserva los
 * overrides manuales (`contextWindow`, `supportsTools`, `supportsStreaming`) de los
 * modelos que siguen existiendo y mantiene los modelos agregados a mano.
 */
export function mergeApiModels(existing: readonly ModelInfo[], api: readonly ModelInfo[]): ModelInfo[] {
  const previousById = new Map(existing.map((model) => [model.id, model]));
  const merged: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of api) {
    const id = model.id.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);

    const previous = previousById.get(id);
    const next: ModelInfo = {
      id,
      label: model.label.trim() !== '' ? model.label : id,
      source: 'api',
    };
    const contextWindow = model.contextWindow ?? previous?.contextWindow;
    const supportsTools = model.supportsTools ?? previous?.supportsTools;
    const supportsStreaming = model.supportsStreaming ?? previous?.supportsStreaming;
    if (contextWindow !== undefined) next.contextWindow = contextWindow;
    if (supportsTools !== undefined) next.supportsTools = supportsTools;
    if (supportsStreaming !== undefined) next.supportsStreaming = supportsStreaming;
    merged.push(next);
  }

  for (const model of existing) {
    if (model.source !== 'manual' || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push({ ...model });
  }

  return merged;
}

/** Devuelve el default si sigue en el catálogo; si no, el primer modelo disponible. */
export function normalizeDefaultModelId(defaultModelId: string | null, models: readonly ModelInfo[]): string | null {
  if (defaultModelId !== null && models.some((model) => model.id === defaultModelId)) return defaultModelId;
  return models[0]?.id ?? null;
}
