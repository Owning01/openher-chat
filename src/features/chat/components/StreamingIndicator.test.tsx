import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLocale } from '@/i18n';

import { StreamingIndicator } from './StreamingIndicator';

beforeEach(() => {
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('StreamingIndicator', () => {
  it('anuncia el estado y muestra tres puntos decorativos', () => {
    render(<StreamingIndicator />);

    const indicator = screen.getByTestId('chat-streaming-indicator');
    expect(indicator).toHaveAttribute('role', 'status');
    const dots = indicator.querySelector('.anim-dots');
    expect(dots?.childElementCount).toBe(3);
    expect(dots?.getAttribute('aria-hidden')).toBe('true');
  });
});
