import type { ModelInfo } from '@/domain/types/provider';

/**
 * Catálogo de modelos gratuitos (Free tier) provistos por el gateway OpenCode Zen.
 * Permiten conversar e investigar sin costo o consumo de cuota paga.
 */
export const ZEN_FREE_MODELS: readonly ModelInfo[] = [
  { id: 'deepseek-v4-flash-free', label: 'DeepSeek V4 Flash (Free)', source: 'manual', supportsTools: true },
  { id: 'mimo-v2.5-free', label: 'MiMo-V2.5 (Free)', source: 'manual', supportsTools: true },
  { id: 'longcat-2.0-free', label: 'LongCat 2.0 (Free)', source: 'manual', supportsTools: true },
  { id: 'nemotron-3-ultra-free', label: 'Nemotron 3 Ultra (Free)', source: 'manual', supportsTools: true },
  { id: 'ling-3.0-tiny-free', label: 'Ling 3.0 Tiny (Free)', source: 'manual', supportsTools: true },
  { id: 'laguna-s-2.1-free', label: 'Laguna S 2.1 (Free)', source: 'manual', supportsTools: true },
  { id: 'north-mini-code-free', label: 'North Mini Code (Free)', source: 'manual', supportsTools: true },
  { id: 'big-pickle', label: 'Big Pickle (Free)', source: 'manual', supportsTools: true },
  { id: 'muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor (Free)', source: 'manual', supportsTools: true },
  { id: 'muse-spark-1.2-contributor', label: 'Muse Spark 1.2 Contributor (Free)', source: 'manual', supportsTools: true },
];

/** Determina si un id de modelo corresponde al tier gratuito de Zen. */
export function isZenFreeModel(modelId: string): boolean {
  const id = modelId.toLowerCase().trim();
  return (
    id.includes('-free') ||
    id.endsWith('free') ||
    id === 'big-pickle' ||
    id.startsWith('muse-spark')
  );
}

/**
 * Asegura que los modelos free de Zen estén presentes en la lista de modelos
 * del proveedor OpenCode Zen, preservando cualquier modelo adicional descubierto.
 */
export function ensureZenFreeModels(models: readonly ModelInfo[]): ModelInfo[] {
  const result: ModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    const key = model.id.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      const isFree = isZenFreeModel(model.id);
      result.push({
        ...model,
        label: isFree && !model.label.toLowerCase().includes('free') ? `${model.label} (Free)` : model.label,
      });
    }
  }

  for (const freeModel of ZEN_FREE_MODELS) {
    const key = freeModel.id.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...freeModel });
    }
  }

  return result;
}
