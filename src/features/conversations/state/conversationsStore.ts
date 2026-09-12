import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { Conversation } from '@/domain/types/conversation';

export interface NewConversationInput {
  title?: string;
  providerId?: string | null;
  modelId?: string | null;
}

export type ConversationsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ConversationsState {
  items: Conversation[];
  activeId: string | null;
  query: string;
  status: ConversationsStatus;
  error: string | null;
  load: () => Promise<void>;
  create: (input?: NewConversationInput) => Promise<Conversation | null>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  select: (id: string | null) => void;
  setQuery: (query: string) => void;
  visible: () => Conversation[];
  dismissError: () => void;
  /** Refleja un cambio puntual de conversación (preview, contador, título) sin recargar la lista. */
  merge: (conversation: Conversation) => void;
}

export type ConversationsStore = UseBoundStore<StoreApi<ConversationsState>>;

/** Orden canónico de la lista: `updatedAt` desc con desempate estable por `createdAt` e `id`. */
export function sortConversationsByUpdatedAt(items: readonly Conversation[]): Conversation[] {
  return [...items].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt ||
      left.id.localeCompare(right.id),
  );
}

/** Filtro local por título, insensible a mayúsculas y espacios sobrantes. */
export function filterConversations(items: readonly Conversation[], query: string): Conversation[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return [...items];
  return items.filter((conversation) => conversation.title.toLocaleLowerCase().includes(needle));
}

export function createConversationsStore(repo: ConversationRepository): ConversationsStore {
  // Token de versión: un snapshot obsoleto de `list()` no debe pisar mutaciones locales.
  let loadSeq = 0;

  return create<ConversationsState>((set, get) => ({
    items: [],
    activeId: null,
    query: '',
    status: 'idle',
    error: null,

    async load() {
      const version = ++loadSeq;
      set({ status: 'loading', error: null });
      try {
        const items = await repo.list();
        if (version !== loadSeq) return;
        set({ items: sortConversationsByUpdatedAt(items), status: 'ready' });
      } catch (error) {
        if (version !== loadSeq) return;
        set({ status: 'error', error: toErrorMessage(error) });
      }
    },

    async create(input = {}) {
      set({ error: null });
      try {
        const conversation = await repo.create(input);
        loadSeq += 1;
        set((state) => ({
          items: sortConversationsByUpdatedAt([conversation, ...state.items]),
          activeId: conversation.id,
          query: '',
          status: state.status === 'loading' ? 'ready' : state.status,
        }));
        return conversation;
      } catch (error) {
        set({ error: toErrorMessage(error) });
        return null;
      }
    },

    async rename(id, title) {
      const previous = get().items;
      loadSeq += 1;
      set((state) => ({
        error: null,
        status: state.status === 'loading' ? 'ready' : state.status,
        items: sortConversationsByUpdatedAt(
          state.items.map((conversation) =>
            conversation.id === id ? { ...conversation, title, updatedAt: Date.now() } : conversation,
          ),
        ),
      }));
      try {
        const updated = await repo.update(id, { title });
        set((state) => ({
          items: sortConversationsByUpdatedAt(
            state.items.map((conversation) => (conversation.id === id ? updated : conversation)),
          ),
        }));
      } catch (error) {
        set({ items: previous, error: toErrorMessage(error) });
      }
    },

    async remove(id) {
      const previousItems = get().items;
      const previousActiveId = get().activeId;
      loadSeq += 1;
      set((state) => ({
        error: null,
        status: state.status === 'loading' ? 'ready' : state.status,
        items: state.items.filter((conversation) => conversation.id !== id),
        activeId: state.activeId === id ? null : state.activeId,
      }));
      try {
        await repo.remove(id);
        return true;
      } catch (error) {
        set({ items: previousItems, activeId: previousActiveId, error: toErrorMessage(error) });
        return false;
      }
    },

    select: (id) => set({ activeId: id }),
    setQuery: (query) => set({ query }),
    visible: () => filterConversations(get().items, get().query),
    dismissError: () => set({ error: null }),

    merge(conversation) {
      loadSeq += 1;
      set((state) => {
        const exists = state.items.some((item) => item.id === conversation.id);
        const items = exists
          ? state.items.map((item) => (item.id === conversation.id ? conversation : item))
          : [conversation, ...state.items];
        return {
          items: sortConversationsByUpdatedAt(items),
          status: state.status === 'loading' ? 'ready' : state.status,
        };
      });
    },
  }));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { ConversationsStoreProvider, useConversationsStore, useConversationsStoreApi } from './ConversationsStoreContext';
export type { ConversationsStoreProviderProps } from './ConversationsStoreContext';
