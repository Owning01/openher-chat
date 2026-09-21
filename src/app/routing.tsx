import { Component, lazy, Suspense, useMemo, useSyncExternalStore } from 'react';
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';

import { ChatPage } from '@/features/chat/ChatPage';
import { useT } from '@/i18n/useT';
import { Button, Spinner } from '@/shared/ui';

import { AlertBanner } from './layout/AlertBanner';

type RouteComponent = ComponentType<Record<string, unknown>>;

/**
 * `React.lazy` con auto-recuperación para el caso clásico de deploy: una
 * pestaña que quedó abierta con el shell viejo pide un chunk con hash que el
 * servidor ya reemplazó y el import falla (antes: spinner eterno). El primer
 * fallo recarga la página (trae shell y chunks nuevos); un segundo fallo deja
 * el error visible con reintento manual en vez de un loop de recargas.
 */
export function lazyWithRetry(
  key: string,
  importer: () => Promise<{ default: RouteComponent }>,
  reload: () => void = () => window.location.reload(),
): LazyExoticComponent<RouteComponent> {
  return lazy(() =>
    importer().then(
      (module) => {
        clearRetryFlag(key);
        return module;
      },
      (error: unknown) => {
        if (hasRetryFlag(key)) throw error;
        setRetryFlag(key);
        reload();
        // La recarga reemplaza la página; el fallback queda visible mientras tanto.
        return new Promise<never>(() => undefined);
      },
    ),
  );
}

const RETRY_FLAG_PREFIX = 'openher.chunk-retry.';

function hasRetryFlag(key: string): boolean {
  return readSession(`${RETRY_FLAG_PREFIX}${key}`) !== null;
}

function setRetryFlag(key: string): void {
  writeSession(`${RETRY_FLAG_PREFIX}${key}`, '1');
}

function clearRetryFlag(key: string): void {
  try {
    sessionStorage.removeItem(`${RETRY_FLAG_PREFIX}${key}`);
  } catch {
    // Sin storage el reintento automático no persiste; el error queda visible.
  }
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Sin storage el reintento automático no persiste; el error queda visible.
  }
}

// Rutas secundarias en chunks propios: el chat (ruta principal) queda en el bundle inicial.
const SettingsPage = lazyWithRetry('settings', () =>
  import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const OnboardingPage = lazyWithRetry('onboarding', () =>
  import('@/features/onboarding/OnboardingPage').then((module) => ({ default: module.OnboardingPage })),
);
// Ruta legal en chunk propio: la gestión de expedientes no entra al bundle inicial.
const LegalPage = lazyWithRetry('legal', () =>
  import('@/features/legal/LegalPage').then((module) => ({ default: module.LegalPage })),
);
const LegalManualPage = lazyWithRetry('manual', () =>
  import('@/features/legal/LegalManualPage').then((module) => ({ default: module.LegalManualPage })),
);

/**
 * Precarga los chunks de rutas diferidas cuando la app ya está en pantalla:
 * la pestaña los deja en caché antes de que un deploy rote los hashes, así el
 * "no me abre Ajustes" no llega a ocurrir.
 */
export function preloadRoutes(): void {
  window.setTimeout(() => {
    void import('@/features/settings/SettingsPage').catch(() => undefined);
    void import('@/features/legal/LegalPage').catch(() => undefined);
    void import('@/features/legal/LegalManualPage').catch(() => undefined);
    void import('@/features/onboarding/OnboardingPage').catch(() => undefined);
  }, 1500);
}

export type Route =
  | { name: 'chat'; conversationId: string | null }
  | { name: 'settings' }
  // `conversationId: null` mantiene estable el acceso a `route.conversationId` del layout (TopBar).
  | { name: 'onboarding'; conversationId: null }
  // `login` es la entrada pública cuando hay auth sin sesión (la ve el AuthGate).
  | { name: 'login'; conversationId: null }
  // `manual` es la guía práctica y forense para el letrado.
  | { name: 'manual'; conversationId: null }
  // `caseId`/`conversationId` nulos = lista sin selección; el layout los lee igual que en el chat.
  | { name: 'legal'; caseId: string | null; conversationId: string | null };

const DEFAULT_ROUTE: Route = { name: 'chat', conversationId: null };

/** Hash → ruta. `#/chat/:id?`, `#/legal/:caseId?/:conversationId?`, `#/settings`, `#/manual` y `#/onboarding`; cualquier otro valor cae a `#/chat`. */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split('?');
  const path = (pathPart ?? '').replace(/^\/+/, '');
  const [head, segment, rest] = path.split('/');

  if (head === 'settings') return { name: 'settings' };
  if (head === 'onboarding') return { name: 'onboarding', conversationId: null };
  if (head === 'login') return { name: 'login', conversationId: null };
  if (head === 'manual' || head === 'guia') return { name: 'manual', conversationId: null };
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
export const MANUAL_HREF = '#/manual';

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
  const t = useT();

  if (route.name === 'onboarding') {
    return (
      <LazyRoute label={t('onboarding.title')}>
        <OnboardingPage />
      </LazyRoute>
    );
  }
  if (route.name === 'settings') {
    return (
      <LazyRoute label={t('app.settingsTitle')}>
        <SettingsPage />
      </LazyRoute>
    );
  }
  if (route.name === 'manual') {
    return (
      <LazyRoute label={t('legalManual.title')}>
        <LegalManualPage />
      </LazyRoute>
    );
  }
  if (route.name === 'legal') {
    return (
      <LazyRoute label={t('legalCases.title')}>
        <LegalPage />
      </LazyRoute>
    );
  }
  // `#/login` con sesión muestra el chat (sin sesión el AuthGate intercepta antes).
  return <ChatPage />;
}

/** Suspense de una ruta diferida, con borde de error propio: un chunk que no carga no deja la pantalla vacía. */
export function LazyRoute({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RouteErrorBoundary label={label}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

interface RouteErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  failed: boolean;
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return <RouteError label={this.props.label} />;
    return this.props.children;
  }
}

/** Error visible de una ruta que no pudo cargar: el shell (chat) sigue usable y hay reintento. */
function RouteError({ label }: { label: string }) {
  const t = useT();
  return (
    <div data-testid="route-error" className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <AlertBanner
        variant="danger"
        title={t('app.routeErrorTitle')}
        description={t('app.routeErrorDescription', { section: label })}
        action={
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    </div>
  );
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
