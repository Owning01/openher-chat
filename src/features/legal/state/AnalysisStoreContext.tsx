import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import type { AnalysisState, AnalysisStore } from './analysisStore';

const AnalysisStoreContext = createContext<AnalysisStore | null>(null);

export interface AnalysisStoreProviderProps {
  store: AnalysisStore;
  children: ReactNode;
}

export function AnalysisStoreProvider({ store, children }: AnalysisStoreProviderProps) {
  return <AnalysisStoreContext.Provider value={store}>{children}</AnalysisStoreContext.Provider>;
}

export function useAnalysisStore<T>(selector: (state: AnalysisState) => T): T {
  const store = useContext(AnalysisStoreContext);
  if (store === null) {
    throw new Error('useAnalysisStore must be used within an AnalysisStoreProvider');
  }
  return useStore(store, selector);
}

/** Acceso al store completo (API) para wiring imperativo entre stores. */
export function useAnalysisStoreApi(): AnalysisStore {
  const store = useContext(AnalysisStoreContext);
  if (store === null) {
    throw new Error('useAnalysisStoreApi must be used within a AnalysisStoreProvider');
  }
  return store;
}
