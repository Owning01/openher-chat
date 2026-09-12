import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import type { SettingsState, SettingsStore } from './settingsStore';

const SettingsStoreContext = createContext<SettingsStore | null>(null);

export interface SettingsStoreProviderProps {
  store: SettingsStore;
  children: ReactNode;
}

export function SettingsStoreProvider({ store, children }: SettingsStoreProviderProps) {
  return <SettingsStoreContext.Provider value={store}>{children}</SettingsStoreContext.Provider>;
}

export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  const store = useContext(SettingsStoreContext);
  if (store === null) {
    throw new Error('useSettingsStore must be used within a SettingsStoreProvider');
  }
  return useStore(store, selector);
}
