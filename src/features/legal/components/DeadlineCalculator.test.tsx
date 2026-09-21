import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LegalCase } from '@/domain/types/legal';
import { setLocale } from '@/i18n';

import { DeadlineCalculator } from './DeadlineCalculator';

beforeEach(() => setLocale('es'));
afterEach(() => {
  cleanup();
  setLocale('es');
});

const CASE: LegalCase = {
  id: 'case-test',
  title: 'Caso Daños',
  status: 'active',
  jurisdiction: 'national',
  court: 'Juzgado Civil 5',
  matter: 'civil',
  clientRole: 'plaintiff',
  parties: [],
  facts: [
    {
      id: 'f-1',
      statement: 'Accidente de tránsito en avenida',
      date: '2023-05-10',
      certainty: 'certain',
    },
  ],
  keyDates: [
    {
      id: 'k-1',
      label: 'Mediación prejudicial cerrada',
      date: '2023-11-20',
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

describe('DeadlineCalculator', () => {
  it('renderiza la calculadora y calcula el vencimiento en días hábiles', () => {
    render(<DeadlineCalculator caseData={CASE} />);

    expect(screen.getByTestId('deadline-calculator')).toBeInTheDocument();
    expect(screen.queryByTestId('deadline-custom-result')).not.toBeInTheDocument();

    const calcBtn = screen.getByRole('button', { name: /Calcular vencimiento/i });
    fireEvent.click(calcBtn);

    expect(screen.getByTestId('deadline-custom-result')).toBeInTheDocument();
    expect(screen.getByText(/Vencimiento calculado/i)).toBeInTheDocument();
  });

  it('muestra la tabla de prescripción cruzando los hechos con las reglas del CCyC', () => {
    render(<DeadlineCalculator caseData={CASE} />);

    expect(screen.getByText(/Reglas de prescripción aplicables/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Accidente de tránsito/i).length).toBeGreaterThan(0);
  });
});
