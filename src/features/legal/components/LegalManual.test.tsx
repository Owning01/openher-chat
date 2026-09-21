import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import { LegalManual } from './LegalManual';

describe('LegalManual Component', () => {
  beforeEach(() => {
    setLocale('es');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renderiza el manual con título, distintivos forenses y secciones principales', () => {
    render(<LegalManual />);

    expect(screen.getByTestId('legal-manual')).toBeInTheDocument();
    expect(screen.getByText('Manual Forense y Guía del Abogado')).toBeInTheDocument();
    expect(screen.getByText('Práctica Forense')).toBeInTheDocument();
    expect(screen.getByText('Secreto Profesional')).toBeInTheDocument();
    expect(screen.getByText('CPCCN / CCyC')).toBeInTheDocument();

    // Comprueba presencia de secciones
    expect(screen.getByTestId('manual-section-sec-privacy')).toBeInTheDocument();
    expect(screen.getByTestId('manual-section-sec-cases')).toBeInTheDocument();
    expect(screen.getByTestId('manual-section-sec-drafting')).toBeInTheDocument();
  });

  it('permite filtrar por categorías procesales', () => {
    render(<LegalManual />);

    const deadlinesFilter = screen.getByTestId('manual-filter-deadlines');
    fireEvent.click(deadlinesFilter);

    // Solo debe mostrar la sección de plazos
    expect(screen.getByTestId('manual-section-sec-deadlines')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-section-sec-privacy')).not.toBeInTheDocument();
  });

  it('permite buscar por palabras clave forenses en tiempo real', () => {
    render(<LegalManual />);

    const searchInput = screen.getByTestId('legal-manual-search');
    fireEvent.change(searchInput, { target: { value: 'Ley 48' } });

    // Debe mostrar la sección del caso federal
    expect(screen.getByTestId('manual-section-sec-auditor')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-section-sec-privacy')).not.toBeInTheDocument();
  });

  it('muestra el estado sin resultados y permite limpiar la búsqueda', () => {
    render(<LegalManual />);

    const searchInput = screen.getByTestId('legal-manual-search');
    fireEvent.change(searchInput, { target: { value: 'palabraInexistente123456' } });

    expect(screen.getByTestId('manual-no-results')).toBeInTheDocument();

    const clearButton = screen.getByTestId('manual-reset-search');
    fireEvent.click(clearButton);

    expect(screen.queryByTestId('manual-no-results')).not.toBeInTheDocument();
    expect(screen.getByTestId('manual-section-sec-privacy')).toBeInTheDocument();
  });

  it('permite colapsar y expandir secciones', () => {
    render(<LegalManual />);

    const privacySection = screen.getByTestId('manual-section-sec-privacy');
    const headerBtn = privacySection.querySelector('button')!;

    // Inicialmente expandida
    expect(screen.getByText(/Ley 23.187 art. 6 inc. f/)).toBeInTheDocument();

    // Click para colapsar
    fireEvent.click(headerBtn);
    expect(screen.queryByText(/Ley 23.187 art. 6 inc. f/)).not.toBeInTheDocument();

    // Click para volver a expandir
    fireEvent.click(headerBtn);
    expect(screen.getByText(/Ley 23.187 art. 6 inc. f/)).toBeInTheDocument();
  });

  it('copia la instrucción procesal al portapapeles con confirmación visual', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<LegalManual />);

    const copyButtons = screen.getAllByRole('button', { name: 'Copiar instrucción para el asistente' });
    expect(copyButtons.length).toBeGreaterThan(0);

    fireEvent.click(copyButtons[0]!);

    expect(writeTextMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('¡Copiado!')).toBeInTheDocument();
    });
  });
});
