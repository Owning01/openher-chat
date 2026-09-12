import { lazy, Suspense, useMemo, useSyncExternalStore } from 'react';

import { ChatPage } from '@/features/chat/ChatPage';
import { Spinner } from '@/shared/ui';

// Rutas secundarias en chunks propios: el chat (ruta principal) queda en el bundle inicial.
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const OnboardingPage = lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((module) => ({ default: module.OnboardingPage })),
);

export type Route =
  | { name: 'chat'; conversationId: string | null }
  | { name: 'settings' }
  // `conversationId: null` mantiene estable el acceso a `route.conversationId` del layout (TopBar).
  | { name: 'onboarding'; conversationId: null };

const DEFAULT_ROUTE: Route = { name: 'chat', conversationId: null };

/** Hash → ruta. `#/chat/:id?`, `#/settings` y `#/onboarding`; cualquier otro valor cae a `#/chat`. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const path = (raw.split('?')[0] ?? '').replace(/^\/+/, '');
  const [head, segment] = path.split('/');

  if (head === 'settings') return { name: 'settings' };
  if (head === 'onboarding') return { name: 'onboarding', conversationId: null };
  if (head === 'chat') {
    return {
      name: 'chat',
      conversationId: segment !== undefined && segment !== '' ? safeDecode(segment) : null,
    };
  }
  return DEFAULT_ROUTE;
}

export function chatHref(conversationId?: string | null): string {
  return conversationId === undefined || conversationId === null || conversationId === ''
    ? '#/chat'
    : `#/chat/${encodeURIComponent(conversationId)}`;
}

export const SETTINGS_HREF = '#/settings';
export const ONBOARDING_HREF = '#/onboarding';

/** Navegación por hash sin recargar el documento. */
export function navigate(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === next) return;
  window.location.hash = next;
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeToHash, readHash, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}

/** Mapea la ruta activa a su contenido. */
export function AppRoutes() {
  const route = useRoute();

  if (route.name === 'onboarding') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <OnboardingPage />
      </Suspense>
    );
  }
  if (route.name === 'settings') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <SettingsPage />
      </Suspense>
    );
  }
  return <ChatPage />;
}

/** Placeholder accesible mientras se descarga el chunk de una ruta diferida. */
function RouteFallback() {
  return (
    <div data-testid="route-loading" className="grid min-h-40 flex-1 place-items-center p-6">
      <Spinner size="lg" />
    </div>
  );
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash(): string {
  return window.location.hash;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
