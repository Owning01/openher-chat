import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { AppSettings, ProxySettings, SearchSettings, ToolSettings } from '@/domain/types/settings';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { FIXED_NOW, fakeHttp, jsonResponse, keyVaultWith, textResponse, toolContext } from './__fixtures__/fakes';
import { ARTICLE_HTML, BRAVE_PAYLOAD } from './__fixtures__/searchData';
import { OPEN_URL_MAX_RESULT_CHARS, WEB_SEARCH_MAX_RESULT_CHARS, createToolRegistry } from './index';
import { BRAVE_KEY_REF } from './webSearch/brave';

function makeSettings(
  overrides: { tools?: Partial<ToolSettings>; search?: Partial<SearchSettings>; proxy?: Partial<ProxySettings> } = {},
): AppSettings {
  const base = createDefaultSettings(FIXED_NOW);
  return {
    ...base,
    tools: { ...base.tools, ...overrides.tools },
    search: { ...base.search, ...overrides.search },
    proxy: { ...base.proxy, ...overrides.proxy },
  };
}

function mustGet(registry: ToolRegistry, name: string): ToolDefinition {
  const tool = registry.get(name);
  if (tool === undefined) throw new Error(`tool ${name} is not registered`);
  return tool;
}

describe('createToolRegistry — definiciones', () => {
  it('expone web_search y open_url con schema, timeout y cap formales', () => {
    const registry = createToolRegistry(makeSettings(), { http: fakeHttp(() => jsonResponse({})), keys: keyVaultWith({}) });
    expect(registry.list().map((tool) => tool.name)).toEqual(['web_search', 'open_url']);

    const web = mustGet(registry, 'web_search');
    expect(web.description).toMatch(/Search the web/);
    expect(web.timeoutMs).toBe(15_000);
    expect(web.maxResultChars).toBe(WEB_SEARCH_MAX_RESULT_CHARS);
    expect(web.parameters.type).toBe('object');
    expect(web.parameters.required).toEqual(['query']);
    expect(web.parameters.properties?.query?.type).toBe('string');
    expect(web.parameters.properties?.count?.type).toBe('integer');
    expect(web.parameters.properties?.freshness?.enum).toEqual(['any', 'day', 'week', 'month', 'year']);

    const open = mustGet(registry, 'open_url');
    expect(open.description).toMatch(/web page/);
    expect(open.timeoutMs).toBe(15_000);
    expect(open.maxResultChars).toBe(OPEN_URL_MAX_RESULT_CHARS);
    expect(open.parameters.required).toEqual(['url']);
    expect(open.parameters.properties?.url?.type).toBe('string');

    expect(registry.get('nope')).toBeUndefined();
  });

  it('expone load_skill sólo cuando el turno tiene skills guardadas', () => {
    const deps = { http: fakeHttp(() => jsonResponse({})), keys: keyVaultWith({}) };
    const without = createToolRegistry(makeSettings(), deps);
    expect(without.get('load_skill')).toBeUndefined();

    const skills = [
      { id: 's1', name: 'informe-laboral', description: 'Informes', body: '# Pasos', createdAt: 1, updatedAt: 1 },
    ];
    const withSkills = createToolRegistry(makeSettings(), { ...deps, skills });
    expect(withSkills.list().map((tool) => tool.name)).toEqual(['web_search', 'open_url', 'load_skill']);

    const tool = mustGet(withSkills, 'load_skill');
    expect(tool.parameters.required).toEqual(['name']);
    expect(tool.maxResultChars).toBe(16_000);
  });
});

