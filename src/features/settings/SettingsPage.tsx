import { Palette } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AlertBanner } from '@/app/layout/AlertBanner';
import { useServices } from '@/app/services';
import { useT } from '@/i18n/useT';
import { Brain, MessageSquare, RefreshCw, Search } from '@/shared/icons';
import { Button, Skeleton } from '@/shared/ui';
import { UpdatesSection } from '@/features/updates/components/UpdatesSection';

import { AgentBudgetSection } from './components/AgentBudgetSection';
import { AppearanceSection } from './components/AppearanceSection';
import { ChatSection } from './components/ChatSection';
import { ProviderList } from './components/ProviderList';
import { ProxySection } from './components/ProxySection';
import { SearchSection } from './components/SearchSection';
import { SectionCard } from './components/SectionCard';
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
      <p className="text-sm text-muted">
        {t('settings.description')} {t('settings.autoSaveHint')}
      </p>

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

      <ProviderList />

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
        title={t('settings.sectionAppearance')}
        description={t('settings.sectionAppearanceDescription')}
        icon={<Palette aria-hidden="true" className="size-4" />}
      >
        <AppearanceSection />
      </SectionCard>

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
