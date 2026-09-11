import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearToasts, ToastViewport, useToastStore } from './Toast';

afterEach(() => {
  cleanup();
  clearToasts();
});

beforeEach(() => {
  clearToasts();
});

describe('Toast', () => {
  it('respeta la cola máxima de 3', () => {
    render(<ToastViewport />);
    const { push } = useToastStore.getState();

    act(() => {
      push({ title: 'Uno', durationMs: null });
      push({ title: 'Dos', durationMs: null });
      push({ title: 'Tres', durationMs: null });
      push({ title: 'Cuatro', durationMs: null });
    });

    expect(screen.queryByText('Uno')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.getByText('Cuatro')).toBeInTheDocument();
  });

  it('descarta un toast con el botón de cierre', () => {
    render(<ToastViewport />);

    act(() => {
      useToastStore.getState().push({ title: 'Hola', durationMs: null });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByText('Hola')).toBeNull();
  });
});
