import { describe, expect, it } from 'vitest';
import { applyCitationMarkers, extractCitations, verifyCitations } from './citation';
import type {
  CitationGuardResult,
  CitationVerdict,
  LegalIndex,
  LegalPassage,
  LegalProvision,
} from '../types/legal';

const PROVISION_2560: LegalProvision = {
  id: 'CCyC-2560',
  normId: 'CCyC',
  article: '2560',
  title: 'Prescripción liberatoria',
  text: 'ARTÍCULO 2560.- El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.',
  jurisdiction: 'national',
  sourceUrl: 'https://servicios.infoleg.gob.ar/',
  sourceDate: '2026-01-05',
  textHash: 'hash-2560',
  verificationMethod: 'manual',
  tags: ['prescripcion', 'obligaciones'],
  verified: true,
};

/** Índice falso mínimo que respeta el contrato `LegalIndex`. */
function makeIndex(
  provisions: readonly LegalProvision[],
  packId = 'ar-ccyc-core',
  packVersion = '1.0.0',
): LegalIndex {
  const byKey = new Map<string, LegalProvision>();
  for (const provision of provisions) {
    byKey.set(`${provision.normId}|${provision.article}`, provision);
  }
  return {
    versions: { [packId]: packVersion },
    size: provisions.length,
    has(normId, article) {
      return byKey.has(`${normId}|${article}`);
    },
    get(normId, article) {
      return byKey.get(`${normId}|${article}`) ?? null;
    },
    search(query, limit) {
      const needle = query.toLowerCase();
      const results: LegalPassage[] = [];
      for (const provision of provisions) {
        if (results.length >= limit) break;
        const haystack = `${provision.normId} ${provision.article} ${provision.text}`.toLowerCase();
        if (haystack.includes(needle)) {
          results.push({ provision, score: 1, packId, packVersion });
        }
      }
      return results;
    },
  };
}

const INDEX = makeIndex([PROVISION_2560]);

function only(result: CitationGuardResult): CitationVerdict {
  expect(result.verdicts).toHaveLength(1);
  const [verdict] = result.verdicts;
  if (verdict === undefined) throw new Error('sin veredictos');
  return verdict;
}

function expectVerified(verdict: CitationVerdict): Extract<CitationVerdict, { status: 'verified' }> {
  expect(verdict.status).toBe('verified');
  if (verdict.status !== 'verified') throw new Error('se esperaba verified');
  return verdict;
}

describe('extractCitations', () => {
  it('clasifica artículo + norma y normaliza el id canónico', () => {
    const refs = extractCitations('Ver el art. 2560 CCyC.');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: 'norm', normId: 'CCyC', article: '2560' });
  });

  it('resuelve alias de sigla, nombre largo y número de ley al mismo id', () => {
    expect(extractCitations('art. 2560 CCCN')[0]?.normId).toBe('CCyC');
    expect(extractCitations('art. 2560 del Código Civil y Comercial')[0]?.normId).toBe('CCyC');
    expect(extractCitations('art. 2560 de la Ley 26.994')[0]?.normId).toBe('CCyC');
    expect(extractCitations('art. 1 Ley 17.454')[0]?.normId).toBe('CPCCN');
    expect(extractCitations('art. 1 CPCC')[0]?.normId).toBe('CPCCN');
    expect(extractCitations('art. 1 LGS')[0]?.normId).toBe('LGS');
    expect(extractCitations('art. 1 LCQ')[0]?.normId).toBe('LCQ');
    expect(extractCitations('art. 1 LDC')[0]?.normId).toBe('LDC');
    expect(extractCitations('art. 1 CP')[0]?.normId).toBe('CP');
  });

  it('normaliza el artículo a sólo dígitos y descarta el ordinal del campo', () => {
    const refs = extractCitations('arts. 52 bis LDC');
    expect(refs[0]).toMatchObject({ kind: 'norm', normId: 'LDC', article: '52' });
  });

  it('una norma sin artículo se detecta como cita de norma', () => {
    const refs = extractCitations('El CCyC regula la materia.');
    expect(refs[0]).toMatchObject({ kind: 'norm', normId: 'CCyC', article: null });
  });

  it('clasifica fallos, doctrina y expedientes', () => {
    expect(extractCitations('El fallo "Foo c/ Bar" (CSJN) es aplicable.')[0]?.kind).toBe('case-law');
    expect(extractCitations('La doctrina mayoritaria sostiene lo contrario.')[0]?.kind).toBe(
      'doctrine',
    );
    expect(extractCitations('Expte. 12345/2024, caratulado...')[0]?.kind).toBe('docket');
  });

  it('devuelve 0 citas y no lanza con texto sin citas', () => {
    expect(extractCitations('Hola, ¿cómo va la tarde?')).toEqual([]);
    expect(extractCitations('')).toEqual([]);
  });

  it('deduplica citas repetidas conservando el orden de aparición', () => {
    const refs = extractCitations(
      'El art. 2560 CCyC aplica. Nuevamente el art. 2560 CCyC aplica.',
    );
    expect(refs).toHaveLength(1);
  });
});

