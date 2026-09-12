import type { AppSettings } from '@/domain/types/settings';

let onboardingResolvedThisSession = false;

/**
 * El onboarding solo re-redirige cuando no hay proveedor activo: si ya existe uno
 * (p. ej. creado antes de un reload) un flag `onboardingCompleted` apagado no
 * debe volver a secuestrar la navegación.
 */
export function needsOnboarding(
  settings: Pick<AppSettings, 'onboardingCompleted' | 'activeProviderId'>,
): boolean {
  return settings.activeProviderId === null;
}

/**
 * Evita volver a redirigir a `#/onboarding` después de completarlo o saltarlo
 * dentro de la misma sesión (el redirect solo corre al bootear).
 */
export function resolveOnboardingSession(): void {
  onboardingResolvedThisSession = true;
}

export function isOnboardingResolvedThisSession(): boolean {
  return onboardingResolvedThisSession;
}

/** Restaura el flag de sesión; aislar tests del arranque de la app. */
export function resetOnboardingSession(): void {
  onboardingResolvedThisSession = false;
}
