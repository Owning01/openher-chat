import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import type { MessageSearchHit } from '@/domain/chat/messageSearch';
import { conversationToJson, conversationToMarkdown, parseConversationArchive } from '@/domain/chat/serializeConversation';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { Conversation } from '@/domain/types/conversation';
import { newId as defaultNewId } from '@/shared/utils/ids';
import type { LegalCircuitRole } from '@/domain/types/legal';

export interface NewConversationInput {
  title?: string;
  providerId?: string | null;
  modelId?: string | null;
  /** Vínculo inicial caso↔conversación; ausente/`null` = general. */
  legalCaseId?: string | null;
  /** Rol inicial del circuito; ausente/`null` = sin rol. */
  legalRole?: LegalCircuitRole | null;
}

export type ConversationsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ConversationsState {
  items: Conversation[];
  activeId: string | null;
  query: string;
  /** Coincidencias full-text en el contenido de los mensajes de la query actual. */
  messageHits: MessageSearchHit[];
  status: ConversationsStatus;
  error: string | null;
  load: () => Promise<void>;
  create: (input?: NewConversationInput) => Promise<Conversation | null>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  select: (id: string | null) => void;
  setQuery: (query: string) => void;
  /** Busca en el contenido de los mensajes (mínimo 2 caracteres); vacío limpia. */
  searchMessages: (query: string) => Promise<void>;
  visible: () => Conversation[];
  dismissError: () => void;
  /** Refleja un cambio puntual de conversación (preview, contador, título) sin recargar la lista. */
  merge: (conversation: Conversation) => void;
  /** Exporta a Markdown legible (o `null` si la conversación no existe). */
  exportMarkdown: (id: string) => Promise<string | null>;
  /** Exporta a JSON portable round-trip (o `null` si no existe). */
  exportJson: (id: string) => Promise<string | null>;
  /** Importa un JSON portable creando una conversación nueva. Devuelve `null` si es inválido. */
  importConversation: (text: string) => Promise<Conversation | null>;
}

export interface ConversationsStoreDeps {
  newId?: () => string;
  now?: () => number;
}

/** Marca interna de error de importación para que la UI muestre un mensaje traducido. */
export const INVALID_IMPORT_ERROR = 'invalid-import';

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

export function createConversationsStore(
  repo: ConversationRepository,
  deps: ConversationsStoreDeps = {},
): ConversationsStore {
  const newId = deps.newId ?? (() => defaultNewId());
  const now = deps.now ?? (() => Date.now());
  // Token de versión: un snapshot obsoleto de `list()` no debe pisar mutaciones locales.
  let loadSeq = 0;

  return create<ConversationsState>((set, get) => ({
    items: [],
    activeId: null,
    query: '',
    messageHits: [],
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
        // `create()` nunca puebla vínculo ni rol (contrato T14): se linkean con `update`.
        const { legalCaseId, legalRole, ...createInput } = input;
        const created = await repo.create(createInput);
        const withLinks =
          legalRole != null
            ? await repo.update(created.id, {
                ...(legalCaseId != null && legalCaseId !== '' ? { legalCaseId } : {}),
                legalRole,
              })
            : legalCaseId != null && legalCaseId !== ''
              ? await repo.update(created.id, { legalCaseId })
              : created;
        loadSeq += 1;
        set((state) => ({
          items: sortConversationsByUpdatedAt([withLinks, ...state.items]),
          activeId: withLinks.id,
          query: '',
          status: state.status === 'loading' ? 'ready' : state.status,
        }));
        return withLinks;
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

    async searchMessages(query) {
      const needle = query.trim();
      if (needle.length < 2) {
        set({ messageHits: [] });
        return;
      }
      try {
        const messageHits = await repo.searchMessages(needle, 20);
        set({ messageHits });
      } catch {
        set({ messageHits: [] });
      }
    },
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

    async exportMarkdown(id) {
      const conversation = await repo.get(id);
      if (conversation === null) return null;
      const messages = await repo.listMessages(id);
      return conversationToMarkdown(conversation, messages);
    },

    async exportJson(id) {
      const conversation = await repo.get(id);
      if (conversation === null) return null;
      const messages = await repo.listMessages(id);
      return conversationToJson(conversation, messages, now());
    },

    async importConversation(text) {
      set({ error: null });
      const archive = parseConversationArchive(text);
      if (archive === null) {
        set({ error: INVALID_IMPORT_ERROR });
        return null;
      }
      try {
        const created = await repo.create({
          title: archive.conversation.title,
          providerId: archive.conversation.providerId,
          modelId: archive.conversation.modelId,
        });
        for (let index = 0; index < archive.messages.length; index += 1) {
          const source = archive.messages[index];
          if (source === undefined) continue;
          const timestamp = now() + index;
          await repo.appendMessage({
            ...source,
            id: newId(),
            conversationId: created.id,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        const updated = await repo.update(created.id, {
          researchMode: archive.conversation.researchMode,
          systemPromptOverride: archive.conversation.systemPromptOverride,
          messageCount: archive.messages.length,
          ...(archive.conversation.legalCaseId != null ? { legalCaseId: archive.conversation.legalCaseId } : {}),
          ...(archive.conversation.legalRole != null ? { legalRole: archive.conversation.legalRole } : {}),
        });
        loadSeq += 1;
        set((state) => ({
          items: sortConversationsByUpdatedAt([updated, ...state.items]),
          activeId: updated.id,
          query: '',
          status: state.status === 'loading' ? 'ready' : state.status,
        }));
        return updated;
      } catch (error) {
        set({ error: toErrorMessage(error) });
        return null;
      }
    },
  }));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { ConversationsStoreProvider, useConversationsStore, useConversationsStoreApi } from './ConversationsStoreContext';
export type { ConversationsStoreProviderProps } from './ConversationsStoreContext';