describe('verifyCitations — existencia normativa', () => {
  it('verifica art. 2560 CCyC contra la provisión del índice', () => {
    const result = verifyCitations('Según el art. 2560 CCyC la acción se extingue.', INDEX);
    expect(result.verified).toBe(1);
    expect(result.unverified).toBe(0);
    expect(result.malformed).toBe(0);
    const verdict = expectVerified(only(result));
    expect(verdict.provision.id).toBe('CCyC-2560');
    expect(verdict.fidelity).toBe('not-applicable');
    expect(verdict.packId).toBe('ar-ccyc-core');
    expect(verdict.packVersion).toBe('1.0.0');
  });

  it('marca article-missing si la norma está pero el artículo no', () => {
    const result = verifyCitations('El art. 9999 CCyC no existe en el corpus.', INDEX);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'article-missing' });
  });

  it('marca no-index si la norma no está en el índice', () => {
    const result = verifyCitations('El art. 5 Ley 99999 es inventada.', INDEX);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'no-index' });
  });

  it('resuelve una provisión guardada con ordinal (`52 bis`)', () => {
    const ldc: LegalProvision = {
      ...PROVISION_2560,
      id: 'LDC-52-bis',
      normId: 'LDC',
      article: '52 bis',
      text: 'ARTÍCULO 52 bis.- El daño punitivo se aplica al proveedor.',
    };
    const result = verifyCitations('Ver el art. 52 bis LDC.', makeIndex([ldc]));
    expect(result.verified).toBe(1);
    const verdict = expectVerified(only(result));
    expect(verdict.provision.article).toBe('52 bis');
  });

  it('distingue `52` de `52 bis` como identidades distintas (C-4 colateral)', () => {
    const plain: LegalProvision = {
      ...PROVISION_2560,
      id: 'LDC-52',
      normId: 'LDC',
      article: '52',
      text: 'ARTÍCULO 52.- Disposición general sin daño punitivo.',
    };
    const bis: LegalProvision = {
      ...PROVISION_2560,
      id: 'LDC-52-bis',
      normId: 'LDC',
      article: '52 bis',
      text: 'ARTÍCULO 52 bis.- El daño punitivo se aplica al proveedor. Inc. b) El proveedor responde.',
    };
    const refs = extractCitations('Ver el art. 52 LDC y el art. 52 bis LDC.');
    expect(refs).toHaveLength(2);
    const result = verifyCitations('Ver el art. 52 LDC y el art. 52 bis LDC.', makeIndex([plain, bis]));
    expect(result.verified).toBe(2);
  });

  it('nunca marca verified una cita ausente del índice (propiedad)', () => {
    const invented = [
      'El art. 777 CCyC.',
      'El art. 1234 CCyC.',
      'El art. 42 LDC.',
      'El art. 300 CPCCN.',
      'La Ley 88888.',
      // C-1: la evasión por comillas simples tampoco verifica lo ausente.
      "El art. 777 CCyC dispone: 'un invento entre simples'.",
      // C-3: el inciso inexistente tampoco verifica.
      'El art. 777 CCyC inc. b.',
    ];
    for (const text of invented) {
      const result = verifyCitations(text, INDEX);
      expect(result.verified).toBe(0);
      expect(result.verdicts.some((verdict) => verdict.status === 'verified')).toBe(false);
      expect(result.unverified + result.malformed).toBe(result.verdicts.length);
    }
  });

  it('no puede verificar una cita sin norma inferible', () => {
    const result = verifyCitations('El art. 42 fue reformado.', INDEX);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'not-a-norm' });
  });

  it('reporta malformed cuando no hay un artículo interpretable', () => {
    const result = verifyCitations('El art. ya citado no se transcribe.', INDEX);
    expect(result.malformed).toBe(1);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'malformed' });
  });
});

describe('verifyCitations — fallos, doctrina y expedientes', () => {
  it('un fallo nunca se verifica aunque el texto sea perfecto', () => {
    const result = verifyCitations(
      'El fallo "Foo c/ Bar" de la CSJN resulta aplicable al caso.',
      INDEX,
    );
    expect(result.verified).toBe(0);
    expect(result.unverified).toBeGreaterThan(0);
    for (const verdict of result.verdicts) {
      expect(verdict).toMatchObject({ status: 'unverified', reason: 'external-kind' });
    }
  });

  it('la doctrina nunca se verifica', () => {
    const result = verifyCitations('La doctrina de Bidart Campos lo sostiene.', INDEX);
    expect(result.verified).toBe(0);
    for (const verdict of result.verdicts) {
      expect(verdict).toMatchObject({ status: 'unverified', reason: 'external-kind' });
    }
  });

  it('un expediente nunca se verifica', () => {
    const result = verifyCitations('Expte. 12345/2024 "Foo c/ Bar".', INDEX);
    expect(result.verified).toBe(0);
    expect(result.unverified).toBeGreaterThan(0);
    for (const verdict of result.verdicts) {
      expect(verdict).toMatchObject({ status: 'unverified', reason: 'external-kind' });
    }
  });
});

