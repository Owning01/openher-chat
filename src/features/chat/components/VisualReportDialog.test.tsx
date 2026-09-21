import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VisualReportDialog } from './VisualReportDialog';

describe('VisualReportDialog', () => {
  afterEach(() => {
    cleanup();
  });
  it('renderiza el iframe con el contenido HTML preparado cuando está abierto', () => {
    render(
      <VisualReportDialog
        open={true}
        onClose={vi.fn()}
        rawHtml="<h1>Análisis Visual</h1>"
        initialThemeId="emerald-mint"
      />,
    );

    expect(screen.getByText('Informe Visual Interactivo')).toBeInTheDocument();
    const iframe = screen.getByTestId('visual-report-iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('srcdoc');
    expect(iframe.getAttribute('srcdoc')).toContain('<h1>Análisis Visual</h1>');
    expect(iframe.getAttribute('srcdoc')).toContain('--primary: #065F46');
  });

  it('permite cambiar la paleta de colores dinámicamente', () => {
    render(
      <VisualReportDialog
        open={true}
        onClose={vi.fn()}
        rawHtml="<div>Dashboard</div>"
        initialThemeId="editorial-navy"
      />,
    );

    const sunsetButton = screen.getByTestId('theme-select-sunset-amber');
    fireEvent.click(sunsetButton);

    const iframe = screen.getByTestId('visual-report-iframe');
    expect(iframe.getAttribute('srcdoc')).toContain('--primary: #7C2D12');
  });

  it('alterna pantalla completa al hacer clic en el botón', () => {
    render(
      <VisualReportDialog
        open={true}
        onClose={vi.fn()}
        rawHtml="<div>Dashboard</div>"
      />,
    );

    const fullscreenBtn = screen.getByTestId('visual-report-fullscreen');
    expect(fullscreenBtn).toHaveTextContent('Pantalla Completa');
    fireEvent.click(fullscreenBtn);
    expect(fullscreenBtn).toHaveTextContent('Ventana');
  });
});
