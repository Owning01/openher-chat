import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import type { CaseState, CaseStore } from './caseStore';

const CaseStoreContext = createContext<CaseStore | null>(null);

export interface CaseStoreProviderProps {
  store: CaseStore;
  children: ReactNode;
}

export function CaseStoreProvider({ store, children }: CaseStoreProviderProps) {
  return <CaseStoreContext.Provider value={store}>{children}</CaseStoreContext.Provider>;
}

export function useCaseStore<T>(selector: (state: CaseState) => T): T {
  const store = useContext(CaseStoreContext);
  if (store === null) {
    throw new Error('useCaseStore must be used within a CaseStoreProvider');
  }
  return useStore(store, selector);
}

/** Acceso al store completo (API) para wiring imperativo entre stores. */
export function useCaseStoreApi(): CaseStore {
  const store = useContext(CaseStoreContext);
  if (store === null) {
    throw new Error('useCaseStoreApi must be used within a CaseStoreProvider');
  }
  return store;
}