describe('verifyCitations — fidelidad verbatim', () => {
  it('acepta un span entrecomillado copiado literal del pack', () => {
    const text =
      'El art. 2560 CCyC dispone: "El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible."';
    const result = verifyCitations(text, INDEX);
    expect(result.verified).toBe(1);
    const verdict = expectVerified(only(result));
    expect(verdict.fidelity).toBe('verbatim');
  });

  it('marca paraphrase si el span entrecomillado fue reescrito', () => {
    const text =
      'El art. 2560 CCyC dispone: "El plazo de prescripción corre desde que la deuda es exigible".';
    const result = verifyCitations(text, INDEX);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'paraphrase' });
  });

  it('normaliza espacios y saltos antes de comparar', () => {
    const text =
      'El art. 2560 CCyC dispone:\n"El   plazo de la prescripción liberatoria\nse cuenta desde que la obligación es exigible."';
    const result = verifyCitations(text, INDEX);
    const verdict = expectVerified(only(result));
    expect(verdict.fidelity).toBe('verbatim');
  });

  it('una cita verificada con span parafraseado no queda verified', () => {
    const text = 'El art. 2560 CCyC dice "otra cosa completamente distinta".';
    const result = verifyCitations(text, INDEX);
    expect(result.verdicts.some((verdict) => verdict.status === 'verified')).toBe(false);
    expect(result.unverified).toBe(1);
  });
});

describe('verifyCitations — C-1 comillas simples', () => {
  it('marca paraphrase si el invento va entre comillas simples', () => {
    const text = "El art. 2560 CCyC dispone: 'Un invento que no figura en el pack.'";
    const result = verifyCitations(text, INDEX);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'paraphrase' });
  });

  it('acepta verbatim entre comillas simples', () => {
    const text =
      "El art. 2560 CCyC dispone: 'El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.'";
    const result = verifyCitations(text, INDEX);
    const verdict = expectVerified(only(result));
    expect(verdict.fidelity).toBe('verbatim');
  });

  it('no traga apóstrofes intra-palabra (don\'t)', () => {
    const result = verifyCitations("El art. 2560 CCyC aplica, don't panic.", INDEX);
    const verdict = expectVerified(only(result));
    expect(verdict.fidelity).toBe('not-applicable');
  });
});

describe('verifyCitations — C-2 ventana de respaldo', () => {
  const filler = ' Frase de relleno sin citas ni comillas.'.repeat(12);

  it('asocia un invento más allá de 200 caracteres (dentro del respaldo)', () => {
    const text = `El art. 2560 CCyC dispone${filler} "un invento lejano que no figura".`;
    const result = verifyCitations(text, INDEX);
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'paraphrase' });
  });

  it('verifica un verbatim lejano dentro del respaldo', () => {
    const quote =
      'El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.';
    const text = `El art. 2560 CCyC dispone${filler} "${quote}"`;
    const result = verifyCitations(text, INDEX);
    const verdict = expectVerified(only(result));
    expect(verdict.fidelity).toBe('verbatim');
  });

  it('no le roba la comilla a la cita intermedia', () => {
    const primero: LegalProvision = {
      ...PROVISION_2560,
      id: 'CCyC-1',
      normId: 'CCyC',
      article: '1',
      text: 'ARTÍCULO 1.- Texto primero de prueba sin comillas.',
    };
    const both = makeIndex([primero, PROVISION_2560]);
    const quote =
      'El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.';
    const text = `Según el art. 1 CCyC${filler} el art. 2560 CCyC dispone "${quote}"`;
    const result = verifyCitations(text, both);
    expect(result.verdicts).toHaveLength(2);
    expect(result.verified).toBe(2);
    const primeroVerdict = result.verdicts[0];
    if (primeroVerdict?.status !== 'verified') throw new Error('se esperaba verified para art. 1');
    // La comilla lejana quedó con el 2560, no con el art. 1.
    expect(primeroVerdict.fidelity).toBe('not-applicable');
  });
});

