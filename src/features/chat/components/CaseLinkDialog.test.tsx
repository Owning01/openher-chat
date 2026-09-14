import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';
import { createCaseStore } from '@/features/legal/state/caseStore';
import { CaseStoreProvider } from '@/features/legal/state/CaseStoreContext';
import { MemoryLegalCaseRepository } from '@/test/fakes/MemoryRepos';

import { CaseLinkDialog } from './CaseLinkDialog';
import type { CaseLinkDialogProps } from './CaseLinkDialog';

beforeEach(() => {
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function baseProps(overrides: Partial<CaseLinkDialogProps> = {}): CaseLinkDialogProps {
  return {
    open: true,
    legalConfigured: true,
    onLink: vi.fn(),
    onConfigureLegal: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('CaseLinkDialog', () => {
  it('degrada con mensaje si no hay provider del caseStore, sin romper', () => {
    const props = baseProps({ legalConfigured: false });
    render(<CaseLinkDialog {...props} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText('El listado de expedientes no está disponible en este contexto. Podés configurar el modo legal en Ajustes.'),
    ).toBeInTheDocument();
    const configure = screen.getByRole('button', { name: 'Configurar modo legal' });
    fireEvent.click(configure);
    expect(props.onConfigureLegal).toHaveBeenCalledTimes(1);
    expect(props.onLink).not.toHaveBeenCalled();
  });

  it('lista los expedientes existentes y vincula el elegido', async () => {
    const repo = new MemoryLegalCaseRepository();
    const created = await repo.create({
      title: 'Pérez c/ Gómez',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const store = createCaseStore({ cases: repo });
    const props = baseProps();
    render(
      <CaseStoreProvider store={store}>
        <CaseLinkDialog {...props} />
      </CaseStoreProvider>,
    );

    const option = await screen.findByTestId(`case-link-option-${created.id}`);
    fireEvent.click(option);
    expect(props.onLink).toHaveBeenCalledTimes(1);
    expect(props.onLink).toHaveBeenCalledWith(created.id);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('marca el expediente ya vinculado en vez de ofrecer vincularlo', async () => {
    const repo = new MemoryLegalCaseRepository();
    const created = await repo.create({
      title: 'Caso vinculado',
      jurisdiction: 'caba',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    const store = createCaseStore({ cases: repo });
    render(
      <CaseStoreProvider store={store}>
        <CaseLinkDialog {...baseProps({ linkedCaseId: created.id })} />
      </CaseStoreProvider>,
    );

    expect(await screen.findByTestId(`case-link-linked-${created.id}`)).toHaveTextContent('Vinculado');
    expect(screen.queryByTestId(`case-link-option-${created.id}`)).not.toBeInTheDocument();
  });

  it('muestra el mensaje de lista vacía cuando no hay expedientes', async () => {
    const store = createCaseStore({ cases: new MemoryLegalCaseRepository() });
    render(
      <CaseStoreProvider store={store}>
        <CaseLinkDialog {...baseProps()} />
      </CaseStoreProvider>,
    );

    expect(await screen.findByTestId('case-link-empty')).toHaveTextContent(
      'No hay expedientes. Creá uno mínimo para activar el modo legal.',
    );
  });

  it('crea un expediente mínimo y lo vincula', async () => {
    const repo = new MemoryLegalCaseRepository();
    const store = createCaseStore({ cases: repo });
    const props = baseProps({ defaultJurisdiction: 'caba' });
    render(
      <CaseStoreProvider store={store}>
        <CaseLinkDialog {...props} />
      </CaseStoreProvider>,
    );

    await screen.findByTestId('case-link-empty');
    expect(screen.getByTestId('case-link-jurisdiction')).toHaveValue('caba');

    fireEvent.change(screen.getByTestId('case-link-title'), { target: { value: 'Nuevo caso' } });
    fireEvent.click(screen.getByTestId('case-link-create'));

    await waitFor(() => expect(props.onLink).toHaveBeenCalledTimes(1));
    const linkedId = (props.onLink as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const persisted = await repo.get(linkedId);
    expect(persisted?.title).toBe('Nuevo caso');
    expect(persisted?.jurisdiction).toBe('caba');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('exige un título para crear el expediente', async () => {
    const store = createCaseStore({ cases: new MemoryLegalCaseRepository() });
    const props = baseProps();
    render(
      <CaseStoreProvider store={store}>
        <CaseLinkDialog {...props} />
      </CaseStoreProvider>,
    );

    await screen.findByTestId('case-link-empty');
    fireEvent.click(screen.getByTestId('case-link-create'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresá un título para el expediente.');
    expect(props.onLink).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('ofrece configurar el modo legal cuando el workspace no está configurado', async () => {
    const store = createCaseStore({ cases: new MemoryLegalCaseRepository() });
    const props = baseProps({ legalConfigured: false });
    render(
      <CaseStoreProvider store={store}>
        <CaseLinkDialog {...props} />
      </CaseStoreProvider>,
    );

    await screen.findByTestId('case-link-empty');
    const configure = screen.getByRole('button', { name: 'Configurar modo legal' });
    fireEvent.click(configure);
    expect(props.onConfigureLegal).toHaveBeenCalledTimes(1);
    // La lista sigue disponible: configurar es una vía, no un bloqueo.
    expect(screen.getByTestId('case-link-title')).toBeInTheDocument();
  });

  it('no renderiza nada cuando está cerrado', () => {
    render(<CaseLinkDialog {...baseProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
