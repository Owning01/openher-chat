import { describe, expect, it } from 'vitest';
import { parseOpenAIModelList } from './modelList';

describe('parseOpenAIModelList', () => {
  it('parsea {data:[...]} y normaliza id/name/source', () => {
    expect(parseOpenAIModelList(JSON.stringify({ data: [{ id: 'm1', name: 'Model One' }, { id: 'm2' }] }))).toEqual([
      { id: 'm1', label: 'Model One', source: 'api' },
      { id: 'm2', label: 'm2', source: 'api' },
    ]);
  });

  it('acepta también {models:[...]}', () => {
    expect(parseOpenAIModelList(JSON.stringify({ models: [{ id: 'a' }, { id: 'b', name: 'Bee' }] }))).toEqual([
      { id: 'a', label: 'a', source: 'api' },
      { id: 'b', label: 'Bee', source: 'api' },
    ]);
  });

  it('ignora entradas sin id string no vacío', () => {
    const text = JSON.stringify({ data: [{ id: '' }, { id: 3 }, { name: 'x' }, 'raw', null, { id: 'ok' }] });
    expect(parseOpenAIModelList(text)).toEqual([{ id: 'ok', label: 'ok', source: 'api' }]);
  });

  it('deduplica por id preservando el primero', () => {
    const text = JSON.stringify({ data: [{ id: 'a', name: 'First' }, { id: 'a', name: 'Second' }] });
    expect(parseOpenAIModelList(text)).toEqual([{ id: 'a', label: 'First', source: 'api' }]);
  });

  it('usa id como label si name falta, está vacío o no es string', () => {
    const text = JSON.stringify({ data: [{ id: 'a', name: '' }, { id: 'b', name: 7 }, { id: 'c' }] });
    expect(parseOpenAIModelList(text)).toEqual([
      { id: 'a', label: 'a', source: 'api' },
      { id: 'b', label: 'b', source: 'api' },
      { id: 'c', label: 'c', source: 'api' },
    ]);
  });

  it('devuelve [] sin lanzar ante JSON roto o formas inesperadas', () => {
    expect(parseOpenAIModelList('not-json')).toEqual([]);
    expect(parseOpenAIModelList('')).toEqual([]);
    expect(parseOpenAIModelList('123')).toEqual([]);
    expect(parseOpenAIModelList('null')).toEqual([]);
    expect(parseOpenAIModelList(JSON.stringify({ foo: [] }))).toEqual([]);
    expect(parseOpenAIModelList(JSON.stringify({ data: 'nope' }))).toEqual([]);
  });
});

describe('parseOpenAIModelList adversarial', () => {
  it('devuelve [] con data:null, models:string o raíz array', () => {
    expect(parseOpenAIModelList(JSON.stringify({ data: null }))).toEqual([]);
    expect(parseOpenAIModelList(JSON.stringify({ models: 'x' }))).toEqual([]);
    expect(parseOpenAIModelList(JSON.stringify([]))).toEqual([]);
  });

  it('descarta entradas null, number, array y boolean', () => {
    const text = JSON.stringify({ data: [null, 3, ['a'], true, { id: 'ok' }] });
    expect(parseOpenAIModelList(text)).toEqual([{ id: 'ok', label: 'ok', source: 'api' }]);
  });

  it('no envenena el prototipo con un id __proto__', () => {
    parseOpenAIModelList('{"data":[{"id":"__proto__","name":"x"}]}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('procesa 10k entradas en tiempo razonable', () => {
    const data = Array.from({ length: 10_000 }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
    const started = Date.now();
    const models = parseOpenAIModelList(JSON.stringify({ data }));
    expect(models).toHaveLength(10_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('parseOpenAIModelList (regresión)', () => {
  it('descarta ids solo-espacios y recorta id/name', () => {
    const text = JSON.stringify({ data: [{ id: '   ' }, { id: '  GPT-5  ', name: ' GPT ' }, { id: '\t' }] });
    expect(parseOpenAIModelList(text)).toEqual([{ id: 'GPT-5', label: 'GPT', source: 'api' }]);
  });
});
