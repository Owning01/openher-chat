import { describe, expect, it } from 'vitest';
import { isErr, isOk } from './Result';
import { extractFirstJsonObject, safeJsonParse, truncateMiddle } from './json';

describe('safeJsonParse', () => {
  it('parsea JSON válido sin throw', () => {
    const result = safeJsonParse<{ a: number }>('{"a":1}');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toEqual({ a: 1 });
  });

  it('devuelve Error en JSON inválido', () => {
    const result = safeJsonParse('{oops');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBeInstanceOf(Error);
  });

  it('parsea primitivos y arrays', () => {
    expect(safeJsonParse<number[]>('[1,2]')).toEqual({ ok: true, value: [1, 2] });
    expect(safeJsonParse<null>('null')).toEqual({ ok: true, value: null });
  });
});

describe('extractFirstJsonObject', () => {
  it('extrae un objeto simple rodeado de prosa', () => {
    expect(extractFirstJsonObject('prefix {"a":1} suffix')).toBe('{"a":1}');
  });

  it('equilibra llaves anidadas', () => {
    expect(extractFirstJsonObject('x {"a":{"b":[1,2]},"c":{}} y')).toBe('{"a":{"b":[1,2]},"c":{}}');
  });

  it('ignora llaves dentro de strings y respeta escapes', () => {
    expect(extractFirstJsonObject('{"a":"}{ \\" b"}')).toBe('{"a":"}{ \\" b"}');
  });

  it('devuelve null sin objeto o sin balancear', () => {
    expect(extractFirstJsonObject('no braces')).toBeNull();
    expect(extractFirstJsonObject('{"a":1')).toBeNull();
    expect(extractFirstJsonObject('}{')).toBeNull();
  });

  it('devuelve el primer objeto cuando hay varios', () => {
    expect(extractFirstJsonObject('{"a":1} {"b":2}')).toBe('{"a":1}');
  });
});

describe('truncateMiddle', () => {
  it('devuelve intacto si cabe', () => {
    expect(truncateMiddle('abc', 5)).toBe('abc');
    expect(truncateMiddle('abc', 3)).toBe('abc');
  });

  it('conserva cabeza y cola alrededor del marcador', () => {
    expect(truncateMiddle('abcdefghij', 7)).toBe('abc…hij');
  });

  it('con límite menor al marcador recorta el marcador', () => {
    expect(truncateMiddle('abcdef', 1)).toBe('…');
    expect(truncateMiddle('abcdef', 0)).toBe('');
  });
});
