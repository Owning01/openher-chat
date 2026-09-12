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
});
