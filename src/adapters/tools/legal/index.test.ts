// ---------------------------------------------------------------------------
// Tools legales: schema formal, ejecución sobre el índice, args inválidos sin
// tocar el corpus, truncado y not-found como `ok:true` + gap report.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';
import { buildLegalIndex } from '@/domain/legal/retrieval';
import type { LegalIndex, LegalPack } from '@/domain/types/legal';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { toolContext } from '../__fixtures__/fakes';
import type { LegalGapEntry } from './index';
import {
  CITE_ARTICLE_MAX_RESULT_CHARS,
  CITE_ARTICLE_TOOL_NAME,
  LEGAL_SEARCH_MAX_RESULT_CHARS,
  LEGAL_SEARCH_TOOL_NAME,
  createLegalToolRegistry,
} from './index';

const FIXTURE_TEXT =
  'El plazo de prescripción del crédito del unicornio es de cinco años contados desde que la prestación es exigible.';
const LONG_TEXT = `Texto largo del unicornio: ${'palabra '.repeat(2000)}`;

interface CorpusSpy {
  calls: number;
  fail?: unknown;
}

/** Corpus fake en memoria con contador de `ensureIndex` para espiar accesos. */
function fakeCorpus(index: LegalIndex, spy: CorpusSpy): {
  ensureIndex(): Promise<LegalIndex>;
  getIndex(): LegalIndex | null;
} {
  return {
    getIndex: () => index,
    ensureIndex: (): Promise<LegalIndex> => {
      spy.calls += 1;
      if (spy.fail !== undefined) throw spy.fail;
      return Promise.resolve(index);
    },
  };
}

/** Pack mínimo con dos provisiones citables por los tests. */
function buildFixturePack(): LegalPack {
  return {
    schema: 'openher.legal.pack/1',
    id: 'test-pack',
    title: 'Pack de prueba',
    version: '1.0.0',
    publishedAt: '2026-09-14',
    jurisdiction: 'national',
    matter: 'civil',
    license: {
      name: 'Dominio público',
      url: 'https://example.invalid/licencia',
      attribution: 'Fixture de test',
    },
    sources: [{ url: 'https://example.invalid/fuente', retrievedAt: '2026-09-14' }],
    norms: [{ id: 'TEST', short: 'TEST', long: 'Norma de prueba', jurisdiction: 'national' }],
    provisions: [
      {
        id: 'TEST-1',
        normId: 'TEST',
        article: '1',
        title: 'Plazo del unicornio',
        text: FIXTURE_TEXT,
        jurisdiction: 'national',
        sourceUrl: 'https://example.invalid/fuente',
        sourceDate: '2026-09-14',
        textHash: 'hash-1',
        verificationMethod: 'manual',
        tags: ['prescripcion', 'unicornio'],
        verified: true,
      },
      {
        id: 'TEST-2',
        normId: 'TEST',
        article: '2',
        title: 'Contratos del fénix',
        text: 'Los contratos del fénix se interpretan según la buena fe y los usos del lugar.',
        jurisdiction: 'national',
        sourceUrl: 'https://example.invalid/fuente',
        sourceDate: '2026-09-14',
        textHash: 'hash-2',
        verificationMethod: 'manual',
        tags: ['contratos', 'fenix'],
        verified: true,
      },
    ],
    hash: 'hash-pack',
  };
}

/** Índice con una provisión larga para probar el truncado al cap. */
function buildLongIndex(): LegalIndex {
  const pack = buildFixturePack();
  const longPack: LegalPack = {
    ...pack,
    provisions: [
      {
        id: 'TEST-9',
        normId: 'TEST',
        article: '9',
        title: 'Artículo largo',
        text: LONG_TEXT,
        jurisdiction: 'national',
        sourceUrl: 'https://example.invalid/fuente',
        sourceDate: '2026-09-14',
        textHash: 'hash-9',
        verificationMethod: 'manual',
        tags: ['unicornio'],
        verified: true,
      },
    ],
  };
  return buildLegalIndex([longPack]);
}

