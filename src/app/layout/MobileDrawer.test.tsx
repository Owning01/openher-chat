import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileDrawer } from './MobileDrawer';

vi.mock('./Sidebar', () => ({
  Sidebar: () => (
    <div>
      <button type="button">Primero</button>
      <button type="button">Último</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('MobileDrawer', () => {
  it('enfoca el panel al abrir y restaura el foco previo al cerrar', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'abrir';
    document.body.append(trigger);
    trigger.focus();

    const { rerender, unmount } = render(<MobileDrawer open onClose={() => undefined} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    rerender(<MobileDrawer open={false} onClose={() => undefined} />);
    expect(document.activeElement).toBe(trigger);

    unmount();
    trigger.remove();
  });

  it('Tab cicla dentro del panel: panel → primero y último → primero', () => {
    render(<MobileDrawer open onClose={() => undefined} />);
    const first = screen.getByRole('button', { name: 'Primero' });
    const last = screen.getByRole('button', { name: 'Último' });

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab desde el primer elemento cicla al último', () => {
    render(<MobileDrawer open onClose={() => undefined} />);
    const first = screen.getByRole('button', { name: 'Primero' });
    const last = screen.getByRole('button', { name: 'Último' });

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Escape cierra el drawer', () => {
    const onClose = vi.fn();
    render(<MobileDrawer open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no renderiza nada cuando está cerrado', () => {
    render(<MobileDrawer open={false} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
