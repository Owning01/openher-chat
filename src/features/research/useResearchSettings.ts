import { useCallback, useEffect, useRef, useState } from 'react';

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

export interface ResearchSettingsResult extends ResearchSettingsSnapshot {
  /** Muestra u oculta el panel de investigación (persistido en `settings.ui`). */
  setResearchPanelVisible(visible: boolean): void;
}

const INITIAL_SNAPSHOT: ResearchSettingsSnapshot = {
  settings: null,
  keyPresence: { brave: false, tavily: false },
  browser: false,
};

/** Carga settings y presencia de keys de búsqueda para gobernar el modo investigación. */
export function useResearchSettings(services: AppServices): ResearchSettingsResult {
  const [snapshot, setSnapshot] = useState<ResearchSettingsSnapshot>(INITIAL_SNAPSHOT);
  // Última versión de settings: evita guardar sobre un snapshot ya reemplazado.
  const latest = useRef<AppSettings | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      services.settings.load(),
      services.keys.has(SEARCH_KEY_REFS.brave),
      services.keys.has(SEARCH_KEY_REFS.tavily),
    ])
      .then(([settings, brave, tavily]) => {
        if (!active) return;
        latest.current = settings;
        setSnapshot({ settings, keyPresence: { brave, tavily }, browser: isBrowserEnvironment() });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services]);

  const setResearchPanelVisible = useCallback(
    (visible: boolean) => {
      const persist = async (): Promise<void> => {
        // Si se interactúa antes de que carguen los settings, se cargan al vuelo.
        const current = latest.current ?? (await services.settings.load());
        const next: AppSettings = {
          ...current,
          ui: { ...current.ui, researchPanelVisible: visible },
          updatedAt: Date.now(),
        };
        latest.current = next;
        setSnapshot((previous) => ({ ...previous, settings: next }));
        await services.settings.save(next);
      };
      void persist().catch(() => undefined);
    },
    [services],
  );

  return { ...snapshot, setResearchPanelVisible };
}
