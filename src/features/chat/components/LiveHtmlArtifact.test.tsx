import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import { LiveHtmlArtifact } from './LiveHtmlArtifact';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
  vi.useRealTimers();
});

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('LiveHtmlArtifact', () => {
  it('renderiza la vista previa en un iframe por defecto', () => {
    const html = '<div class="card"><h1>Resumen Ejecutivo</h1></div>';
    render(<LiveHtmlArtifact code={html} />);

    expect(screen.getByTestId('live-html-artifact')).toBeInTheDocument();
    expect(screen.getByTestId('live-artifact-title')).toHaveTextContent('Resumen Ejecutivo');
    const iframe = screen.getByTestId('live-artifact-iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('srcDoc');
  });

  it('muestra badge "Dibujando en vivo…" únicamente mientras streaming es true', () => {
    const { rerender } = render(
      <LiveHtmlArtifact code="<div>Generando...</div>" streaming={true} />,
    );

    expect(screen.getByTestId('live-drawing-badge')).toBeInTheDocument();
    expect(screen.getByTestId('live-drawing-badge')).toHaveTextContent('Dibujando en vivo…');

    rerender(<LiveHtmlArtifact code="<div>Completado</div>" streaming={false} />);
    expect(screen.queryByTestId('live-drawing-badge')).toBeNull();
  });

  it('permite alternar entre la pestaña de Vista previa y Código', () => {
    const html = '<section><code>alert("test")</code></section>';
    render(<LiveHtmlArtifact code={html} />);

    // Por defecto está en vista previa
    expect(screen.getByTestId('live-artifact-iframe')).toBeInTheDocument();
    expect(screen.queryByTestId('live-artifact-code-pre')).toBeNull();

    // Cambia a código
    fireEvent.click(screen.getByTestId('live-artifact-tab-code'));
    expect(screen.queryByTestId('live-artifact-iframe')).toBeNull();
    expect(screen.getByTestId('live-artifact-code-pre')).toBeInTheDocument();
    expect(screen.getByTestId('live-artifact-code-pre')).toHaveTextContent(html);

    // Vuelve a vista previa
    fireEvent.click(screen.getByTestId('live-artifact-tab-preview'));
    expect(screen.getByTestId('live-artifact-iframe')).toBeInTheDocument();
  });

  it('notifica onExpand con el código al pulsar el botón de pantalla completa', () => {
    const onExpand = vi.fn();
    const html = '<h1>Reporte Expandido</h1>';
    render(<LiveHtmlArtifact code={html} onExpand={onExpand} />);

    const expandBtn = screen.getByTestId('live-artifact-expand');
    expect(expandBtn).toBeInTheDocument();
    fireEvent.click(expandBtn);

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledWith(html);
  });

  it('copia el código fuente al portapapeles', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const html = '<div>Copiar esto</div>';
    render(<LiveHtmlArtifact code={html} />);

    const copyBtn = screen.getByTestId('live-artifact-copy');
    fireEvent.click(copyBtn);
    await act(async () => undefined);

    expect(writeText).toHaveBeenCalledWith(html);
  });
});
