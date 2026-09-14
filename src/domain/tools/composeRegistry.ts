/**
 * Composición pura de registries de tools.
 * `list()` concatena en orden y `get(name)` devuelve la primera coincidencia.
 */
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';

/** Compone varios registries en uno solo, sin mutar los originales. */
export function composeToolRegistries(...registries: ToolRegistry[]): ToolRegistry {
  return {
    list: () => registries.flatMap((registry) => registry.list()),
    get: (name: string): ToolDefinition | undefined => {
      for (const registry of registries) {
        const found = registry.get(name);
        if (found !== undefined) return found;
      }
      return undefined;
    },
  };
}
