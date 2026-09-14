// ---------------------------------------------------------------------------
// Verificación de integridad de packs legales: hash del canon y textHash por
// provisión. Puro, sin IO y sin lanzar: los fallos degradan a `{ ok:false }`.
// ---------------------------------------------------------------------------

import { normalizeForDigest, sha256Hex, type Hasher } from '@/domain/legal/hash';
import { computePackHash } from '@/domain/legal/packs';
import type { LegalPack, LegalProvision } from '@/domain/types/legal';

/** Opciones de verificación; el hasher es inyectable (tests o digest nativo). */
export interface VerifyPackOptions {
  hasher?: Hasher;
}

/** Resultado de verificación: `ok` sólo si el hash y todos los textHash coinciden. */
export interface VerifyPackResult {
  ok: boolean;
  errors: string[];
}

/**
 * Verifica un pack ya parseado contra su propio hash y los `textHash` declarados:
 *  - `computePackHash(pack)` debe igualar `pack.hash`;
 *  - cada `provision.textHash` debe igualar `sha256Hex(normalizeForDigest(text))`.
 * Nunca lanza: una estructura hostil degrada a `ok:false` con un error explicable.
 */
export function verifyPack(pack: LegalPack, options: VerifyPackOptions = {}): VerifyPackResult {
  const hasher = options.hasher ?? sha256Hex;
  const errors: string[] = [];
  try {
    const expectedHash = computePackHash(pack, hasher);
    if (expectedHash !== pack.hash) {
      errors.push(
        `hash: no coincide con el canon (declarado ${pack.hash}, esperado ${expectedHash})`,
      );
    }
    if (!Array.isArray(pack.provisions)) {
      errors.push('provisions: array requerido');
    } else {
      pack.provisions.forEach((provision, index) => {
        verifyProvision(provision, index, hasher, errors);
      });
    }
  } catch {
    errors.push('pack: no se pudo verificar (estructura hostil)');
  }
  return { ok: errors.length === 0, errors };
}

/** Comprueba el `textHash` de una provisión y acumula el error si no coincide. */
function verifyProvision(
  provision: LegalProvision,
  index: number,
  hasher: Hasher,
  errors: string[],
): void {
  const expectedTextHash = hasher(normalizeForDigest(provision.text));
  if (expectedTextHash !== provision.textHash) {
    errors.push(
      `provisions[${index}].textHash: no coincide con el texto normalizado (${provision.id})`,
    );
  }
}
