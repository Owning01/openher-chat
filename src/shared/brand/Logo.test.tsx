import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from './Logo';

describe('Logo', () => {
  it('es decorativo por defecto junto a texto visible', () => {
    const { container } = render(<Logo size={28} />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('28');
  });

  it('expone role img con título cuando se pide etiqueta', () => {
    render(<Logo title="OpenHer Chat" />);

    expect(screen.getByRole('img', { name: 'OpenHer Chat' })).toBeInTheDocument();
  });
});
