// ---------------------------------------------------------------------------
// SHA-256 en JavaScript puro (FIPS 180-4), sin `crypto.subtle` ni dependencias.
// Todo el módulo es puro y determinista: misma entrada ⇒ mismo hex minúsculas.
// ---------------------------------------------------------------------------

/** Función de hashing síncrona inyectable (devuelve hex minúsculas). */
export type Hasher = (text: string) => string;

// Constantes de ronda K (primeros 32 bits de las raíces cúbicas de los primos).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// Estado inicial H (primeros 32 bits de las raíces cuadradas de los primos).
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** Rotación a la derecha de 32 bits, normalizada a unsigned. */
function rotr(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/** Codifica un string a bytes UTF-8 (sin `TextEncoder`, para ser autocontenido). */
function toUtf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Digest SHA-256 (32 bytes) de un buffer de bytes. */
function sha256Digest(bytes: Uint8Array): Uint8Array {
  const state = new Uint32Array(H0);
  const bitLength = bytes.length * 8;

  // Padding: 0x80 + ceros hasta que falten 8 bytes para un múltiplo de 64,
  // y la longitud en bits (64 bits big-endian) al final.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength % 0x100000000;
  padded[paddedLength - 8] = (high >>> 24) & 0xff;
  padded[paddedLength - 7] = (high >>> 16) & 0xff;
  padded[paddedLength - 6] = (high >>> 8) & 0xff;
  padded[paddedLength - 5] = high & 0xff;
  padded[paddedLength - 4] = (low >>> 24) & 0xff;
  padded[paddedLength - 3] = (low >>> 16) & 0xff;
  padded[paddedLength - 2] = (low >>> 8) & 0xff;
  padded[paddedLength - 1] = low & 0xff;

  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const base = offset + i * 4;
      schedule[i] =
        (((padded[base] ?? 0) << 24) |
          ((padded[base + 1] ?? 0) << 16) |
          ((padded[base + 2] ?? 0) << 8) |
          (padded[base + 3] ?? 0)) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = schedule[i - 15] ?? 0;
      const w2 = schedule[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      schedule[i] = ((schedule[i - 16] ?? 0) + s0 + (schedule[i - 7] ?? 0) + s1) >>> 0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;

    for (let i = 0; i < 64; i += 1) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + bigS1 + choose + (K[i] ?? 0) + (schedule[i] ?? 0)) >>> 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    const word = state[i] ?? 0;
    digest[i * 4] = (word >>> 24) & 0xff;
    digest[i * 4 + 1] = (word >>> 16) & 0xff;
    digest[i * 4 + 2] = (word >>> 8) & 0xff;
    digest[i * 4 + 3] = word & 0xff;
  }
  return digest;
}

/** Convierte bytes a hex minúsculas. */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * SHA-256 de un string codificado en UTF-8 (incluye acentos y ñ).
 * Devuelve hex minúsculas de 64 caracteres; determinista y sin IO.
 */
export function sha256Hex(text: string): string {
  return toHex(sha256Digest(toUtf8Bytes(text)));
}

/**
 * Normaliza un texto para calcular su `textHash` de forma estable frente a
 * diferencias de formato no semánticas:
 *  1. `\r\n` y `\r` se convierten en `\n`.
 *  2. Cada línea colapsa espacios/tabs repetidos a uno y se recorta (`trim`).
 *  3. Se colapsan 3 o más saltos consecutivos a una única línea en blanco.
 *  4. Se recortan las líneas en blanco al inicio y al final.
 * Los saltos simples entre líneas se preservan.
 */
export function normalizeForDigest(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Crea un hasher inyectable. La Web Crypto (`crypto.subtle.digest`) es
 * asíncrona y esta firma es síncrona, por lo que hoy siempre se resuelve con
 * la implementación JS pura (misma salida que Web Crypto). El parámetro queda
 * documentado como puerta abierta a un digest nativo síncrono futuro.
 */
export function createHasher(_cryptoRef?: { subtle?: SubtleCrypto } | null): Hasher {
  return sha256Hex;
}
