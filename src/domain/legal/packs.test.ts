import { describe, expect, it } from 'vitest';
import { normalizeForDigest, sha256Hex, type Hasher } from './hash';
import {
  computePackHash,
  isProvisionValid,
  packDigestInput,
  parseLegalPack,
  validateLegalPack,
} from './packs';
import type { LegalPack, LegalProvision } from '../types/legal';

const PROVISION_TEXT = 'ARTÍCULO 2560.- El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.';
const SOURCE_URL = 'https://servicios.infoleg.gob.ar/infolegInternet/anexos/235000-239999/235975/norma.htm';

function textHashOf(text: string): string {
  return sha256Hex(normalizeForDigest(text));
}

function makeValidProvision(): LegalProvision {
  return {
    id: 'CCyC-2560',
    normId: 'CCyC',
    article: '2560',
    title: 'Prescripción liberatoria',
    text: PROVISION_TEXT,
    jurisdiction: 'national',
    sourceUrl: SOURCE_URL,
    sourceDate: '2026-01-05',
    textHash: textHashOf(PROVISION_TEXT),
    verificationMethod: 'manual',
    curatedBy: 'openher',
    curatedAt: '2026-01-06',
    tags: ['prescripcion', 'obligaciones'],
    synonyms: ['prescribe'],
    verified: true,
  };
}

function makeValidPack(): LegalPack {
  const pack: LegalPack = {
    schema: 'openher.legal.pack/1',
    id: 'ar-ccyc-core',
    title: 'CCyC núcleo',
    version: '1.0.0',
    publishedAt: '2026-01-15',
    jurisdiction: 'national',
    matter: 'civil-commercial',
    license: {
      name: 'Boletín Oficial',
      url: 'https://www.boletinoficial.gob.ar/',
      attribution: 'Texto oficial de dominio público',
      verifiedAt: '2026-01-10',
    },
    sources: [{ url: SOURCE_URL, retrievedAt: '2026-01-05', note: 'texto vigente' }],
    norms: [
      {
        id: 'CCyC',
        short: 'CCyC',
        long: 'Código Civil y Comercial de la Nación',
        aliases: ['CCCN', 'Código Civil y Comercial'],
        jurisdiction: 'national',
        sourceUrl: SOURCE_URL,
      },
      {
        id: 'CPCCN',
        short: 'CPCCN',
        long: 'Código Procesal Civil y Comercial de la Nación',
        jurisdiction: 'national',
      },
    ],
    provisions: [makeValidProvision()],
    hash: '',
  };
  return { ...pack, hash: computePackHash(pack) };
}

/** Copia cruda (keys arbitrarias) para inyectar campos inválidos sin pelear con el tipo. */
function packRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(makeValidPack())) as Record<string, unknown>;
}

function provisionsOf(record: Record<string, unknown>): Record<string, unknown>[] {
  return record.provisions as Record<string, unknown>[];
}

