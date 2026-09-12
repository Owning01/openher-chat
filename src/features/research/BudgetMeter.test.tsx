import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLocale } from '@/i18n';

import { BudgetMeter } from './BudgetMeter';
import type { BudgetUsage } from './selectors';

const SAFE_USAGE: BudgetUsage = {
  steps: 2,
  maxSteps: 6,
  toolCalls: 1,
  maxToolCalls: 12,
  tokens: 100,
  maxTotalTokens: 20000,
  wallClockMs: 500,
  maxWallClockMs: 60000,
};

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('BudgetMeter', () => {
  it('nunca muestra NaN/Infinity en texto ni ARIA: cae a 0', () => {
    const usage: BudgetUsage = {
      steps: Number.NaN,
      maxSteps: Number.NaN,
      toolCalls: Number.POSITIVE_INFINITY,
      maxToolCalls: Number.NEGATIVE_INFINITY,
      tokens: Number.NaN,
      maxTotalTokens: Number.NaN,
      wallClockMs: Number.NaN,
      maxWallClockMs: Number.NaN,
    };

    render(<BudgetMeter usage={usage} />);

    const budget = screen.getByTestId('research-budget');
    expect(budget).not.toHaveTextContent('NaN');
    expect(budget).not.toHaveTextContent('Infinity');
    expect(budget).toHaveTextContent('0 / 0');

    for (const bar of screen.getAllByRole('progressbar')) {
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '0');
      expect(bar).toHaveAttribute('aria-valuenow', '0');
    }
  });

  it('clampea el valor usado al máximo en el ARIA', () => {
    render(<BudgetMeter usage={{ ...SAFE_USAGE, steps: 10, maxSteps: 4 }} />);

    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveAttribute('aria-valuemax', '4');
    expect(bars[0]).toHaveAttribute('aria-valuenow', '4');
  });
});
