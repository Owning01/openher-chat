import { describe, expect, it } from 'vitest';

import { htmlToMarkdown } from './htmlToMarkdown';

describe('htmlToMarkdown', () => {
  it('convierte títulos, párrafos y formato en línea', () => {
    const html =
      '<h1>Demanda</h1><p>Contra <strong>Quiroga</strong> por <em>alquileres</em>.</p>' +
      '<h2>Hechos</h2><p>Segundo párrafo con <b>negrita b</b> y <i>cursiva i</i>.</p>';
    expect(htmlToMarkdown(html)).toBe(
      '# Demanda\n\nContra **Quiroga** por *alquileres*.\n\n## Hechos\n\nSegundo párrafo con **negrita b** y *cursiva i*.',
    );
  });

  it('convierte listas ordenadas, desordenadas y anidadas', () => {
    const html =
      '<ul><li>Primero<ul><li>Sub uno</li><li>Sub dos</li></ul></li><li>Segundo</li></ul>' +
      '<ol><li>Paso uno</li><li>Paso dos</li></ol>';
    expect(htmlToMarkdown(html)).toBe(
      '- Primero\n  - Sub uno\n  - Sub dos\n- Segundo\n\n1. Paso uno\n2. Paso dos',
    );
  });

  it('convierte tablas a GFM con pipes escapados', () => {
    const html =
      '<table><tr><th>Mes</th><th>Monto</th></tr>' +
      '<tr><td>Enero</td><td>$450.000 | parcial</td></tr></table>';
    expect(htmlToMarkdown(html)).toBe(
      '| Mes | Monto |\n| --- | --- |\n| Enero | $450.000 \\| parcial |',
    );
  });

  it('conserva enlaces e imágenes como texto', () => {
    const html =
      '<p>Ver <a href="https://ejemplo.com/fallo">fallo</a> y <img alt="firma" src="f.png" />.</p>';
    expect(htmlToMarkdown(html)).toBe('Ver [fallo](https://ejemplo.com/fallo) y [imagen: firma].');
  });

  it('decodifica entidades y tolera entidades rotas sin perder el documento', () => {
    expect(htmlToMarkdown('<p>A &amp; B &lt;C&gt; &#65; &#x42;</p>')).toBe('A & B <C> A B');
    expect(htmlToMarkdown('<p>ok &#99999999; fin</p>')).toContain('fin');
  });

  it('ignora estilos y scripts quedándose con las palabras', () => {
    const html = '<div class="x" style="color:red"><p>Hola <span>mundo</span></p><script>mal()</script></div>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('Hola');
    expect(result).toContain('mundo');
    expect(result).not.toContain('mal()');
  });

  it('devuelve vacío con entrada vacía o sin texto', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
    expect(htmlToMarkdown('<div><br></div>')).toBe('');
  });
});
