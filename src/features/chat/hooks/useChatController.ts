import { useStore } from 'zustand';

import { useServices } from '@/app/services';
import type { AppServices } from '@/app/services';
import type { AgentStep } from '@/domain/types/agent';
import type { ChatMessage, MessageError } from '@/domain/types/chat';

import type { ChatRunStatus, ChatStore } from '../state/chatStore';
import { createChatStore } from '../state/chatStore';
import { useChatStoreContext } from '../state/ChatStoreContext';

export interface ChatController {
  messages: ChatMessage[];
  runStatus: ChatRunStatus;
  liveSteps: AgentStep[];
  lastError: MessageError | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  regenerate: (assistantMessageId: string) => Promise<void>;
  editUserMessage: (userMessageId: string, text: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  retryLast: () => Promise<void>;
}

/** Store de respaldo por `AppServices` cuando la UI no monta un `ChatStoreProvider`. */
const fallbackStores = new WeakMap<AppServices, ChatStore>();

function getFallbackStore(services: AppServices): ChatStore {
  let store = fallbackStores.get(services);
  if (store === undefined) {
    store = createChatStore({ services, conversations: services.conversations });
    fallbackStores.set(services, store);
  }
  return store;
}

/**
 * Wiring puro del `chatStore` para la UI de chat: usa el store del contexto si
 * existe o un store compartido creado con `useServices()`. Solo selectores y
 * passthrough de las acciones congeladas.
 */
export function useChatController(): ChatController {
  const services = useServices();
  const provided = useChatStoreContext();
  const store = provided ?? getFallbackStore(services);

  const messages = useStore(store, (state) => state.messages);
  const runStatus = useStore(store, (state) => state.runStatus);
  const liveSteps = useStore(store, (state) => state.liveSteps);
  const lastError = useStore(store, (state) => state.lastError);
  const send = useStore(store, (state) => state.send);
  const stop = useStore(store, (state) => state.stop);
  const regenerate = useStore(store, (state) => state.regenerate);
  const editUserMessage = useStore(store, (state) => state.editUserMessage);
  const deleteMessage = useStore(store, (state) => state.deleteMessage);
  const retryLast = useStore(store, (state) => state.retryLast);

  return { messages, runStatus, liveSteps, lastError, send, stop, regenerate, editUserMessage, deleteMessage, retryLast };
}
