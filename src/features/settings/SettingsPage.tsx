import { Palette, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AlertBanner } from '@/app/layout/AlertBanner';
import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import { Brain, ChevronRight, MessageSquare, RefreshCw, Scale, Search, Send } from '@/shared/icons';
import { Button, Skeleton } from '@/shared/ui';
import { UpdatesSection } from '@/features/updates/components/UpdatesSection';

import { AgentBudgetSection } from './components/AgentBudgetSection';
import { AppearanceSection } from './components/AppearanceSection';
import { ChatSection } from './components/ChatSection';
import { ProviderList } from './components/ProviderList';
import { ProxySection } from './components/ProxySection';
import { SearchSection } from './components/SearchSection';
import { SectionCard } from './components/SectionCard';
import { ShareSection } from './components/ShareSection';
import { WorkModeSection } from './components/WorkModeSection';
import { SettingsStoreProvider, createSettingsStore, useSettingsStore } from './state/settingsStore';

export function SettingsPage() {
  const services = useServices();
  const [store] = useState(() => createSettingsStore(services));

  return (
    <SettingsStoreProvider store={store}>
      <SettingsContent />
    </SettingsStoreProvider>
  );
}

function SettingsContent() {
  const t = useT();
  const ready = useSettingsStore((state) => state.ready);
  const status = useSettingsStore((state) => state.status);
  const error = useSettingsStore((state) => state.error);
  const load = useSettingsStore((state) => state.load);
  const dismissError = useSettingsStore((state) => state.dismissError);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    if (status === 'error') {
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6" data-testid="settings-page">
          <AlertBanner
            variant="danger"
            title={t('settings.errorTitle')}
            description={error ?? ''}
            action={
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6" data-testid="settings-page">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6" data-testid="settings-page">
      <header>
        <h1 className="text-2xl font-semibold text-text">{t('settings.title')}</h1>
        <p className="mt-1 text-base text-muted">{t('settings.plainHint')}</p>
      </header>

      {error !== null ? (
        <AlertBanner
          variant="danger"
          title={t('settings.errorTitle')}
          description={error}
          action={
            <Button size="sm" variant="ghost" onClick={dismissError}>
              {t('common.dismiss')}
            </Button>
          }
        />
      ) : null}

      <h2 className="text-lg font-semibold text-text">{t('settings.basicTitle')}</h2>

      <ProviderList />

      <SectionCard
        title={t('settings.sectionAppearance')}
        description={t('settings.sectionAppearanceDescription')}
        icon={<Palette aria-hidden="true" className="size-4" />}
      >
        <AppearanceSection />
      </SectionCard>

      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden">
          <span className="mt-0.5 text-muted">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-text">{t('settings.advancedTitle')}</span>
            <span className="mt-0.5 block text-sm text-muted">{t('settings.advancedHint')}</span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90"
          />
        </summary>

        <div className="flex flex-col gap-5 border-t border-border-subtle p-4">
          <SectionCard
            title={t('settings.sectionShare')}
            description={t('settings.sectionShareDescription')}
            icon={<Send aria-hidden="true" className="size-4" />}
          >
            <ShareSection />
          </SectionCard>

          <SectionCard
            title={t('settings.sectionChat')}
            description={t('settings.sectionChatDescription')}
            icon={<MessageSquare aria-hidden="true" className="size-4" />}
          >
            <ChatSection />
          </SectionCard>

          <SectionCard
            title={t('settings.sectionAgent')}
            description={t('settings.sectionAgentDescription')}
            icon={<Brain aria-hidden="true" className="size-4" />}
          >
            <AgentBudgetSection />
          </SectionCard>

          <SectionCard
            title={t('settings.sectionSearch')}
            description={t('settings.sectionSearchDescription')}
            icon={<Search aria-hidden="true" className="size-4" />}
          >
            <SearchSection />
            <ProxySection />
          </SectionCard>

          <SectionCard
            title={t('settings.sectionWorkMode')}
            description={t('settings.sectionWorkModeDescription')}
            icon={<Scale aria-hidden="true" className="size-4" />}
          >
            <WorkModeSection />
          </SectionCard>
        </div>
      </details>

      <SectionCard
        title={t('updates.title')}
        description={t('updates.description')}
        icon={<RefreshCw aria-hidden="true" className="size-4" />}
      >
        <UpdatesSection />
      </SectionCard>
    </div>
  );
}
