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
import { AppRoutes, navigate, ONBOARDING_HREF, SETTINGS_HREF, useRoute } from './routing';
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
 * Fase 2 (con sesión): migra el storage legacy a la partición del usuario y
 * arranca servicios con su `userId`. Vive dentro del `AuthGate`, así que hay
 * sesión; al desmontar o cambiar de cuenta suelta la conexión del dueño
 * anterior y el `key` reinicia todos los stores sin estado fantasma.
 */
function ScopedApp() {
  const user = useAuthUser();
  const uid = user?.uid ?? null;
  const [scoped, setScoped] = useState<BootState>({ status: 'loading' });
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
        // Espejo en la nube (misma cuenta = mismos datos en todos los
        // dispositivos): si la nube trae algo más nuevo, se aplica antes de
        // montar el chat para que aparezca listo. Best-effort y silencioso:
        // sin red o sin nube se sigue con lo local; Ajustes reintenta al abrirse.
        if (result.services.sync !== undefined) {
          const syncStore = createSettingsStore(result.services);
          try {
            await syncStore.getState().load();
            await synchronizeWithCloud(syncStore, result.services.sync);
          } catch {
            // Local-first: se ignora y se sigue con lo del dispositivo.
          }
          // Sin suscriptores: el store transitorio se descarta sin más trámite.
        }
        if (active) setScoped({ status: 'ready', ...result });
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
      key={uid}
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
