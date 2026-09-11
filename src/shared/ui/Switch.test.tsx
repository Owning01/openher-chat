import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

afterEach(cleanup);

describe('Switch', () => {
  it('expone role switch accesible y alterna', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange} label="Modo oscuro" />,
    );

    const control = screen.getByRole('switch', { name: 'Modo oscuro' });
    expect(control).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    rerender(<Switch checked onCheckedChange={onCheckedChange} label="Modo oscuro" />);
    expect(screen.getByRole('switch', { name: 'Modo oscuro' })).toHaveAttribute('aria-checked', 'true');
  });

  it('aria-label tiene prioridad sobre label como nombre accesible', () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} aria-label="X" label="Y" />);

    expect(screen.getByRole('switch', { name: 'X' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Y' })).not.toBeInTheDocument();
  });
});
