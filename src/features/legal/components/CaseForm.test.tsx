import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import { CaseForm } from './CaseForm';

afterEach(() => {
  cleanup();
  setLocale('es');
});

function fillValidForm(): void {
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Demanda por incumplimiento' } });
  fireEvent.change(screen.getByLabelText('Fuero / juzgado'), { target: { value: 'Juzgado Civil 1' } });
  fireEvent.change(screen.getByLabelText('Jurisdicción'), { target: { value: 'caba' } });
  fireEvent.change(screen.getByLabelText('Materia'), { target: { value: 'commercial' } });
  fireEvent.change(screen.getByLabelText('Rol del cliente'), { target: { value: 'defendant' } });
}

describe('CaseForm', () => {
  it('muestra errores y no envía con título y fuero vacíos', () => {
    const onSubmit = vi.fn();
    render(<CaseForm onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId('case-form-submit'));

    expect(screen.getByTestId('case-form-title-error')).toHaveTextContent('El título es obligatorio.');
    expect(screen.getByTestId('case-form-court-error')).toHaveTextContent('El fuero es obligatorio.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('envía un CreateLegalCaseInput válido con los valores elegidos', () => {
    const onSubmit = vi.fn();
    render(<CaseForm onSubmit={onSubmit} />);

    fillValidForm();
    fireEvent.click(screen.getByTestId('case-form-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Demanda por incumplimiento',
      jurisdiction: 'caba',
      court: 'Juzgado Civil 1',
      matter: 'commercial',
      clientRole: 'defendant',
    });
    expect(screen.queryByTestId('case-form-title-error')).toBeNull();
    expect(screen.queryByTestId('case-form-court-error')).toBeNull();
  });

  it('recorta espacios y usa los valores por defecto sin tocar los selects', () => {
    const onSubmit = vi.fn();
    render(<CaseForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: '  Caso testigo  ' } });
    fireEvent.change(screen.getByLabelText('Fuero / juzgado'), { target: { value: '  Juzgado 2  ' } });
    fireEvent.click(screen.getByTestId('case-form-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Caso testigo',
      jurisdiction: 'national',
      court: 'Juzgado 2',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
  });

  it('muestra el error de alta sin enviar de nuevo', () => {
    const onSubmit = vi.fn();
    render(<CaseForm onSubmit={onSubmit} submitError="No se pudo crear el expediente." />);

    expect(screen.getByTestId('case-form-submit-error')).toHaveTextContent('No se pudo crear el expediente.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('llama onCancel desde el botón secundario', () => {
    const onCancel = vi.fn();
    render(<CaseForm onSubmit={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
