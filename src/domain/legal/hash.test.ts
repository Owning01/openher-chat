import { describe, expect, it } from 'vitest';
import { createHasher, normalizeForDigest, sha256Hex } from './hash';

// Vectores conocidos (FIPS 180-4 / NIST) verificados contra Node `crypto`.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const LONG56_SHA256 = '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1';
const MILLION_A_SHA256 = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0';
// UTF-8 con acentos y ñ (multibyte, incluye 2, 3 y 4 bytes).
const ACENTOS_SHA256 = 'da90f73974bdf1ced45f4413349c5e08f1efcbeb4992d87f78c7b7ee9629f0dc';
const CAFE_SHA256 = '2fad93ccb63b9a36d118c62640be26cbd16c7a8bf5a9dc34e8a9671389e69b45';
const NANDU_SHA256 = '45cb9feba920d10dfa7f180063339eed6f9d077b02a01e0cb33ac167a95d511b';

describe('sha256Hex', () => {
  it('coincide con los vectores conocidos', () => {
    expect(sha256Hex('')).toBe(EMPTY_SHA256);
    expect(sha256Hex('abc')).toBe(ABC_SHA256);
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      LONG56_SHA256,
    );
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(MILLION_A_SHA256);
  });

  it('maneja UTF-8 con acentos, ñ y emoji', () => {
    expect(sha256Hex('áéíóúñ')).toBe(ACENTOS_SHA256);
    expect(sha256Hex('café con leche ☕')).toBe(CAFE_SHA256);
    expect(sha256Hex('El ñandú comió 3 empanadas de carne; costó $1.500,00.')).toBe(NANDU_SHA256);
  });

  it('devuelve hex minúsculas de 64 caracteres y es determinista', () => {
    const hash = sha256Hex('determinismo');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('determinismo')).toBe(hash);
  });
});

describe('createHasher', () => {
  it('sin crypto o sin subtle usa SHA-256 JS puro', () => {
    expect(createHasher()('abc')).toBe(ABC_SHA256);
    expect(createHasher(null)('abc')).toBe(ABC_SHA256);
    expect(createHasher({})('abc')).toBe(ABC_SHA256);
    expect(createHasher({ subtle: undefined })('abc')).toBe(ABC_SHA256);
  });

  it('ignora `crypto.subtle` (async) y mantiene la firma síncrona', () => {
    const fakeSubtle = {} as SubtleCrypto;
    const hasher = createHasher({ subtle: fakeSubtle });
    expect(typeof hasher('abc')).toBe('string');
    expect(hasher('áéíóúñ')).toBe(ACENTOS_SHA256);
  });
});

describe('normalizeForDigest', () => {
  it('recorta y colapsa espacios y tabs', () => {
    expect(normalizeForDigest('  Hola   mundo  ')).toBe('Hola mundo');
    expect(normalizeForDigest('a\t\tb')).toBe('a b');
  });

  it('normaliza saltos de línea y conserva los simples', () => {
    expect(normalizeForDigest('a\r\nb')).toBe('a\nb');
    expect(normalizeForDigest('a\rb')).toBe('a\nb');
    expect(normalizeForDigest('a\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeForDigest('\n\na\n\n')).toBe('a');
  });

  it('produce el mismo hash para variantes de formato no semánticas', () => {
    const variantA = 'ARTÍCULO 1.-  Quedan   obligados.\r\n\r\n\r\nFin.';
    const variantB = '  ARTÍCULO 1.- Quedan obligados.\n\nFin.  ';
    expect(sha256Hex(normalizeForDigest(variantA))).toBe(sha256Hex(normalizeForDigest(variantB)));
  });
});