function mustGet(registry: ToolRegistry, name: string): ToolDefinition {
  const tool = registry.get(name);
  if (tool === undefined) throw new Error(`tool ${name} is not registered`);
  return tool;
}

describe('createLegalToolRegistry — definiciones', () => {
  it('expone legal_search y cite_article con schema, timeout y cap formales', () => {
    const spy: CorpusSpy = { calls: 0 };
    const index = buildLegalIndex([buildFixturePack()]);
    const registry = createLegalToolRegistry({ corpus: fakeCorpus(index, spy) });
    expect(registry.list().map((tool) => tool.name)).toEqual([LEGAL_SEARCH_TOOL_NAME, CITE_ARTICLE_TOOL_NAME]);

    const search = mustGet(registry, LEGAL_SEARCH_TOOL_NAME);
    expect(search.description).toMatch(/Search the installed/);
    expect(search.timeoutMs).toBe(10_000);
    expect(search.maxResultChars).toBe(LEGAL_SEARCH_MAX_RESULT_CHARS);
    expect(search.parameters.type).toBe('object');
    expect(search.parameters.required).toEqual(['query']);
    expect(search.parameters.properties?.query?.type).toBe('string');
    expect(search.parameters.properties?.limit?.type).toBe('integer');
    expect(search.parameters.properties?.jurisdiction?.type).toBe('string');

    const cite = mustGet(registry, CITE_ARTICLE_TOOL_NAME);
    expect(cite.description).toMatch(/verbatim text/);
    expect(cite.timeoutMs).toBe(10_000);
    expect(cite.maxResultChars).toBe(CITE_ARTICLE_MAX_RESULT_CHARS);
    expect(cite.parameters.required).toEqual(['norm', 'article']);
    expect(cite.parameters.properties?.norm?.type).toBe('string');
    expect(cite.parameters.properties?.article?.type).toBe('string');

    expect(registry.get('nope')).toBeUndefined();
  });
});

describe('createLegalToolRegistry — ejecución feliz', () => {
  it('legal_search devuelve pasajes con cita del fixture pack', async () => {
    const spy: CorpusSpy = { calls: 0 };
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), spy),
    });
    const result = await mustGet(registry, LEGAL_SEARCH_TOOL_NAME).execute(
      { query: 'prescripción unicornio' },
      toolContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('TEST');
    expect(result.content).toContain('art. 1');
    expect(result.content).toContain('test-pack@1.0.0');
    expect(result.content).toContain(FIXTURE_TEXT);
    expect(spy.calls).toBe(1);
  });

  it('cite_article devuelve el texto verbatim de la provisión citada', async () => {
    const spy: CorpusSpy = { calls: 0 };
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), spy),
    });
    const result = await mustGet(registry, CITE_ARTICLE_TOOL_NAME).execute(
      { norm: 'TEST', article: '1' },
      toolContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('TEST');
    expect(result.content).toContain('art. 1');
    expect(result.content).toContain(FIXTURE_TEXT);
    expect(result.content).toContain('test-pack@1.0.0');
    expect(spy.calls).toBe(1);
  });

  it('legal_search respeta el filtro de jurisdicción', async () => {
    const spy: CorpusSpy = { calls: 0 };
    const gaps: LegalGapEntry[] = [];
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), spy),
      reportGap: (entry) => {
        gaps.push(entry);
      },
    });
    const search = mustGet(registry, LEGAL_SEARCH_TOOL_NAME);
    const national = await search.execute(
      { query: 'unicornio', jurisdiction: 'national' },
      toolContext(),
    );
    expect(national.ok).toBe(true);
    expect(national.content).toContain('art. 1');
    const other = await search.execute({ query: 'unicornio', jurisdiction: 'caba' }, toolContext());
    expect(other.ok).toBe(true);
    expect(other.content).not.toContain(FIXTURE_TEXT);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.query).toBe('unicornio');
  });
});

