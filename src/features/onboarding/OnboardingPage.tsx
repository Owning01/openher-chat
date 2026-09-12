import { useEffect, useState } from 'react';

import { useServices } from '@/app/services';
import {
  SettingsStoreProvider,
  createSettingsStore,
  useSettingsStore,
} from '@/features/settings/state/settingsStore';
import type { SettingsStore } from '@/features/settings/state/settingsStore';
import { Skeleton } from '@/shared/ui';

import { OnboardingWizard } from './components/OnboardingWizard';

/** Página de onboarding: mismo contrato de store que ajustes, montada por el routing. */
export function OnboardingPage() {
  const services = useServices();
  const [store] = useState(() => createSettingsStore(services));

  return (
    <SettingsStoreProvider store={store}>
      <OnboardingContent store={store} />
    </SettingsStoreProvider>
  );
}

interface OnboardingContentProps {
  store: SettingsStore;
}

function OnboardingContent({ store }: OnboardingContentProps) {
  const ready = useSettingsStore((state) => state.ready);
  const load = useSettingsStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6" data-testid="onboarding-page">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return <OnboardingWizard store={store} />;
}
