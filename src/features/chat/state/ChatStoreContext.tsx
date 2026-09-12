import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import type { ChatState, ChatStore } from './chatStore';

const ChatStoreContext = createContext<ChatStore | null>(null);

export interface ChatStoreProviderProps {
  store: ChatStore;
  children: ReactNode;
}

export function ChatStoreProvider({ store, children }: ChatStoreProviderProps) {
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore<T>(selector: (state: ChatState) => T): T {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStore must be used within a ChatStoreProvider');
  }
  return useStore(store, selector);
}

/** Variante sin throw para consumidores que admiten un store de respaldo por `AppServices`. */
export function useChatStoreContext(): ChatStore | null {
  return useContext(ChatStoreContext);
}
