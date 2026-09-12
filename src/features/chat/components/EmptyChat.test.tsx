import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import { EmptyChat } from './EmptyChat';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('EmptyChat', () => {
  it('muestra sugerencias que disparan el envío', () => {
    const onSuggestion = vi.fn();
    render(<EmptyChat onSuggestion={onSuggestion} />);

    const suggestions = screen.getAllByRole('button');
    expect(suggestions).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Explícame un concepto complejo con una analogía' }));

    expect(onSuggestion).toHaveBeenCalledWith('Explícame un concepto complejo con una analogía');
  });

  it('lista las sugerencias con etiqueta accesible', () => {
    render(<EmptyChat onSuggestion={() => undefined} />);

    expect(screen.getByRole('list', { name: 'Sugerencias' })).toBeInTheDocument();
  });
});
