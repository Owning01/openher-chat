import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import type { ConversationsState, ConversationsStore } from './conversationsStore';

const ConversationsStoreContext = createContext<ConversationsStore | null>(null);

export interface ConversationsStoreProviderProps {
  store: ConversationsStore;
  children: ReactNode;
}

export function ConversationsStoreProvider({ store, children }: ConversationsStoreProviderProps) {
  return <ConversationsStoreContext.Provider value={store}>{children}</ConversationsStoreContext.Provider>;
}

export function useConversationsStore<T>(selector: (state: ConversationsState) => T): T {
  const store = useContext(ConversationsStoreContext);
  if (store === null) {
    throw new Error('useConversationsStore must be used within a ConversationsStoreProvider');
  }
  return useStore(store, selector);
}

/** Acceso al store completo (API) para wiring imperativo entre stores. */
export function useConversationsStoreApi(): ConversationsStore {
  const store = useContext(ConversationsStoreContext);
  if (store === null) {
    throw new Error('useConversationsStoreApi must be used within a ConversationsStoreProvider');
  }
  return store;
}
