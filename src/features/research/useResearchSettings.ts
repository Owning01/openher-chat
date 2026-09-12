import { useEffect, useState } from 'react';

import type { AppServices } from '@/app/services';
import { isBrowserEnvironment } from '@/adapters/tools/platform';
import type { AppSettings } from '@/domain/types/settings';
import { SEARCH_KEY_REFS } from '@/features/settings/state/settingsStore';

import type { SearchKeyPresence } from './selectors';

export interface ResearchSettingsSnapshot {
  settings: AppSettings | null;
  keyPresence: SearchKeyPresence;
  browser: boolean;
}

const INITIAL_SNAPSHOT: ResearchSettingsSnapshot = {
  settings: null,
  keyPresence: { brave: false, tavily: false },
  browser: false,
};

/** Carga settings y presencia de keys de búsqueda para gobernar el modo investigación. */
export function useResearchSettings(services: AppServices): ResearchSettingsSnapshot {
  const [snapshot, setSnapshot] = useState<ResearchSettingsSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    let active = true;
    void Promise.all([
      services.settings.load(),
      services.keys.has(SEARCH_KEY_REFS.brave),
      services.keys.has(SEARCH_KEY_REFS.tavily),
    ])
      .then(([settings, brave, tavily]) => {
        if (!active) return;
        setSnapshot({ settings, keyPresence: { brave, tavily }, browser: isBrowserEnvironment() });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services]);

  return snapshot;
}