describe('verifyCitations — C-3 calificadores de subdivisión', () => {
  const ldcInc: LegalProvision = {
    ...PROVISION_2560,
    id: 'LDC-52-bis',
    normId: 'LDC',
    article: '52 bis',
    text: 'ARTÍCULO 52 bis.- El daño punitivo se aplica al proveedor. Inc. b) El proveedor responde por daño punitivo.',
  };
  function ldcIndex(): LegalIndex {
    return makeIndex([ldcInc]);
  }

  it('verifica `52 bis inc. b` cuando la provisión menciona el inciso', () => {
    const result = verifyCitations('Ver el art. 52 bis LDC inc. b.', ldcIndex());
    const verdict = expectVerified(only(result));
    expect(verdict.provision.article).toBe('52 bis');
  });

  it('verifica el calificador entre artículo y norma', () => {
    const result = verifyCitations('Ver el art. 52 bis inc. b LDC.', ldcIndex());
    expect(expectVerified(only(result)).provision.article).toBe('52 bis');
  });

  it('preserva el calificador tras la norma en el `raw`', () => {
    const refs = extractCitations('Ver el art. 52 bis LDC inc. b.');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.raw.toLowerCase()).toContain('inc. b');
  });

  it('rechaza el inciso inexistente (`inc. z`) sin verificar', () => {
    const result = verifyCitations('Ver el art. 52 bis LDC inc. z.', ldcIndex());
    expect(result.verified).toBe(0);
    expect(only(result)).toMatchObject({ status: 'unverified', reason: 'article-missing' });
  });
});

describe('verifyCitations — contadores', () => {
  it('texto sin citas da 0 veredictos y contadores en 0', () => {
    const result = verifyCitations('Buenos días, gracias por la consulta.', INDEX);
    expect(result.verdicts).toHaveLength(0);
    expect(result).toMatchObject({ verified: 0, unverified: 0, malformed: 0 });
  });

  it('las citas repetidas cuentan una sola vez y son coherentes', () => {
    const text = 'El art. 2560 CCyC aplica; otra vez el art. 2560 CCyC aplica.';
    const result = verifyCitations(text, INDEX);
    expect(result.verdicts).toHaveLength(1);
    expect(result).toMatchObject({ verified: 1, unverified: 0, malformed: 0 });
    expect(result.verified + result.unverified + result.malformed).toBe(result.verdicts.length);
  });
});

describe('applyCitationMarkers', () => {
  it('inserta [VERIFICAR] en unverified y [VERIFICAR: cita no textual] en paráfrasis', () => {
    const unverified = verifyCitations('El art. 9999 CCyC no existe.', INDEX);
    const markedUnverified = applyCitationMarkers('El art. 9999 CCyC no existe.', unverified);
    expect(markedUnverified).toContain('[VERIFICAR]');

    const paraphraseText = 'El art. 2560 CCyC dice "otra cosa distinta".';
    const paraphrase = verifyCitations(paraphraseText, INDEX);
    const markedParaphrase = applyCitationMarkers(paraphraseText, paraphrase);
    expect(markedParaphrase).toContain('[VERIFICAR: cita no textual]');
  });

  it('no marca citas verificadas', () => {
    const text = 'El art. 2560 CCyC es aplicable.';
    const result = verifyCitations(text, INDEX);
    expect(applyCitationMarkers(text, result)).toBe(text);
  });

  it('es idempotente y preserva el texto original', () => {
    const text = 'El art. 9999 CCyC no existe. Además, el art. 2560 CCyC sí existe.';
    const result = verifyCitations(text, INDEX);
    const marked = applyCitationMarkers(text, result);
    expect(marked).toContain('[VERIFICAR]');
    expect(applyCitationMarkers(marked, result)).toBe(marked);
    expect(marked.replace(/\s*\[VERIFICAR[^\]]*\]/g, '')).toBe(text);
  });

  it('es idempotente también con el marcador de paráfrasis', () => {
    const text = 'El art. 2560 CCyC dice "otra cosa distinta".';
    const result = verifyCitations(text, INDEX);
    const marked = applyCitationMarkers(text, result);
    expect(marked).toContain('[VERIFICAR: cita no textual]');
    expect(applyCitationMarkers(marked, result)).toBe(marked);
  });

  it('no toca la salida cruda: el texto de entrada no se modifica', () => {
    const text = 'El art. 9999 CCyC no existe.';
    const result = verifyCitations(text, INDEX);
    applyCitationMarkers(text, result);
    expect(text).toBe('El art. 9999 CCyC no existe.');
  });

  it('marca con paráfrasis el invento entre comillas simples (C-1)', () => {
    const text = "El art. 2560 CCyC dice 'otra cosa distinta'.";
    const result = verifyCitations(text, INDEX);
    const marked = applyCitationMarkers(text, result);
    expect(marked).toContain('[VERIFICAR: cita no textual]');
    expect(applyCitationMarkers(marked, result)).toBe(marked);
  });
});
