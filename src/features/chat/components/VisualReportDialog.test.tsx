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

  it('alterna entre modo claro y modo oscuro en el diálogo', () => {
    render(
      <VisualReportDialog
        open={true}
        onClose={vi.fn()}
        rawHtml="<div>Dashboard</div>"
      />,
    );

    const iframe = screen.getByTestId('visual-report-iframe');
    expect(iframe.getAttribute('srcdoc')).toContain('data-theme="light"');

    const modeBtn = screen.getByTestId('visual-report-colormode');
    fireEvent.click(modeBtn);

    expect(iframe.getAttribute('srcdoc')).toContain('data-theme="dark"');
  });

  it('permite abrir barra de modificación y llama a onRequestEdit', () => {
    const onRequestEdit = vi.fn();
    const onClose = vi.fn();
    const html = '<div>Reporte interactivo</div>';
    render(
      <VisualReportDialog
        open={true}
        onClose={onClose}
        rawHtml={html}
        onRequestEdit={onRequestEdit}
      />,
    );

    const modifyBtn = screen.getByTestId('visual-report-edit-toggle');
    fireEvent.click(modifyBtn);

    const input = screen.getByTestId('visual-report-edit-input');
    fireEvent.change(input, { target: { value: 'Agrega una tabla de costos' } });

    fireEvent.click(screen.getByTestId('visual-report-edit-send'));

    expect(onRequestEdit).toHaveBeenCalledWith('Agrega una tabla de costos', html);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
