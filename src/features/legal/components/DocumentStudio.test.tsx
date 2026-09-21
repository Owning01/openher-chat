import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCUMENT_SOURCE_DISCLAIMER, DOCUMENT_WATERMARK } from '@/domain/legal/document';
import type { AcknowledgmentRecord, LegalCase } from '@/domain/types/legal';
import { setLocale } from '@/i18n';

import { DocumentStudio } from './DocumentStudio';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

const CASE: LegalCase = {
  id: 'case-1',
  title: 'Caso testigo',
  status: 'active',
  jurisdiction: 'national',
  court: 'Juzgado Civil 1',
  matter: 'civil',
  clientRole: 'plaintiff',
  parties: [],
  facts: [],
  keyDates: [],
  createdAt: 1,
  updatedAt: 1,
};

function mockClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('DocumentStudio', () => {
  it('ofrece las plantillas registradas y muestra la checklist de la demanda (art. 330)', () => {
    render(<DocumentStudio caseData={CASE} index={null} />);

    const select = screen.getByTestId('document-template') as HTMLSelectElement;
    expect(select.options).toHaveLength(5);
    const checklist = screen.getByTestId('document-checklist');
    expect(checklist).toHaveTextContent('CPCCN-330');
    expect(checklist).toHaveTextContent('La petición en términos claros y positivos');
  });

  it('cambia la checklist al elegir otra plantilla', () => {
    render(<DocumentStudio caseData={CASE} index={null} />);

    fireEvent.change(screen.getByTestId('document-template'), {
      target: { value: 'ar-demand-letter' },
    });

    const checklist = screen.getByTestId('document-checklist');
    expect(checklist).toHaveTextContent('CCyC-886');
    expect(checklist).toHaveTextContent('Apercibimiento de las consecuencias legales');
  });

  it('la vista previa incluye el watermark y el disclaimer no descartables', () => {
    render(<DocumentStudio caseData={CASE} index={null} />);

    const preview = screen.getByTestId('document-preview');
    expect(preview).toHaveTextContent(DOCUMENT_WATERMARK);
    expect(preview).toHaveTextContent(DOCUMENT_SOURCE_DISCLAIMER);
  });

  it('bloquea la exportación sin consentimiento explícito', () => {
    render(<DocumentStudio caseData={CASE} index={null} />);

    expect(screen.getByTestId('document-export-blocked')).toHaveTextContent(
      'Exportación bloqueada',
    );
    expect(screen.getByTestId('document-export-download')).toBeDisabled();
    expect(screen.getByTestId('document-export-docx')).toBeDisabled();
    expect(screen.getByTestId('document-export-copy')).toBeDisabled();
    expect(screen.getByTestId('document-export-print')).toBeDisabled();
  });

  it('habilita la exportación con consentimiento y registra el reconocimiento honesto', async () => {
    const writeText = mockClipboard();
    const onAppendAcknowledgment = vi.fn<(record: AcknowledgmentRecord) => Promise<void>>();
    onAppendAcknowledgment.mockResolvedValue(undefined);
    render(
      <DocumentStudio
        caseData={CASE}
        index={null}
        onAppendAcknowledgment={onAppendAcknowledgment}
      />,
    );

    fireEvent.click(screen.getByTestId('document-consent'));

    expect(screen.queryByTestId('document-export-blocked')).toBeNull();
    expect(screen.getByTestId('document-export-copy')).toBeEnabled();
    expect(screen.getByTestId('document-export-docx')).toBeEnabled();

    fireEvent.click(screen.getByTestId('document-export-copy'));

    await vi.waitFor(() => expect(onAppendAcknowledgment).toHaveBeenCalledTimes(1));
    const record = onAppendAcknowledgment.mock.calls[0]?.[0];
    expect(record?.caseId).toBe('case-1');
    expect(typeof record?.contentHash).toBe('string');
    expect(record?.contentHash).toHaveLength(64);
    expect(typeof record?.unverifiedCount).toBe('number');

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain(DOCUMENT_WATERMARK);
    expect(copied).toContain(DOCUMENT_SOURCE_DISCLAIMER);
    expect(await screen.findByTestId('document-consent-recorded')).toHaveTextContent(
      'Reconocimiento registrado',
    );
  });

  it('documenta el consentimiento por sesión cuando no hay repositorio', async () => {
    mockClipboard();
    render(<DocumentStudio caseData={CASE} index={null} />);

    expect(screen.getByText(/vale sólo para esta sesión/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('document-consent'));
    fireEvent.click(screen.getByTestId('document-export-copy'));

    expect(await screen.findByTestId('document-consent-recorded')).toHaveTextContent(
      'Reconocimiento registrado',
    );
  });

  it('documenta los límites de plataforma del export', () => {
    render(<DocumentStudio caseData={CASE} index={null} />);

    const limits = screen.getByTestId('document-limits');
    expect(limits).toHaveTextContent('no presentable');
    expect(limits).toHaveTextContent('Android');
  });

  it('permite alternar a la vista de redacción por capítulos y copiar el prompt estructurado', async () => {
    const writeText = mockClipboard();
    render(<DocumentStudio caseData={CASE} index={null} />);

    // Alternar a vista de capítulos
    fireEvent.click(screen.getByTestId('document-view-sections'));
    expect(screen.getByTestId('document-sections-view')).toBeVisible();

    // El botón para pedir redacción al asistente copia el prompt anti-truncamiento
    const promptBtn = screen.getByTestId('document-section-prompt-btn');
    fireEvent.click(promptBtn);

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copiedPrompt = writeText.mock.calls[0]?.[0] ?? '';
    expect(copiedPrompt).toContain('ANTI-TRUNCAMIENTO');
    expect(copiedPrompt).toContain('Caso testigo');

    expect(await screen.findByTestId('document-section-prompt-feedback')).toHaveTextContent(
      'Prompt copiado',
    );
  });

  it('permite alternar a la auditoría forense y muestra las métricas de completitud', () => {
    render(<DocumentStudio caseData={CASE} index={null} />);

    // Alternar a vista de auditoría
    fireEvent.click(screen.getByTestId('document-view-audit'));
    const auditPanel = screen.getByTestId('document-audit-panel');
    expect(auditPanel).toBeVisible();

    // Contiene métricas de palabras y fojas
    expect(auditPanel).toHaveTextContent('Palabras');
    expect(auditPanel).toHaveTextContent('Fojas aprox.');
    expect(auditPanel).toHaveTextContent('Reserva Caso Federal');
  });
});
