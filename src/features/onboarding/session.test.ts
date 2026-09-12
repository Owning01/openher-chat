import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultSettings } from '@/domain/settings/defaults';

import {
  isOnboardingResolvedThisSession,
  needsOnboarding,
  resetOnboardingSession,
  resolveOnboardingSession,
} from './session';

beforeEach(() => {
  resetOnboardingSession();
});

describe('needsOnboarding', () => {
  it('no redirige si hay proveedor activo aunque el flag esté apagado', () => {
    expect(needsOnboarding({ onboardingCompleted: false, activeProviderId: 'groq' })).toBe(false);
  });

  it('es true cuando no hay proveedor activo aunque esté completado', () => {
    expect(needsOnboarding({ onboardingCompleted: true, activeProviderId: null })).toBe(true);
  });

  it('es false con onboarding completado y proveedor activo', () => {
    expect(needsOnboarding({ onboardingCompleted: true, activeProviderId: 'groq' })).toBe(false);
    expect(needsOnboarding(createDefaultSettings(1))).toBe(true);
  });
});

describe('flag de sesión del onboarding', () => {
  it('arranca sin resolver y se marca al completar o saltar', () => {
    expect(isOnboardingResolvedThisSession()).toBe(false);

    resolveOnboardingSession();
    expect(isOnboardingResolvedThisSession()).toBe(true);

    resetOnboardingSession();
    expect(isOnboardingResolvedThisSession()).toBe(false);
  });
});
