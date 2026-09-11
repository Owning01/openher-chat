import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog';

afterEach(cleanup);

describe('Dialog', () => {
  it('muestra el título, enfoca y cierra con Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Ajustes">
        <p>Contenido</p>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Ajustes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no renderiza nada si open es false', () => {
    const { container } = render(<Dialog open={false} onClose={vi.fn()} title="Ajustes" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('atrapa el foco dentro del panel con Tab y Shift+Tab', () => {
    const outside = document.createElement('button');
    outside.textContent = 'Fuera';
    document.body.append(outside);

    try {
      render(
        <Dialog open onClose={vi.fn()} title="Ajustes" footer={<button type="button">Guardar</button>}>
          <button type="button">Primero</button>
          <button type="button">Segundo</button>
        </Dialog>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Ajustes' });
      const close = screen.getByRole('button', { name: 'Cerrar' });
      const first = screen.getByRole('button', { name: 'Primero' });
      const second = screen.getByRole('button', { name: 'Segundo' });
      const last = screen.getByRole('button', { name: 'Guardar' });

      expect(close).toHaveFocus();

      // Tab sobre cada focusable: nunca sale del panel (jsdom no ejecuta el default).
      for (const element of [close, first, second, last]) {
        element.focus();
        fireEvent.keyDown(element, { key: 'Tab' });
        expect(dialog.contains(document.activeElement)).toBe(true);
      }

      // En el último, Tab cicla al primero; en el primero, Shift+Tab vuelve al último.
      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(close).toHaveFocus();

      fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
      expect(last).toHaveFocus();

      // Con el foco fuera del panel, el trap lo devuelve al primer focusable (Cerrar).
      outside.focus();
      fireEvent.keyDown(outside, { key: 'Tab' });
      expect(close).toHaveFocus();

      outside.focus();
      fireEvent.keyDown(outside, { key: 'Tab', shiftKey: true });
      expect(last).toHaveFocus();
      expect(dialog.contains(document.activeElement)).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it('ignora focusables ocultos o deshabilitados y no rompe el wrap', () => {
    render(
      <Dialog
        open
        onClose={vi.fn()}
        title="Ajustes"
        footer={
          <>
            <button type="button">Guardar</button>
            <input type="hidden" aria-label="Oculto" />
          </>
        }
      >
        <button type="button" disabled>
          Deshabilitado
        </button>
        <button type="button" hidden>
          Oculto
        </button>
        <button type="button" aria-hidden="true">
          Aria oculto
        </button>
        <fieldset disabled>
          <button type="button">En fieldset</button>
        </fieldset>
        <button type="button">Visible</button>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Ajustes' });
    const close = within(dialog).getByRole('button', { name: 'Cerrar' });
    const save = within(dialog).getByRole('button', { name: 'Guardar' });
    expect(within(dialog).getByRole('button', { name: 'Visible' })).toBeInTheDocument();

    expect(close).toHaveFocus();

    // El input hidden del footer no debe ser el último focusable: Tab desde Guardar cicla a Cerrar.
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });

  it('con dos diálogos abiertos, Escape y Tab actúan solo en el superior', () => {
    const onCloseBottom = vi.fn();
    const onCloseTop = vi.fn();
    const { rerender } = render(
      <>
        <Dialog
          open
          onClose={onCloseBottom}
          title="Inferior"
          footer={<button type="button">Guardar inferior</button>}
        >
          <button type="button">Botón inferior</button>
        </Dialog>
        <Dialog
          open
          onClose={onCloseTop}
          title="Superior"
          footer={<button type="button">Guardar superior</button>}
        >
          <button type="button">Botón superior</button>
        </Dialog>
      </>,
    );

    const bottom = screen.getByRole('dialog', { name: 'Inferior' });
    const top = screen.getByRole('dialog', { name: 'Superior' });
    const topClose = within(top).getByRole('button', { name: 'Cerrar' });
    const topSave = within(top).getByRole('button', { name: 'Guardar superior' });

    expect(topClose).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseTop).toHaveBeenCalledTimes(1);
    expect(onCloseBottom).not.toHaveBeenCalled();

    const outside = document.createElement('button');
    outside.textContent = 'Fuera';
    document.body.append(outside);
    try {
      outside.focus();
      fireEvent.keyDown(outside, { key: 'Tab' });
      expect(topClose).toHaveFocus();

      fireEvent.keyDown(topClose, { key: 'Tab', shiftKey: true });
      expect(topSave).toHaveFocus();
      expect(bottom.contains(document.activeElement)).toBe(false);
    } finally {
      outside.remove();
    }

    // Al desmontar el superior, el inferior vuelve a atender Escape.
    rerender(
      <Dialog
        open
        onClose={onCloseBottom}
        title="Inferior"
        footer={<button type="button">Guardar inferior</button>}
      >
        <button type="button">Botón inferior</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseBottom).toHaveBeenCalledTimes(1);
  });
});
