import { describe, expect, it } from 'vitest';
import {
  buildLegalIndex,
  estimateLegalTokens,
  searchLegalPassages,
  tokenizeLegal,
} from './retrieval';
import type { LegalNorm, LegalPack, LegalProvision } from '../types/legal';

const SOURCE_URL = 'https://example.test/legal/ccyc';

/** Norma CCyC con aliases y nombre largo real-like (fuente ficticia). */
const CCYC_NORM: LegalNorm = {
  id: 'CCyC',
  short: 'CCyC',
  long: 'Código Civil y Comercial de la Nación',
  aliases: ['CCCN', 'Código Civil y Comercial'],
  jurisdiction: 'national',
};

/** Provisión con forma válida; `textHash` ficticio (retrieval no lo valida). */
function makeProvision(
  id: string,
  article: string,
  title: string,
  text: string,
  tags: string[],
  synonyms?: string[],
): LegalProvision {
  const provision: LegalProvision = {
    id,
    normId: 'CCyC',
    article,
    title,
    text,
    jurisdiction: 'national',
    sourceUrl: SOURCE_URL,
    sourceDate: '2026-01-05',
    textHash: `hash-${id}`,
    verificationMethod: 'manual',
    tags,
    verified: true,
  };
  if (synonyms !== undefined) provision.synonyms = synonyms;
  return provision;
}

/** Pack fixture: 4 provisiones de prescripción (CCyC 2560/2561/2562/2564). */
function makePack(version = '1.0.0'): LegalPack {
  return {
    schema: 'openher.legal.pack/1',
    id: 'ar-ccyc-core',
    title: 'CCyC núcleo',
    version,
    publishedAt: '2026-01-15',
    jurisdiction: 'national',
    matter: 'civil-commercial',
    license: {
      name: 'Boletín Oficial',
      url: 'https://example.test/licencia',
      attribution: 'Texto referencial de prueba',
    },
    sources: [{ url: SOURCE_URL, retrievedAt: '2026-01-05' }],
    norms: [CCYC_NORM],
    provisions: [
      makeProvision(
        'CCyC-2560',
        '2560',
        'Plazo de prescripción liberatoria',
        'ARTÍCULO 2560.- El plazo de la prescripción liberatoria es de cinco (5) años, excepto que esté previsto un plazo menor o distinto en este Código.',
        ['prescripcion', 'plazo', 'quinquenal', 'obligaciones'],
        ['prescribe', 'plazo quinquenal'],
      ),
      makeProvision(
        'CCyC-2561',
        '2561',
        'Comienzo del cómputo',
        'ARTÍCULO 2561.- El plazo de la prescripción se cuenta desde el día siguiente al de la exigibilidad de la obligación.',
        ['prescripcion', 'computo'],
      ),
      makeProvision(
        'CCyC-2562',
        '2562',
        'Prescripción bienal',
        'ARTÍCULO 2562.- El plazo de la prescripción es de dos (2) años en los supuestos previstos en este Código.',
        ['prescripcion', 'bienal'],
      ),
      makeProvision(
        'CCyC-2564',
        '2564',
        'Interrupción de la prescripción',
        'ARTÍCULO 2564.- La prescripción se interrumpe por toda petición del titular del derecho dirigida al deudor.',
        ['prescripcion', 'interrupcion'],
      ),
    ],
    hash: 'hash-pack-ccyc',
  };
}

/** Pack mínimo con dos provisiones idénticas para forzar un empate exacto. */
function makeTiePack(): LegalPack {
  const text = 'ARTÍCULO N.- El derecho a los alimentos se rige por esta norma de prueba.';
  const makeTie = (id: string, article: string): LegalProvision => ({
    id,
    normId: 'TIE',
    article,
    text,
    jurisdiction: 'national',
    sourceUrl: 'https://example.test/legal/tie',
    sourceDate: '2026-01-05',
    textHash: `hash-${id}`,
    verificationMethod: 'manual',
    tags: ['alimentos'],
    verified: true,
  });
  return {
    schema: 'openher.legal.pack/1',
    id: 'tie-pack',
    title: 'Pack de empate',
    version: '0.0.1',
    publishedAt: '2026-01-15',
    jurisdiction: 'national',
    matter: 'civil',
    license: {
      name: 'Prueba',
      url: 'https://example.test/licencia',
      attribution: 'Prueba',
    },
    sources: [{ url: 'https://example.test/legal/tie', retrievedAt: '2026-01-05' }],
    norms: [
      {
        id: 'TIE',
        short: 'TIE',
        long: 'Norma de prueba',
        jurisdiction: 'national',
      },
    ],
    provisions: [makeTie('TIE-b-300', '300'), makeTie('TIE-a-301', '301')],
    hash: 'hash-pack-tie',
  };
}

