import { useEffect, useState } from 'react';

import { closeOwnerDb } from '@/adapters/storage/idb';
import { migrateLegacyStorageToOwner } from '@/adapters/storage/ownerMigration';
import type { AppSettings } from '@/domain/types/settings';
import {
  ConversationsStoreProvider,
  createConversationsStore,
  useConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { synchronizeWithCloud } from '@/features/settings/state/cloudSync';
import { createSettingsStore } from '@/features/settings/state/settingsStore';
import { isOnboardingResolvedThisSession, needsOnboarding } from '@/features/onboarding/session';
import { AuthGate, useAuthUser } from '@/features/auth/AuthGate';
import { UpdateNotice } from '@/features/updates/UpdateNotice';
import { useT } from '@/i18n/useT';
import { Logo } from '@/shared/brand/Logo';
import { Button, Spinner } from '@/shared/ui';

import { bootstrapApp } from './bootstrap';
import type { BootstrappedApp } from './bootstrap';
import { AlertBanner } from './layout/AlertBanner';
import { AppShell } from './layout/AppShell';
import { AppRoutes, navigate, ONBOARDING_HREF, preloadRoutes, SETTINGS_HREF, useRoute } from './routing';
import { ServicesProvider } from './services';
import type { AppServices } from './services';

type BootState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & BootstrappedApp);

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setBoot({ status: 'loading' });
    void bootstrapApp()
      .then((result) => {
        if (active) setBoot({ status: 'ready', ...result });
      })
      .catch((error: unknown) => {
        if (active) {
          setBoot({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (boot.status === 'loading') return <BootSplash />;
  if (boot.status === 'error') {
    return <BootFailure message={boot.message} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  return <BootedApp services={boot.services} settings={boot.settings} storageError={boot.storageError} />;
}

interface BootedAppProps {
  services: AppServices;
  settings: AppSettings;
  storageError: string | null;
}

/**
 * Fase 1 (sin usuario): sirve para landing/login + tema/idioma. Sin `auth`
 * monta el shell directo; con `auth` abre la puerta de sesión y la fase 2
 * (`ScopedApp`) arranca la partición del usuario.
 */
function BootedApp({ services, settings, storageError }: BootedAppProps) {
  if (services.auth === undefined) {
    return <AppShellContent services={services} settings={settings} storageError={storageError} />;
  }
  return (
    <ServicesProvider services={services}>
      <AuthGate auth={services.auth}>
        <ScopedApp />
      </AuthGate>
    </ServicesProvider>
  );
}

/**
 * Espera máxima del espejo en la nube durante el arranque: pasado este
 * tiempo se monta con lo local y el pull completa en fondo.
 */
const BOOT_SYNC_TIMEOUT_MS = 3000;

const BOOT_SYNC_TIMEOUT = Symbol('boot-sync-timeout');

/** `promise` o el centinela si tarda más de `ms` (el original sigue vivo). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof BOOT_SYNC_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof BOOT_SYNC_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(BOOT_SYNC_TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Fase 2 (con sesión): migra el storage legacy a la partición del usuario y
 * arranca servicios con su `userId`. Vive dentro del `AuthGate`, así que hay
 * sesión; al desmontar o cambiar de cuenta suelta la conexión del dueño
 * anterior y el `key` reinicia todos los stores sin estado fantasma.
 */
function ScopedApp() {
  const user = useAuthUser();
  const uid = user?.uid ?? null;
  const [scoped, setScoped] = useState<BootState>({ status: 'loading' });
  // Remonta el shell (stores + pantallas) sin recargar la página cuando el
  // pull tardío trae nube más nueva. Nunca re-ejecuta este efecto (no hay
  // loop) y conserva la ruta/hash.
  const [syncEpoch, setSyncEpoch] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (uid === null) return;
    let active = true;
    setScoped({ status: 'loading' });
    void (async () => {
      try {
        await migrateLegacyStorageToOwner(uid);
      } catch {
        // Migración best-effort: si falla se sigue igual con partición vacía/defaults.
      }
      if (!active) return;
      try {
        const result = await bootstrapApp(undefined, { userId: uid });
        if (!active) return;
        // Espejo en la nube (misma cuenta = mismos datos en todos los
        // dispositivos). Para no frenar el arranque con red lenta, se monta
        // con lo local tras una espera corta y el pull completa en fondo:
        // si la nube traía algo más nuevo, se recarga una vez para tomarlo
        // (raro y sin pérdida: todo lo local persiste).
        if (result.services.sync === undefined) {
          if (active) setScoped({ status: 'ready', ...result });
          return;
        }
        const syncStore = createSettingsStore(result.services);
        try {
          await syncStore.getState().load();
        } catch {
          // Local-first: se ignora y se sigue con lo del dispositivo.
        }
        if (!active) return;
        const syncTask = synchronizeWithCloud(syncStore, result.services.sync);
        const outcome = await withTimeout(syncTask, BOOT_SYNC_TIMEOUT_MS);
        if (!active) return;
        if (active) setScoped({ status: 'ready', ...result });
        // Sin suscriptores: el store transitorio se descarta sin más trámite.
        if (outcome === BOOT_SYNC_TIMEOUT) {
          void syncTask.then(
            (late) => {
              if (active && late === 'pulled') setSyncEpoch((epoch) => epoch + 1);
            },
            () => undefined,
          );
        }
      } catch (error: unknown) {
        if (active) {
          setScoped({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      active = false;
      closeOwnerDb(uid);
    };
  }, [uid, attempt]);

  // Inalcanzable dentro del `AuthGate` con sesión; calma al tipado estricto.
  if (uid === null) return null;
  if (scoped.status === 'loading') return <BootSplash />;
  if (scoped.status === 'error') {
    return <BootFailure message={scoped.message} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  return (
    <AppShellContent
      key={`${uid}:${syncEpoch}`}
      services={scoped.services}
      settings={scoped.settings}
      storageError={scoped.storageError}
    />
  );
}

interface AppShellContentProps {
  services: AppServices;
  settings: AppSettings;
  storageError: string | null;
}

/** Shell reutilizado por ambas fases (sin auth) y por cada sesión (con auth). */
function AppShellContent({ services, settings, storageError }: AppShellContentProps) {
  const [store] = useState(() => createConversationsStore(services.conversations));

  return (
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={store}>
        <RouteSync />
        {services.auth === undefined ? (
          <EnteredShell settings={settings} storageError={storageError} />
        ) : (
          <AuthGate auth={services.auth}>
            <EnteredShell settings={settings} storageError={storageError} />
          </AuthGate>
        )}
      </ConversationsStoreProvider>
    </ServicesProvider>
  );
}

interface EnteredShellProps {
  settings: AppSettings;
  storageError: string | null;
}

/**
 * Contenido real de la app: sólo se monta con sesión iniciada (o sin auth).
 * La redirección a `#/onboarding` vive acá a propósito: un visitante anónimo
 * nunca debe ser empujado a configuración antes del login (ve la portada).
 */
function EnteredShell({ settings, storageError }: EnteredShellProps) {
  const t = useT();
  const route = useRoute();
  const onboardingResolved = isOnboardingResolvedThisSession();
  const showNoProviderNotice =
    settings.activeProviderId === null && route.name !== 'onboarding' && !onboardingResolved;
  const hasNotices = storageError !== null || showNoProviderNotice;

  useEffect(() => {
    if (isOnboardingResolvedThisSession()) return;
    if (!needsOnboarding(settings)) return;
    navigate(ONBOARDING_HREF);
  }, [settings]);

  // Chunks de Ajustes/Expedientes listos en caché apenas la app quedó en pantalla.
  useEffect(() => {
    preloadRoutes();
  }, []);

  return (
    <AppShell>
      {hasNotices ? (
        <div className="flex flex-col gap-3 px-4 pt-4">
          {storageError !== null ? (
            <AlertBanner variant="danger" title={t('app.storageErrorTitle')} description={storageError} />
          ) : null}
          {showNoProviderNotice ? (
            <AlertBanner
              variant="warning"
              title={t('app.noProviderTitle')}
              description={t('app.noProviderDescription')}
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate(SETTINGS_HREF)}>
                  {t('app.noProviderAction')}
                </Button>
              }
            />
          ) : null}
        </div>
      ) : null}
      <UpdateNotice enabled={settings.ui.autoCheckUpdates} />
      <AppRoutes />
    </AppShell>
  );
}

/** Mantiene `activeId` alineado con `#/chat/:id` para resaltar la conversación abierta. */
function RouteSync() {
  const route = useRoute();
  const select = useConversationsStore((state) => state.select);

  useEffect(() => {
    if (route.name === 'chat') select(route.conversationId);
  }, [route, select]);

  return null;
}

function BootSplash() {
  const t = useT();

  return (
    <main className="grid min-h-dvh place-items-center bg-background text-text">
      <div className="flex flex-col items-center gap-4">
        <Logo size={40} />
        <h1 className="text-lg font-semibold tracking-tight">{t('app.title')}</h1>
        <Spinner label={t('common.loading')} />
      </div>
    </main>
  );
}

interface BootFailureProps {
  message: string;
  onRetry: () => void;
}

function BootFailure({ message, onRetry }: BootFailureProps) {
  const t = useT();

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-text">
      <div className="flex w-full max-w-md flex-col gap-4">
        <AlertBanner variant="danger" title={t('app.bootErrorTitle')} description={message} />
        <div className="flex justify-center">
          <Button onClick={onRetry}>{t('common.retry')}</Button>
        </div>
      </div>
    </main>
  );
}
