import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLocale } from '@/i18n';

import { ToolCallCard } from './ToolCallCard';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('ToolCallCard', () => {
  it('formatea duraciones no finitas como 0 ms en vez de NaN', () => {
    render(<ToolCallCard name="web_search" result={{ ok: true, content: 'x', durationMs: Number.NaN }} />);

    expect(screen.getByText('0 ms')).toBeInTheDocument();
  });

  it('formatea duraciones válidas en ms y segundos', () => {
    render(<ToolCallCard name="web_search" result={{ ok: true, content: 'x', durationMs: 1200 }} />);

    expect(screen.getByText('1.2 s')).toBeInTheDocument();
  });
});