/** Invierte recursivamente el orden de inserción de las claves. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) out[key] = reverseKeys(nested);
    return out;
  }
  return value;
}

describe('packDigestInput / computePackHash', () => {
  it('es estable y no depende del orden de claves del objeto', () => {
    const pack = makeValidPack();
    const reordered = reverseKeys(pack) as LegalPack;
    expect(packDigestInput(pack)).toBe(packDigestInput(reordered));
    expect(packDigestInput(pack)).toBe(packDigestInput(makeValidPack()));
  });

  it('computePackHash es el sha256 del canon', () => {
    const pack = makeValidPack();
    expect(computePackHash(pack)).toBe(sha256Hex(packDigestInput(pack)));
    expect(computePackHash(pack)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('acepta un hasher inyectable', () => {
    const fixed: Hasher = () => 'fixed-digest';
    expect(computePackHash(makeValidPack(), fixed)).toBe('fixed-digest');
  });

  it('excluye `hash` y `title` (contrato del canon) pero incluye license/sources/publishedAt', () => {
    const pack = makeValidPack();
    const base = packDigestInput(pack);

    expect(packDigestInput({ ...pack, hash: 'otro-hash' })).toBe(base);
    expect(packDigestInput({ ...pack, title: 'Otro título' })).toBe(base);

    expect(packDigestInput({ ...pack, publishedAt: '2026-02-01' })).not.toBe(base);
    expect(packDigestInput({ ...pack, license: { ...pack.license, name: 'Otra' } })).not.toBe(base);
    expect(packDigestInput({ ...pack, sources: [] })).not.toBe(base);
    expect(
      packDigestInput({ ...pack, provisions: [{ ...pack.provisions[0]!, text: 'otro texto' }] }),
    ).not.toBe(base);
  });
});

describe('parseLegalPack', () => {
  it('hace round-trip de un pack válido (objeto o JSON string)', () => {
    const pack = makeValidPack();
    expect(parseLegalPack(pack)).toEqual(pack);
    expect(parseLegalPack(JSON.stringify(pack))).toEqual(pack);
  });

  it('degrada a null con entradas inválidas sin lanzar', () => {
    const cases: unknown[] = [
      null,
      undefined,
      42,
      'no es json',
      '[]',
      Array.from([1, 2]),
      {},
      { ...packRecord(), schema: 'openher.legal.pack/2' },
      { ...packRecord(), id: '' },
      { ...packRecord(), jurisdiction: 'uruguay' },
      { ...packRecord(), matter: 'penal' },
      { ...packRecord(), license: { name: 'x' } },
      { ...packRecord(), sources: [{ url: SOURCE_URL }] },
      { ...packRecord(), norms: [{ id: 'CCyC' }] },
      { ...packRecord(), hash: '' },
    ];
    for (const input of cases) {
      expect(() => parseLegalPack(input)).not.toThrow();
      expect(parseLegalPack(input)).toBeNull();
    }
  });

  it('rechaza la provisión sin sourceUrl, sourceDate o textHash', () => {
    for (const field of ['sourceUrl', 'sourceDate', 'textHash'] as const) {
      const record = packRecord();
      delete provisionsOf(record)[0]![field];
      expect(parseLegalPack(record)).toBeNull();
    }
  });

  it('rechaza tags no-array, verified no-boolean y normId desconocido', () => {
    const badTags = packRecord();
    provisionsOf(badTags)[0]!.tags = 'no-array';
    expect(parseLegalPack(badTags)).toBeNull();

    const badVerified = packRecord();
    provisionsOf(badVerified)[0]!.verified = 'sí';
    expect(parseLegalPack(badVerified)).toBeNull();

    const unknownNorm = packRecord();
    provisionsOf(unknownNorm)[0]!.normId = 'DESCONOCIDA';
    expect(parseLegalPack(unknownNorm)).toBeNull();
  });

  it('con verifyTextHashes acepta el hash correcto y rechaza el texto alterado', () => {
    const pack = makeValidPack();
    expect(parseLegalPack(pack, { verifyTextHashes: true })).toEqual(pack);

    const tampered = packRecord();
    provisionsOf(tampered)[0]!.text = 'Texto alterado que no coincide con el hash original.';
    expect(parseLegalPack(tampered, { verifyTextHashes: true })).toBeNull();
    // Sin la verificación de hash, la forma sigue siendo válida.
    expect(parseLegalPack(tampered)).not.toBeNull();
  });

  it('nunca lanza con getters hostiles', () => {
    const hostile = {
      get schema(): string {
        throw new Error('boom');
      },
    };
    expect(() => parseLegalPack(hostile)).not.toThrow();
    expect(parseLegalPack(hostile)).toBeNull();
  });
});

describe('validateLegalPack', () => {
  it('acepta un pack válido', () => {
    expect(validateLegalPack(makeValidPack())).toEqual({ ok: true, errors: [] });
  });

  it('marca la provisión sin campos obligatorios', () => {
    const pack = makeValidPack();
    const result = validateLegalPack({
      ...pack,
      provisions: [{ ...pack.provisions[0]!, sourceUrl: '', sourceDate: '', textHash: '' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('marca el hash de texto que no coincide con el texto normalizado', () => {
    const pack = makeValidPack();
    const result = validateLegalPack(
      { ...pack, provisions: [{ ...pack.provisions[0]!, text: 'otro texto' }] },
      { verifyTextHashes: true },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('textHash'))).toBe(true);
  });

  it('marca normId desconocido y duplicados de norma y provisión', () => {
    const pack = makeValidPack();
    const unknownNorm = validateLegalPack({
      ...pack,
      provisions: [{ ...pack.provisions[0]!, normId: 'DESCONOCIDA' }],
    });
    expect(unknownNorm.errors.some((error) => error.includes('norma desconocida'))).toBe(true);

    const duplicateProvision = validateLegalPack({
      ...pack,
      provisions: [pack.provisions[0]!, pack.provisions[0]!],
    });
    expect(duplicateProvision.errors.some((error) => error.includes('duplicado'))).toBe(true);

    const duplicateNorm = validateLegalPack({
      ...pack,
      norms: [pack.norms[0]!, pack.norms[0]!],
    });
    expect(duplicateNorm.errors.some((error) => error.includes('duplicado'))).toBe(true);
  });

  it('nunca lanza con estructura hostil', () => {
    const hostile = {
      get id(): string {
        throw new Error('boom');
      },
    } as unknown as LegalPack;
    expect(() => validateLegalPack(hostile)).not.toThrow();
    expect(validateLegalPack(hostile).ok).toBe(false);
  });
});

describe('isProvisionValid', () => {
  it('valida forma y, opcionalmente, textHash', () => {
    const provision = makeValidProvision();
    expect(isProvisionValid(provision)).toBe(true);
    expect(isProvisionValid({ ...provision, textHash: '' })).toBe(false);
    expect(isProvisionValid({ ...provision, tags: 'x' })).toBe(false);
    expect(isProvisionValid(provision, { verifyTextHashes: true })).toBe(true);
    expect(isProvisionValid({ ...provision, text: 'alterado' }, { verifyTextHashes: true })).toBe(
      false,
    );
  });
});
