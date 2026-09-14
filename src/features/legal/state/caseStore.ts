import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { CreateLegalCaseInput, LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type { LegalCase } from '@/domain/types/legal';

/** Estado de persistencia del store de expedientes (el éxito siempre vuelve a `idle`). */
export type CaseStoreStatus = 'idle' | 'loading' | 'saving' | 'error';

export interface CaseStoreDeps {
  cases: LegalCaseRepository;
  /** Repo de conversaciones para el vínculo; ausente = el link sólo selecciona el caso. */
  conversations?: ConversationRepository;
  /** Se aceptan por compatibilidad de inyección; los ids/timestamps los genera el repositorio. */
  newId?: () => string;
  now?: () => number;
}

export interface CaseState {
  cases: LegalCase[];
  selectedId: string | null;
  status: CaseStoreStatus;
  error: string | null;
  list: () => Promise<void>;
  load: (id: string) => Promise<LegalCase | null>;
  create: (input: CreateLegalCaseInput) => Promise<LegalCase | null>;
  update: (id: string, patch: Partial<Omit<LegalCase, 'id' | 'createdAt'>>) => Promise<LegalCase | null>;
  remove: (id: string) => Promise<boolean>;
  /**
   * Vincula el caso con la conversación vía `update({ legalCaseId })` (contrato T14/A1).
   * Con `conversationId: null` desvincula todas las conversaciones atadas al caso.
   * Nunca lanza: el fallo queda en `error` con `status: 'error'`.
   */
  linkConversation: (caseId: string, conversationId: string | null) => Promise<void>;
  select: (id: string | null) => void;
  /** Expediente seleccionado, o `null` si no hay selección o ya no existe. */
  selected: () => LegalCase | null;
  dismissError: () => void;
}

export type CaseStore = UseBoundStore<StoreApi<CaseState>>;

/** Orden canónico de la lista: `(createdAt, id)` ascendente, como el repositorio. */
export function sortCasesByCreatedAt(items: readonly LegalCase[]): LegalCase[] {
  return [...items].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

/**
 * Store del expediente: CRUD sobre `LegalCaseRepository` con deps inyectadas.
 * Los errores de persistencia se exponen en `error` sin lanzar ni tumbar la UI.
 */
export function createCaseStore(deps: CaseStoreDeps): CaseStore {
  const repo = deps.cases;
  const conversations = deps.conversations;
  // Token de versión: un `list()`/`load()` obsoleto no pisa mutaciones locales posteriores.
  let loadSeq = 0;

  return create<CaseState>((set, get) => ({
    cases: [],
    selectedId: null,
    status: 'idle',
    error: null,

    async list() {
      const version = ++loadSeq;
      set({ status: 'loading', error: null });
      try {
        const items = await repo.list();
        if (version !== loadSeq) return;
        set({ cases: sortCasesByCreatedAt(items), status: 'idle' });
      } catch (error) {
        if (version !== loadSeq) return;
        set({ status: 'error', error: toErrorMessage(error) });
      }
    },

    async load(id) {
      const version = ++loadSeq;
      set({ status: 'loading', error: null });
      try {
        const found = await repo.get(id);
        if (version !== loadSeq) return found;
        if (found === null) {
          set({ status: 'error', error: `Expediente no encontrado: ${id}` });
          return null;
        }
        set((state) => ({
          cases: sortCasesByCreatedAt([...state.cases.filter((item) => item.id !== id), found]),
          selectedId: id,
          status: 'idle',
        }));
        return found;
      } catch (error) {
        if (version !== loadSeq) return null;
        set({ status: 'error', error: toErrorMessage(error) });
        return null;
      }
    },

    async create(input) {
      loadSeq += 1;
      set({ status: 'saving', error: null });
      try {
        const created = await repo.create(input);
        set((state) => ({
          cases: sortCasesByCreatedAt([...state.cases, created]),
          selectedId: created.id,
          status: 'idle',
        }));
        return created;
      } catch (error) {
        set({ status: 'error', error: toErrorMessage(error) });
        return null;
      }
    },

    async update(id, patch) {
      loadSeq += 1;
      set({ status: 'saving', error: null });
      try {
        const updated = await repo.update(id, patch);
        set((state) => ({
          cases: sortCasesByCreatedAt(
            state.cases.some((item) => item.id === id)
              ? state.cases.map((item) => (item.id === id ? updated : item))
              : [...state.cases, updated],
          ),
          status: 'idle',
        }));
        return updated;
      } catch (error) {
        set({ status: 'error', error: toErrorMessage(error) });
        return null;
      }
    },

    async remove(id) {
      const previous = get().cases;
      const previousSelected = get().selectedId;
      loadSeq += 1;
      set((state) => ({
        status: 'saving',
        error: null,
        cases: state.cases.filter((item) => item.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      }));
      try {
        await repo.remove(id);
      } catch (error) {
        set({ cases: previous, selectedId: previousSelected, status: 'error', error: toErrorMessage(error) });
        return false;
      }
      // El caso ya se borró: desvincula las conversaciones atadas (best-effort).
      // Sin repo de conversaciones no hay nada que desvincular; si el listado o
      // algún update falla, el vínculo huérfano se ignora (el turno legal ya
      // degrada a general cuando el caso no existe) sin ensuciar el `remove`.
      if (conversations !== undefined) {
        try {
          const items = await conversations.list();
          for (const conversation of items) {
            if (conversation.legalCaseId === id) {
              await conversations.update(conversation.id, { legalCaseId: null });
            }
          }
        } catch {
          // Best-effort documentado: la baja ya quedó persistida.
        }
      }
      set({ status: 'idle' });
      return true;
    },

    async linkConversation(caseId, conversationId) {
      loadSeq += 1;
      set({ status: 'saving', error: null });
      try {
        if (conversations !== undefined) {
          if (conversationId !== null) {
            await conversations.update(conversationId, { legalCaseId: caseId });
          } else {
            const items = await conversations.list();
            for (const conversation of items) {
              if (conversation.legalCaseId === caseId) {
                await conversations.update(conversation.id, { legalCaseId: null });
              }
            }
          }
        }
        if (conversationId !== null) set({ selectedId: caseId, status: 'idle' });
        else set({ status: 'idle' });
      } catch (error) {
        set({ status: 'error', error: toErrorMessage(error) });
      }
    },

    select: (id) => set({ selectedId: id }),

    selected() {
      const selectedId = get().selectedId;
      if (selectedId === null) return null;
      return get().cases.find((item) => item.id === selectedId) ?? null;
    },

    dismissError() {
      set((state) => ({ error: null, status: state.status === 'error' ? 'idle' : state.status }));
    },
  }));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Contexto/hook de React del store de expedientes (patrón del store de chat). */
export { CaseStoreProvider, useCaseStore, useCaseStoreApi } from './CaseStoreContext';
export type { CaseStoreProviderProps } from './CaseStoreContext';
