import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('renderiza y responde al click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('en loading se deshabilita y marca aria-busy', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Guardar
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
