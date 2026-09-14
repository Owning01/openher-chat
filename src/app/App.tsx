import { useEffect, useState } from 'react';

import type { AppSettings } from '@/domain/types/settings';
import {
  ConversationsStoreProvider,
  createConversationsStore,
  useConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { isOnboardingResolvedThisSession, needsOnboarding } from '@/features/onboarding/session';
import { UpdateNotice } from '@/features/updates/UpdateNotice';
import { useT } from '@/i18n/useT';
import { Sparkles } from '@/shared/icons';
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

function BootedApp({ services, settings, storageError }: BootedAppProps) {
  const t = useT();
  const route = useRoute();
  const [store] = useState(() => createConversationsStore(services.conversations));
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
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={store}>
        <RouteSync />
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
      </ConversationsStoreProvider>
    </ServicesProvider>
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
        <Sparkles aria-hidden="true" className="size-8 text-primary" />
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
