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
// Ruta legal en chunk propio: la gestión de expedientes no entra al bundle inicial.
const LegalPage = lazy(() =>
  import('@/features/legal/LegalPage').then((module) => ({ default: module.LegalPage })),
);

export type Route =
  | { name: 'chat'; conversationId: string | null }
  | { name: 'settings' }
  // `conversationId: null` mantiene estable el acceso a `route.conversationId` del layout (TopBar).
  | { name: 'onboarding'; conversationId: null }
  // `login` es la entrada pública cuando hay auth sin sesión (la ve el AuthGate).
  | { name: 'login'; conversationId: null }
  // `caseId`/`conversationId` nulos = lista sin selección; el layout los lee igual que en el chat.
  | { name: 'legal'; caseId: string | null; conversationId: string | null };

const DEFAULT_ROUTE: Route = { name: 'chat', conversationId: null };

/** Hash → ruta. `#/chat/:id?`, `#/legal/:caseId?/:conversationId?`, `#/settings` y `#/onboarding`; cualquier otro valor cae a `#/chat`. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split('?');
  const path = (pathPart ?? '').replace(/^\/+/, '');
  const [head, segment, rest] = path.split('/');

  if (head === 'settings') return { name: 'settings' };
  if (head === 'onboarding') return { name: 'onboarding', conversationId: null };
  if (head === 'login') return { name: 'login', conversationId: null };
  if (head === 'legal') {
    const caseId = segment !== undefined && segment !== '' ? safeDecode(segment) : null;
    const conversationId =
      rest !== undefined && rest !== ''
        ? safeDecode(rest)
        : readQueryConversation(queryPart ?? '');
    return { name: 'legal', caseId, conversationId };
  }
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
export const LOGIN_HREF = '#/login';
export const LEGAL_HREF = '#/legal';

/** Href del expediente: `#/legal`, `#/legal/:caseId` o `#/legal/:caseId/:conversationId` (query si hay conversación sin caso). */
export function legalHref(caseId?: string | null, conversationId?: string | null): string {
  const hasCase = caseId !== undefined && caseId !== null && caseId !== '';
  const hasConversation = conversationId !== undefined && conversationId !== null && conversationId !== '';
  if (!hasCase && !hasConversation) return LEGAL_HREF;
  if (!hasCase) return `${LEGAL_HREF}?conversationId=${encodeURIComponent(conversationId ?? '')}`;
  const base = `${LEGAL_HREF}/${encodeURIComponent(caseId ?? '')}`;
  return hasConversation ? `${base}/${encodeURIComponent(conversationId ?? '')}` : base;
}

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
  if (route.name === 'legal') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <LegalPage />
      </Suspense>
    );
  }
  // `#/login` con sesión muestra el chat (sin sesión el AuthGate intercepta antes).
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

/** Lee `conversationId` (o `conversation`) del query de `#/legal`; ausente o vacío = `null`. */
function readQueryConversation(query: string): string | null {
  if (query === '') return null;
  // URLSearchParams ya decodifica una vez; no se re-decodifica para no corromper `%25`.
  const raw = new URLSearchParams(query).get('conversationId') ?? new URLSearchParams(query).get('conversation');
  if (raw === null || raw === '') return null;
  return raw;
}