describe('createToolRegistry — ejecución', () => {
  it('web_search devuelve contenido numerado, sources, provider y duración', async () => {
    let clock = 1000;
    const http = fakeHttp(() => {
      clock = 1042;
      return jsonResponse(BRAVE_PAYLOAD);
    });
    const registry = createToolRegistry(makeSettings({ search: { mode: 'brave' } }), {
      http,
      keys: keyVaultWith({ [BRAVE_KEY_REF]: 'brave-key' }),
      now: () => clock,
    });
    const result = await mustGet(registry, 'web_search').execute({ query: 'rust' }, toolContext());
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('brave');
    expect(result.sources).toHaveLength(2);
    expect(result.content).toContain('[1] Alpha Result');
    expect(result.content).toContain('URL: https://example.com/alpha');
    expect(result.durationMs).toBe(42);
  });

  it('respeta settings.tools deshabilitado con no_provider y mensaje claro', async () => {
    const registry = createToolRegistry(makeSettings({ tools: { webSearchEnabled: false, openUrlEnabled: false } }), {
      http: fakeHttp(() => jsonResponse({})),
      keys: keyVaultWith({}),
    });
    const web = await mustGet(registry, 'web_search').execute({ query: 'x' }, toolContext());
    expect(web.ok).toBe(false);
    expect(web.error?.code).toBe('no_provider');
    expect(web.error?.message).toMatch(/disabled/i);

    const open = await mustGet(registry, 'open_url').execute({ url: 'https://example.com' }, toolContext());
    expect(open.ok).toBe(false);
    expect(open.error?.code).toBe('no_provider');
    expect(open.error?.message).toMatch(/disabled/i);
  });

  it('rechaza argumentos inválidos sin llamar a la red', async () => {
    const http = fakeHttp(() => jsonResponse({}));
    const registry = createToolRegistry(makeSettings(), { http, keys: keyVaultWith({}) });
    const web = mustGet(registry, 'web_search');

    const missingQuery = await web.execute({}, toolContext());
    expect(missingQuery.error?.code).toBe('invalid_args');

    const badCount = await web.execute({ query: 'x', count: '3' }, toolContext());
    expect(badCount.error?.code).toBe('invalid_args');

    const badFreshness = await web.execute({ query: 'x', freshness: 'yesterday' }, toolContext());
    expect(badFreshness.error?.code).toBe('invalid_args');

    const openMissing = await mustGet(registry, 'open_url').execute({}, toolContext());
    expect(openMissing.error?.code).toBe('invalid_args');

    expect(http.requests).toHaveLength(0);
  });

  it('trunca el contenido de web_search al cap para el modelo', async () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      title: `Resultado ${index}`,
      url: `https://example.com/${index}`,
      description: 'detalle '.repeat(80),
    }));
    const http = fakeHttp(() => jsonResponse({ web: { results } }));
    const registry = createToolRegistry(makeSettings({ search: { mode: 'brave' } }), {
      http,
      keys: keyVaultWith({ [BRAVE_KEY_REF]: 'brave-key' }),
      now: () => FIXED_NOW,
    });
    const result = await mustGet(registry, 'web_search').execute({ query: 'x' }, toolContext());
    expect(result.ok).toBe(true);
    expect(result.content).toContain('[... truncated');
    expect(result.content.length).toBeLessThan(WEB_SEARCH_MAX_RESULT_CHARS + 200);
  });

  it('proxy custom sin URL o inválido devuelve error accionable sin red', async () => {
    const missingHttp = fakeHttp(() => jsonResponse({}));
    const missingRegistry = createToolRegistry(makeSettings({ proxy: { mode: 'custom', baseUrl: null } }), {
      http: missingHttp,
      keys: keyVaultWith({ [BRAVE_KEY_REF]: 'brave-key' }),
    });
    const missingWeb = await mustGet(missingRegistry, 'web_search').execute({ query: 'x' }, toolContext());
    expect(missingWeb.error?.code).toBe('missing_proxy');
    expect(missingWeb.error?.message).toMatch(/no proxy URL is set/i);
    const missingOpen = await mustGet(missingRegistry, 'open_url').execute(
      { url: 'https://example.com' },
      toolContext(),
    );
    expect(missingOpen.error?.code).toBe('missing_proxy');
    expect(missingHttp.requests).toHaveLength(0);

    const invalidHttp = fakeHttp(() => jsonResponse({}));
    const invalidRegistry = createToolRegistry(makeSettings({ proxy: { mode: 'custom', baseUrl: 'ftp://proxy.test' } }), {
      http: invalidHttp,
      keys: keyVaultWith({ [BRAVE_KEY_REF]: 'brave-key' }),
    });
    const invalidWeb = await mustGet(invalidRegistry, 'web_search').execute({ query: 'x' }, toolContext());
    expect(invalidWeb.error?.code).toBe('invalid_proxy');
    const invalidOpen = await mustGet(invalidRegistry, 'open_url').execute(
      { url: 'https://example.com' },
      toolContext(),
    );
    expect(invalidOpen.error?.code).toBe('invalid_proxy');
    expect(invalidHttp.requests).toHaveLength(0);
  });

  it('open_url bloquea IPs privadas y adjunta sources cuando funciona', async () => {
    const blockedHttp = fakeHttp(() => textResponse(''));
    const blockedRegistry = createToolRegistry(makeSettings(), { http: blockedHttp, keys: keyVaultWith({}) });
    const blocked = await mustGet(blockedRegistry, 'open_url').execute({ url: 'http://127.0.0.1:3000/' }, toolContext());
    expect(blocked.error?.code).toBe('blocked_url');
    expect(blockedHttp.requests).toHaveLength(0);

    const http = fakeHttp(() => textResponse(ARTICLE_HTML));
    const registry = createToolRegistry(makeSettings(), { http, keys: keyVaultWith({}), now: () => FIXED_NOW });
    const result = await mustGet(registry, 'open_url').execute({ url: 'https://example.com/post' }, toolContext());
    expect(result.ok).toBe(true);
    expect(result.sources?.[0]?.url).toBe('https://example.com/post');
    expect(result.content).toContain('Heading First paragraph');
  });

  it('trunca o empaqueta el contenido de open_url al cap para el modelo', async () => {
    const long = 'palabra '.repeat(1500);
    const http = fakeHttp(() => textResponse(`<html><body><article><p>${long}</p></article></body></html>`));
    const registry = createToolRegistry(makeSettings(), { http, keys: keyVaultWith({}), now: () => FIXED_NOW });
    const result = await mustGet(registry, 'open_url').execute({ url: 'https://example.com/long' }, toolContext());
    expect(result.ok).toBe(true);
    // SoL-Pi ObservationPack empaqueta el contenido extenso (>2.500 chars) y respeta el cap del modelo
    expect(result.content.includes('[OBSERVATION_PACK') || result.content.includes('[... truncated')).toBe(true);
    expect(result.content.length).toBeLessThan(OPEN_URL_MAX_RESULT_CHARS + 200);
  });
});