describe('tokenizeLegal', () => {
  it('pliega acentos y separa por no alfanumérico', () => {
    expect(tokenizeLegal('Prescripción QUINQUENAL')).toEqual(['prescripcion', 'quinquenal']);
  });

  it('canonicaliza art./arts./articulo(s) y stopwords', () => {
    expect(tokenizeLegal('arts. 2560')).toEqual(['art', '2560']);
    expect(tokenizeLegal('El plazo de la prescripción')).toEqual(['plazo', 'prescripcion']);
    expect(tokenizeLegal('artículos 2562 y 2564')).toEqual(['art', '2562', '2564']);
  });

  it('canonicaliza aliases de norma de uno y varios tokens', () => {
    expect(tokenizeLegal('CCCN')).toEqual(['ccyc']);
    expect(tokenizeLegal('Código Civil y Comercial')).toEqual(['ccyc']);
  });

  it('aplica sufijos livianos sin sobre-stemmear', () => {
    expect(tokenizeLegal('prescripciones')).toEqual(['prescripcion']);
    expect(tokenizeLegal('responsabilidades')).toEqual(['responsabilidad']);
    expect(tokenizeLegal('plazos')).toEqual(['plazo']);
    expect(tokenizeLegal('mes')).toEqual(['mes']);
  });

  it('devuelve [] para texto vacío o sólo stopwords', () => {
    expect(tokenizeLegal('')).toEqual([]);
    expect(tokenizeLegal('de la y el')).toEqual([]);
  });
});

describe('buildLegalIndex y searchLegalPassages', () => {
  it('rankea la provisión correcta para consultas de prescripción', () => {
    const index = buildLegalIndex([makePack()]);
    const quinquenal = searchLegalPassages(index, 'prescripción quinquenal', 5);
    expect(quinquenal[0]?.provision.id).toBe('CCyC-2560');

    const plazo = searchLegalPassages(index, 'plazo de prescripción', 5);
    expect(plazo[0]?.provision.id).toBe('CCyC-2560');

    const variante = searchLegalPassages(index, 'prescribe', 5).map(
      (passage) => passage.provision.id,
    );
    expect(variante).toContain('CCyC-2560');
  });

  it('da el mismo resultado con o sin acentos', () => {
    const index = buildLegalIndex([makePack()]);
    const conAcento = searchLegalPassages(index, 'prescripción quinquenal', 5).map(
      (passage) => passage.provision.id,
    );
    const sinAcento = searchLegalPassages(index, 'prescripcion quinquenal', 5).map(
      (passage) => passage.provision.id,
    );
    expect(sinAcento).toEqual(conAcento);
    expect(conAcento.length).toBeGreaterThan(0);
  });

  it('resuelve referencias abreviadas a artículo y norma', () => {
    const index = buildLegalIndex([makePack()]);
    const first = searchLegalPassages(index, 'art. 2560 CCyC', 5);
    expect(first[0]?.provision.id).toBe('CCyC-2560');

    const multiple = searchLegalPassages(index, 'arts. 2562 y 2564', 5).map(
      (passage) => passage.provision.id,
    );
    expect(multiple).toContain('CCyC-2562');
    expect(multiple).toContain('CCyC-2564');
  });

  it('es determinista entre builds y búsquedas', () => {
    const a = buildLegalIndex([makePack()]);
    const b = buildLegalIndex([makePack()]);
    const query = 'plazo de prescripción';
    expect(searchLegalPassages(a, query, 5)).toEqual(searchLegalPassages(b, query, 5));
    expect(searchLegalPassages(a, query, 5)).toEqual(searchLegalPassages(a, query, 5));
  });

  it('resuelve empates por id de provisión', () => {
    const index = buildLegalIndex([makeTiePack()]);
    const ids = searchLegalPassages(index, 'alimentos', 5).map(
      (passage) => passage.provision.id,
    );
    expect(ids).toEqual(['TIE-a-301', 'TIE-b-300']);
  });

  it('expone has/get/size/versions coherentes', () => {
    const index = buildLegalIndex([makePack()]);
    expect(index.size).toBe(4);
    expect(index.has('CCyC', '2560')).toBe(true);
    expect(index.has('CCyC', '9999')).toBe(false);
    expect(index.get('CCyC', '2560')?.id).toBe('CCyC-2560');
    expect(index.get('CCyC', '9999')).toBeNull();
    expect(index.versions['ar-ccyc-core']).toBe('1.0.0');
  });

  it('no duplica resultados con packs duplicados', () => {
    const single = buildLegalIndex([makePack()]);
    const duplicated = buildLegalIndex([makePack(), makePack()]);
    expect(duplicated.size).toBe(4);
    expect(Object.keys(duplicated.versions)).toEqual(['ar-ccyc-core']);
    expect(searchLegalPassages(duplicated, 'prescripción quinquenal', 10)).toEqual(
      searchLegalPassages(single, 'prescripción quinquenal', 10),
    );
  });

  it('se construye con 0 packs y no encuentra nada', () => {
    const empty = buildLegalIndex([]);
    expect(empty.size).toBe(0);
    expect(empty.has('CCyC', '2560')).toBe(false);
    expect(empty.get('CCyC', '2560')).toBeNull();
    expect(empty.versions).toEqual({});
    expect(searchLegalPassages(empty, 'prescripción', 5)).toEqual([]);
  });

  it('devuelve [] para consulta vacía o sólo stopwords', () => {
    const index = buildLegalIndex([makePack()]);
    expect(searchLegalPassages(index, '', 5)).toEqual([]);
    expect(searchLegalPassages(index, 'de la y el', 5)).toEqual([]);
  });
});

describe('estimateLegalTokens', () => {
  it('cuenta bytes UTF-8 reales con ceil(bytes/3)', () => {
    expect(estimateLegalTokens('áéí')).toBe(2);
    expect(estimateLegalTokens('')).toBe(0);
    expect(estimateLegalTokens('abc')).toBe(1);
    expect(estimateLegalTokens('ábc')).toBe(2);
  });
});
