import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLocale, t } from '@/i18n';

import { LandingPage } from './LandingPage';

beforeEach(() => {
  localStorage.clear();
  setLocale('es');
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  setLocale('es');
  window.location.hash = '';
});

describe('LandingPage', () => {
  it('explica qué es la app y ofrece el ingreso', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { level: 1, name: t('auth.landingTitle') })).toBeInTheDocument();
    expect(screen.getByText(t('auth.landingSubtitle'))).toBeInTheDocument();
    expect(screen.getByText(t('auth.featureLegalTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('auth.sampleQuestion'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: t('auth.landingCtaLogin') }).length).toBeGreaterThanOrEqual(2);
  });

  it('el CTA principal navega a #/login', () => {
    render(<LandingPage />);

    const ctas = screen.getAllByRole('button', { name: t('auth.landingCtaLogin') });
    const primary = ctas[ctas.length - 1];
    if (primary === undefined) throw new Error('falta el CTA principal');
    fireEvent.click(primary);

    expect(window.location.hash).toBe('#/login');
  });
});
