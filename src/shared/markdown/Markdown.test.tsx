import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLocale } from '@/i18n';

import { Markdown } from './Markdown';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('Markdown', () => {
  it('renderiza tablas y tachado de GFM', () => {
    const { container } = render(<Markdown>{'| a | b |\n| - | - |\n| 1 | 2 |\n\n~~viejo~~'}</Markdown>);

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('del')?.textContent).toBe('viejo');
  });

  it('no interpreta HTML crudo del modelo', () => {
    const { container } = render(<Markdown>{'<script>alert(1)</script>'}</Markdown>);

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });

  it('solo enlaza http(s): javascript: queda como texto', () => {
    const { container } = render(
      <Markdown>{'[malo](javascript:alert(1)) y [bueno](https://example.com/docs)'}</Markdown>,
    );

    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com/docs');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.textContent).toContain('malo');
  });

  it('renderiza código inline y bloques con CodeBlock', () => {
    const source = ['Usa `npm test` para validar.', '', '```js', 'const x = 1;', '```'].join('\n');
    const { container } = render(<Markdown>{source}</Markdown>);

    expect(container.querySelector('code')?.textContent).toBe('npm test');
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
    expect(screen.getByTestId('code-language')).toHaveTextContent('js');
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });

  it('renderiza encabezados h1, h2 y h3 con jerarquía y acentos visuales', () => {
    const md = '# Título Principal\n\n## Subtítulo de Sección\n\n### Nivel 3';
    const { container } = render(<Markdown>{md}</Markdown>);

    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toContain('Título Principal');
    expect(h1?.className).toContain('font-bold');

    const h2 = container.querySelector('h2');
    expect(h2).not.toBeNull();
    expect(h2?.textContent).toContain('Subtítulo de Sección');
    expect(h2?.className).toContain('font-semibold');

    const h3 = container.querySelector('h3');
    expect(h3).not.toBeNull();
    expect(h3?.textContent).toContain('Nivel 3');
  });

  it('renderiza listas ordenadas y no ordenadas con marcadores acentuados', () => {
    const md = '- Elemento A\n- Elemento B\n\n1. Primero\n2. Segundo';
    const { container } = render(<Markdown>{md}</Markdown>);

    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain('marker:text-primary');
    expect(ul?.querySelectorAll('li')).toHaveLength(2);

    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain('marker:text-primary');
    expect(ol?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renderiza tablas responsivas con thead tintado y celdas estilizadas', () => {
    const tableMd = '| Concepto | Valor |\n|---|---|\n| Tokens | 1500 |\n| Costo | $0.002 |';
    const { container } = render(<Markdown>{tableMd}</Markdown>);

    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    const thead = container.querySelector('thead');
    expect(thead).not.toBeNull();
    expect(thead?.className).toContain('bg-primary-soft');

    const ths = container.querySelectorAll('th');
    expect(ths).toHaveLength(2);
    expect(ths[0]?.className).toContain('text-primary');

    const tds = container.querySelectorAll('td');
    expect(tds).toHaveLength(4);
  });

  it('renderiza blockquotes con barra lateral y fondo acentuado', () => {
    const quoteMd = '> Este es un mensaje importante citado.';
    const { container } = render(<Markdown>{quoteMd}</Markdown>);

    const quote = container.querySelector('blockquote');
    expect(quote).not.toBeNull();
    expect(quote?.className).toContain('border-primary');
    expect(quote?.className).toContain('bg-primary-soft');
    expect(quote?.textContent).toContain('Este es un mensaje importante citado.');
  });
});
