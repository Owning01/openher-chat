import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import { COPY_FEEDBACK_MS } from './CopyButton';
import { CodeBlock } from './CodeBlock';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
  vi.useRealTimers();
});

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('CodeBlock', () => {
  it('resalta con highlight.js y muestra el lenguaje', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="js" />);

    expect(screen.getByTestId('code-language')).toHaveTextContent('js');
    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
    expect(container.querySelector('.hljs-number')).not.toBeNull();
  });

  it('cae a texto plano con lenguaje desconocido y escapa el contenido', () => {
    const { container } = render(<CodeBlock code={'<img src=x onerror="boom()">'} language="desconocido" />);

    expect(screen.getByTestId('code-language')).toHaveTextContent('text');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('en streaming difiere el highlight de bloques grandes (pestaña no cuelga)', () => {
    const big = `const x = 1;\n`.repeat(500);
    expect(big.length).toBeGreaterThan(4000);
    const { container } = render(<CodeBlock code={big} language="js" streaming />);

    expect(screen.getByTestId('code-language')).toHaveTextContent('js');
    expect(container.querySelector('.hljs-keyword')).toBeNull();
    expect(container.textContent).toContain('const x = 1;');
  });

  it('en streaming colorea igual los bloques chicos', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="js" streaming />);

    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('nunca colorea bloques gigantes aunque hayan completado', () => {
    const huge = `const x = 1;\n`.repeat(9000);
    expect(huge.length).toBeGreaterThan(100_000);
    const { container } = render(<CodeBlock code={huge} language="js" />);

    expect(container.querySelector('.hljs-keyword')).toBeNull();
    expect(container.textContent).toContain('const x = 1;');
  });

  it('copia el código y muestra «Copiado» durante 1.2 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CodeBlock code="hola mundo" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await act(async () => undefined);

    expect(writeText).toHaveBeenCalledWith('hola mundo');
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });

    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });

  it('renderiza LiveHtmlArtifact para lenguaje html', () => {
    render(<CodeBlock code="<div class='card'>Hola</div>" language="html" />);
    expect(screen.getByTestId('live-html-artifact')).toBeInTheDocument();
    expect(screen.getByTestId('live-artifact-iframe')).toBeInTheDocument();
  });

  it('colapsa artefactos HTML anteriores en tarjeta compacta y permite expandir/ocultar vista previa', () => {
    const onExpand = vi.fn();
    render(
      <CodeBlock
        code="<h1>Reporte de prueba</h1>"
        language="html"
        isLatestArtifact={false}
        onExpand={onExpand}
      />,
    );

    // Debe mostrar la tarjeta compacta y NO el iframe
    expect(screen.getByTestId('collapsed-html-artifact')).toBeInTheDocument();
    expect(screen.getByText('Reporte de prueba')).toBeInTheDocument();
    expect(screen.getByText('Versión anterior')).toBeInTheDocument();
    expect(screen.queryByTestId('live-artifact-iframe')).toBeNull();

    // Pantalla completa dispara onExpand
    fireEvent.click(screen.getByTestId('fullscreen-collapsed-artifact'));
    expect(onExpand).toHaveBeenCalledWith('<h1>Reporte de prueba</h1>');

    // Al hacer click en "Mostrar vista previa" se expande inline
    fireEvent.click(screen.getByTestId('expand-collapsed-artifact'));
    expect(screen.getByTestId('live-artifact-iframe')).toBeInTheDocument();
    expect(screen.getByTestId('collapse-artifact-btn')).toBeInTheDocument();

    // Al hacer click en "Ocultar vista previa" vuelve a colapsar
    fireEvent.click(screen.getByTestId('collapse-artifact-btn'));
    expect(screen.queryByTestId('live-artifact-iframe')).toBeNull();
    expect(screen.getByTestId('collapsed-html-artifact')).toBeInTheDocument();
  });
});

