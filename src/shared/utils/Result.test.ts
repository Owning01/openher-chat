import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, mapResult, ok } from './Result';

describe('Result', () => {
  it('ok construye un éxito discriminado', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('err construye un fallo discriminado y estrecha el tipo', () => {
    const error = new Error('nope');
    const result = err(error);
    expect(result).toEqual({ ok: false, error });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toBe(error);
    if (isOk(result)) throw new Error('no debería ser ok');
  });

  it('mapResult transforma solo el valor exitoso', () => {
    expect(mapResult(ok(2), (value) => value * 2)).toEqual({ ok: true, value: 4 });
    const error = new Error('keep');
    const mapped = mapResult(err(error), (value: number) => value * 2);
    expect(mapped).toEqual({ ok: false, error });
  });
});
