/**
 * Detección de plataforma sin depender de imports de Capacitor.
 *
 * En Android (WebView nativo) `Capacitor.isNativePlatform()` es `true` y las
 * requests directas no pasan por CORS; en navegador/desktop web sí, por eso un
 * fallo de red se reporta como `cors_blocked` con mensaje accionable.
 */

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
}

export function isNativePlatform(): boolean {
  const scope = globalThis as unknown as { Capacitor?: CapacitorBridge };
  const capacitor = scope.Capacitor;
  if (capacitor === undefined || typeof capacitor.isNativePlatform !== 'function') return false;
  try {
    return capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

export function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !isNativePlatform();
}
