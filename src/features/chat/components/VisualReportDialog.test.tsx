import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VisualReportDialog } from './VisualReportDialog';
import { useArtifactStore } from '../state/artifactStore';

describe('VisualReportDialog', () => {
  beforeEach(() => {
    useArtifactStore.setState({ artifacts: {}, latestHtml: null });
  });

  afterEach(() => {
    cleanup();
    useArtifactStore.setState({ artifacts: {}, latestHtml: null });
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

  it('permite cambiar a la pestaña de código, editar directamente y guardar como nueva versión', () => {
    render(
      <VisualReportDialog
        open={true}
        onClose={vi.fn()}
        rawHtml="<h1>Versión Inicial</h1>"
        messageId="msg-edit-test"
      />,
    );

    // Cambia a pestaña Código
    const codeTab = screen.getByTestId('visual-report-tab-code');
    fireEvent.click(codeTab);

    // Verifica que el editor contiene el HTML
    const editor = screen.getByTestId('visual-report-code-editor');
    expect(editor).toHaveValue('<h1>Versión Inicial</h1>');

    // Modifica el código
    fireEvent.change(editor, { target: { value: '<h1>Versión Editada Manualmente</h1>' } });
    const saveBtn = screen.getByTestId('visual-report-save-code');
    fireEvent.click(saveBtn);

    // Vuelve a la pestaña Preview y verifica que se actualizó
    const previewTab = screen.getByTestId('visual-report-tab-preview');
    fireEvent.click(previewTab);

    const iframe = screen.getByTestId('visual-report-iframe');
    expect(iframe.getAttribute('srcdoc')).toContain('<h1>Versión Editada Manualmente</h1>');
  });

  it('muestra el historial de versiones y permite restaurar una versión anterior', () => {
    render(
      <VisualReportDialog
        open={true}
        onClose={vi.fn()}
        rawHtml="<h1>Versión 1</h1>"
        messageId="msg-history-test"
      />,
    );

    // Edita para crear v2
    fireEvent.click(screen.getByTestId('visual-report-tab-code'));
    const editor = screen.getByTestId('visual-report-code-editor');
    fireEvent.change(editor, { target: { value: '<h1>Versión 2</h1>' } });
    fireEvent.click(screen.getByTestId('visual-report-save-code'));

    // Cambia a pestaña Historial
    const historyTab = screen.getByTestId('visual-report-tab-history');
    fireEvent.click(historyTab);

    expect(screen.getByTestId('visual-report-history-view')).toBeInTheDocument();
    expect(screen.getByText('Versión 1')).toBeInTheDocument();
    expect(screen.getByText('Versión 2')).toBeInTheDocument();

    // Restaura versión 1
    const restoreBtn = screen.getByTestId('restore-version-1');
    fireEvent.click(restoreBtn);

    // Automáticamente vuelve a preview con el contenido restaurado
    const iframe = screen.getByTestId('visual-report-iframe');
    expect(iframe.getAttribute('srcdoc')).toContain('<h1>Versión 1</h1>');
  });
});

