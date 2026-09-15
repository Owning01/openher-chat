import { describe, expect, it } from 'vitest';

import { buildDocxParts, markdownToDocx } from './docxWriter';

function documentXml(markdown: string): Document {
  const xml = buildDocxParts(markdown)['word/document.xml'] ?? '';
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

function paragraphs(doc: Document): Element[] {
  return [...doc.getElementsByTagName('w:p')];
}

describe('markdownToDocx', () => {
  it('genera un ZIP determinista con las partes esperadas', () => {
    const first = markdownToDocx('# Hola');
    const second = markdownToDocx('# Hola');

    expect(first[0]).toBe(0x50);
    expect(first[1]).toBe(0x4b);
    expect(first).toEqual(second);
    const raw = new TextDecoder().decode(first);
    expect(raw).toContain('word/document.xml');
    expect(raw).toContain('[Content_Types].xml');
  });

  it('mapea títulos, formato en línea y listas', () => {
    const doc = documentXml('# Demanda\n\nContra **Quiroga** por *alquileres*.\n\n- Hecho uno\n- Hecho dos\n\n1. Paso uno');
    const styles = paragraphs(doc).map(
      (p) => p.querySelector('w\\:pStyle, pStyle')?.getAttribute('w:val') ?? null,
    );
    expect(styles[0]).toBe('Heading1');

    const texts = [...doc.getElementsByTagName('w:t')].map((node) => node.textContent ?? '');
    expect(texts.join('')).toContain('Quiroga');
    expect(doc.getElementsByTagName('w:b').length).toBeGreaterThan(0);
    expect(doc.getElementsByTagName('w:i').length).toBeGreaterThan(0);
    expect(texts.some((text) => text.startsWith('• '))).toBe(true);
    expect(texts.some((text) => text.startsWith('1. '))).toBe(true);
  });

  it('mapea tablas, citas, código y reglas', () => {
    const doc = documentXml('| Mes | Monto |\n| --- | --- |\n| Enero | $450 |\n\n> Cita textual\n\n```\nart. 1\n```\n\n---');
    expect(doc.getElementsByTagName('w:tbl').length).toBe(1);
    expect(doc.getElementsByTagName('w:tr').length).toBe(2);
    const texts = [...doc.getElementsByTagName('w:t')].map((node) => node.textContent ?? '').join('|');
    expect(texts).toContain('Enero');
    expect(texts).toContain('Cita textual');
    expect(texts).toContain('art. 1');
  });

  it('escapa XML y elimina caracteres de control que rompen Word', () => {
    const doc = documentXml('A & B <C> "cita" \u0007 fin');
    const texts = [...doc.getElementsByTagName('w:t')].map((node) => node.textContent ?? '').join('');
    expect(texts).toContain('A & B <C> "cita"  fin');
    expect(texts).not.toContain('\u0007');
  });

  it('un markdown vacío igual abre (cuerpo mínimo + A4)', () => {
    const doc = documentXml('   ');
    expect(paragraphs(doc).length).toBeGreaterThan(0);
    expect(doc.getElementsByTagName('w:sectPr').length).toBe(1);
    expect(markdownToDocx('').length).toBeGreaterThan(100);
  });
});
