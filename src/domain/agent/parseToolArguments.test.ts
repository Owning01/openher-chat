import { describe, expect, it } from 'vitest';
import { parseToolArguments } from './parseToolArguments';

describe('parseToolArguments', () => {
  it('parsea un objeto JSON plano', () => {
    const result = parseToolArguments('{"query":"clima","count":3}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ query: 'clima', count: 3 });
  });

  it('ignora espacios alrededor', () => {
    const result = parseToolArguments('  \n\t{"url":"https://example.com"}  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ url: 'https://example.com' });
  });

  it('extrae el objeto aunque haya prosa alrededor', () => {
    const result = parseToolArguments('Claro, uso esta llamada: {"query":"x"} ¡listo!');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ query: 'x' });
  });

  it('limpia fences con lenguaje', () => {
    const result = parseToolArguments('```json\n{"query":"x","freshness":"week"}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ query: 'x', freshness: 'week' });
  });

  it('limpia fences sin lenguaje', () => {
    const result = parseToolArguments('```\n{"a":1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it('limpia fences en una sola línea', () => {
    const result = parseToolArguments('```{"a":1}```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it('respeta llaves dentro de strings', () => {
    const result = parseToolArguments('{"text":"cierre } y \\"llave\\"","nested":{"ok":true}}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ text: 'cierre } y "llave"', nested: { ok: true } });
  });

  it('devuelve error tipado con JSON inválido sin lanzar', () => {
    const result = parseToolArguments('{"query": oops}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not valid JSON');
  });

  it('devuelve error con texto vacío', () => {
    const result = parseToolArguments('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('empty');
  });

  it('devuelve error sin objeto JSON', () => {
    const result = parseToolArguments('"solo un string"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('no JSON object');
  });

  it('devuelve error con fence truncado', () => {
    const result = parseToolArguments('```json\n{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it('limpia un fence de cierre sin apertura', () => {
    const result = parseToolArguments('{"a":1} ```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it('conserva el texto si el cierre no es un fence puro', () => {
    const result = parseToolArguments('{"a":1}``` sobrante');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it('acepta fences cuya primera línea ya trae la llave', () => {
    const result = parseToolArguments('``` {"a":1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });
});