describe('createLegalToolRegistry — args inválidos', () => {
  it('rechaza args malformados sin tocar el corpus', async () => {
    const spy: CorpusSpy = { calls: 0 };
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), spy),
    });
    const search = mustGet(registry, LEGAL_SEARCH_TOOL_NAME);
    const cite = mustGet(registry, CITE_ARTICLE_TOOL_NAME);

    for (const args of [{}, { query: '' }, { query: '   ' }, { query: 12 }, { query: 'x', limit: '3' }, { query: 'x', jurisdiction: 'mars' }]) {
      const result = await search.execute(args, toolContext());
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('invalid_args');
    }
    for (const args of [{}, { norm: 'TEST' }, { article: '1' }, { norm: '', article: '1' }, { norm: 'TEST', article: '  ' }]) {
      const result = await cite.execute(args, toolContext());
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('invalid_args');
    }
    expect(spy.calls).toBe(0);
  });
});

describe('createLegalToolRegistry — truncado', () => {
  it('trunca legal_search al cap para el modelo', async () => {
    const registry = createLegalToolRegistry({ corpus: fakeCorpus(buildLongIndex(), { calls: 0 }) });
    const result = await mustGet(registry, LEGAL_SEARCH_TOOL_NAME).execute(
      { query: 'unicornio' },
      toolContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('[... truncated');
    expect(result.content.length).toBeLessThan(LEGAL_SEARCH_MAX_RESULT_CHARS + 200);
  });

  it('trunca cite_article al cap para el modelo', async () => {
    const registry = createLegalToolRegistry({ corpus: fakeCorpus(buildLongIndex(), { calls: 0 }) });
    const result = await mustGet(registry, CITE_ARTICLE_TOOL_NAME).execute(
      { norm: 'TEST', article: '9' },
      toolContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('[... truncated');
    expect(result.content.length).toBeLessThan(CITE_ARTICLE_MAX_RESULT_CHARS + 200);
  });
});

describe('createLegalToolRegistry — not-found y fallos', () => {
  it('legal_search sin resultados devuelve ok:true explicativo + gap reportado', async () => {
    const spy: CorpusSpy = { calls: 0 };
    const gaps: LegalGapEntry[] = [];
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), spy),
      reportGap: (entry) => {
        gaps.push(entry);
      },
    });
    const result = await mustGet(registry, LEGAL_SEARCH_TOOL_NAME).execute(
      { query: 'zzzxqqq nada coincide' },
      toolContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(gaps).toEqual([{ query: 'zzzxqqq nada coincide' }]);
    expect(spy.calls).toBe(1);
  });

  it('cite_article ausente devuelve ok:true explicativo + gap con norma y artículo', async () => {
    const spy: CorpusSpy = { calls: 0 };
    const gaps: LegalGapEntry[] = [];
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), spy),
      reportGap: (entry) => {
        gaps.push(entry);
      },
    });
    const result = await mustGet(registry, CITE_ARTICLE_TOOL_NAME).execute(
      { norm: 'TEST', article: '9999' },
      toolContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(gaps).toEqual([{ query: 'TEST 9999', missingNorm: 'TEST', missingArticle: '9999' }]);
    expect(spy.calls).toBe(1);
  });

  it('un fallo interno devuelve ToolResult de error existente y nunca lanza', async () => {
    const gaps: LegalGapEntry[] = [];
    const registry = createLegalToolRegistry({
      corpus: fakeCorpus(buildLegalIndex([buildFixturePack()]), { calls: 0, fail: new Error('roto') }),
      reportGap: (entry) => {
        gaps.push(entry);
      },
    });
    const search = await mustGet(registry, LEGAL_SEARCH_TOOL_NAME).execute(
      { query: 'unicornio' },
      toolContext(),
    );
    expect(search.ok).toBe(false);
    expect(search.error?.code).toBe('parse_error');
    const cite = await mustGet(registry, CITE_ARTICLE_TOOL_NAME).execute(
      { norm: 'TEST', article: '1' },
      toolContext(),
    );
    expect(cite.ok).toBe(false);
    expect(cite.error?.code).toBe('parse_error');
    expect(gaps).toEqual([]);
  });
});
