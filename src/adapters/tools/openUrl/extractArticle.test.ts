import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTICLE_HTML } from '../__fixtures__/searchData';
import { ARTICLE_TEXT_LIMIT, capArticleText, extractArticle } from './extractArticle';

describe('extractArticle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extrae og:title, meta description y texto de article sin scripts/styles', () => {
    const article = extractArticle(ARTICLE_HTML);
    expect(article.title).toBe('OG Title');
    expect(article.description).toBe('Short description');
    expect(article.text).toBe('Heading First paragraph & more. Second élément.');
    expect(article.truncated).toBe(false);
  });

  it('produce el mismo texto con el fallback regex (sin DOMParser)', () => {
    vi.stubGlobal('DOMParser', undefined);
    const article = extractArticle(ARTICLE_HTML);
    expect(article.title).toBe('OG Title');
    expect(article.description).toBe('Short description');
    expect(article.text).toBe('Heading First paragraph & more. Second élément.');
    expect(article.text).not.toContain('alert');
    expect(article.text).not.toContain('color: red');
  });

  it('usa <title> cuando no hay og:title y body cuando no hay article/main', () => {
    const html = '<html><head><title> Plain Title </title></head><body><p>Body   text</p></body></html>';
    const article = extractArticle(html);
    expect(article.title).toBe('Plain Title');
    expect(article.text).toBe('Body text');
  });

  it('separa palabras al quitar scripts/styles con DOMParser (no las pega)', () => {
    const html = '<html><body><main>Hola<script>var x=1;</script><style>.a{}</style>Texto</main></body></html>';
    expect(extractArticle(html).text).toBe('Hola Texto');
  });

  it('separa palabras al quitar scripts/styles con el fallback regex', () => {
    vi.stubGlobal('DOMParser', undefined);
    const html = '<html><body><main>Hola<script>var x=1;</script><style>.a{}</style>Texto</main></body></html>';
    expect(extractArticle(html).text).toBe('Hola Texto');
  });

  it('prefiere main si no existe article', () => {
    const html = '<html><body><div>Fuera</div><main><p>Dentro</p></main></body></html>';
    expect(extractArticle(html).text).toBe('Dentro');
  });

  it('trunca al límite y marca truncated', () => {
    const article = extractArticle('<html><body><main>0123456789</main></body></html>', { maxChars: 4 });
    expect(article.text).toBe('0123');
    expect(article.truncated).toBe(true);
  });

  it('respeta el límite por defecto de 8000', () => {
    const long = 'a'.repeat(ARTICLE_TEXT_LIMIT + 500);
    const article = extractArticle(`<html><body><main>${long}</main></body></html>`);
    expect(article.text.length).toBe(ARTICLE_TEXT_LIMIT);
    expect(article.truncated).toBe(true);
  });

  it('devuelve vacíos sin crashear con HTML vacío', () => {
    const article = extractArticle('');
    expect(article).toEqual({ title: '', description: '', text: '', truncated: false });
  });

  it('capArticleText no parte pares surrogados', () => {
    const capped = capArticleText('😀😀', 1);
    expect(capped).toEqual({ text: '😀', truncated: true });
  });
});
