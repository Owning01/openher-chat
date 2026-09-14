import { describe, expect, it } from 'vitest';
import type { ToolResult } from '@/domain/types/chat';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { composeToolRegistries } from './composeRegistry';

/** Tool mínima de prueba con `execute` determinista. */
function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object' },
    timeoutMs: 1,
    maxResultChars: 10,
    execute: (_args, _context): Promise<ToolResult> =>
      Promise.resolve({ ok: true, content: name, durationMs: 0 }),
  };
}

/** Registry en memoria con las tools indicadas (copia defensiva en `list`). */
function stubRegistry(names: string[]): ToolRegistry {
  const tools = names.map((name) => stubTool(name));
  return {
    list: () => [...tools],
    get: (name: string): ToolDefinition | undefined => tools.find((tool) => tool.name === name),
  };
}

describe('composeToolRegistries', () => {
  it('concatena list() en orden', () => {
    const composed = composeToolRegistries(stubRegistry(['a', 'b']), stubRegistry(['c']));
    expect(composed.list().map((tool) => tool.name)).toEqual(['a', 'b', 'c']);
  });

  it('get() devuelve la primera coincidencia ante colisión de nombres', () => {
    const first = stubTool('dup');
    const second = stubTool('dup');
    const composed = composeToolRegistries(
      { list: () => [first], get: (name: string) => (name === 'dup' ? first : undefined) },
      { list: () => [second], get: (name: string) => (name === 'dup' ? second : undefined) },
    );
    expect(composed.get('dup')).toBe(first);
    expect(composed.list()).toHaveLength(2);
  });

  it('tolera registries vacíos y nombres ausentes', () => {
    const composed = composeToolRegistries(stubRegistry([]), stubRegistry(['a']), stubRegistry([]));
    expect(composed.list().map((tool) => tool.name)).toEqual(['a']);
    expect(composed.get('nope')).toBeUndefined();
    expect(composeToolRegistries().list()).toEqual([]);
    expect(composeToolRegistries().get('a')).toBeUndefined();
  });
});
