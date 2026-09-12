import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import { createToolRegistry } from '@/adapters/tools';
import type { AppServices } from '@/app/services';
import { runAgent } from '@/domain/agent/runAgent';
import type { RunAgentParams } from '@/domain/agent/runAgent';
import { buildSystemPrompt } from '@/domain/agent/systemPrompt';
import { createAssistantMessage, createUserMessage, finalizeMessage } from '@/domain/chat/messageFactory';
import { resolveCapabilities } from '@/domain/providers/capabilities';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { AgentEvent, AgentRunStatus, AgentStep } from '@/domain/types/agent';
import type { ChatMessage, MessageContent, MessageError, MessageErrorCode } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import type { ModelInfo, ProviderConfig } from '@/domain/types/provider';
import type { AppSettings } from '@/domain/types/settings';
import type { ToolRegistry } from '@/domain/types/tools';
import { applyAgentEvent, closeRunningSteps } from '@/features/research/selectors';
import { LocalProviderConfigRepository } from '@/features/settings/state/providerStorage';
import { newId as defaultNewId } from '@/shared/utils/ids';

export type ChatRunStatus = 'idle' | 'running' | 'stopping';

/** Longitud del título derivado del primer mensaje de usuario (spec §9). */
export const TITLE_MAX_LENGTH = 48;

/** Intervalo mínimo entre checkpoints de streaming persistidos (spec §9). */
export const CHECKPOINT_INTERVAL_MS = 1000;

/** Máximo de caracteres del preview de conversación persistido para la lista. */
export const PREVIEW_MAX_LENGTH = 120;

/** Fuente de `ProviderConfig[]`; el default real vive en localStorage (features/settings). */
export interface ProviderConfigSource {
  load(): Promise<ProviderConfig[]>;
}

export interface ChatStoreDeps {
  services: AppServices;
  conversations: ConversationRepository;
  tools?: ToolRegistry;
  /** Fuente de proveedores inyectable (default: `LocalProviderConfigRepository`). */
  providers?: ProviderConfigSource;
  clock?: () => number;
  newId?: () => string;
  /** Notifica cambios de resumen (preview, contador, título, research) para la lista. */
  onConversationUpdated?: (conversation: Conversation) => void;
}

export interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  runStatus: ChatRunStatus;
  liveSteps: AgentStep[];
  lastError: MessageError | null;
  researchMode: boolean;
  load(conversationId: string): Promise<void>;
  send(text: string): Promise<void>;
  stop(): void;
  regenerate(assistantMessageId: string): Promise<void>;
  editUserMessage(userMessageId: string, text: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  retryLast(): Promise<void>;
  setResearchMode(enabled: boolean): Promise<void>;
}

export type ChatStore = UseBoundStore<StoreApi<ChatState>>;

type MessageUpdate = Partial<Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>>;

interface TurnContext {
  content: MessageContent[];
  lastCheckpointAt: number;
  checkpointChain: Promise<void>;
}

interface ResolvedTarget {
  provider: ProviderConfig;
  modelId: string;
  model?: ModelInfo;
}

const MESSAGE_ERROR_CODES: readonly MessageErrorCode[] = [
  'auth',
  'rate_limit',
  'network',
  'timeout',
  'server',
  'invalid_request',
  'context_length',
  'aborted',
  'unknown',
];

/** Registro vacío para runs sin investigación: `runAgent` nunca consulta tools deshabilitadas. */
const EMPTY_TOOL_REGISTRY: ToolRegistry = {
  list: () => [],
  get: () => undefined,
};

/** Título de conversación: primeros 48 caracteres (code points) del primer mensaje de usuario. */
export function conversationTitleFromText(text: string): string {
  const trimmed = text.trim();
  const codePoints = Array.from(trimmed);
  return codePoints.length <= TITLE_MAX_LENGTH ? trimmed : codePoints.slice(0, TITLE_MAX_LENGTH).join('');
}

/** Resumen persistible de la conversación para la lista (contador + preview en texto plano). */
function conversationSummary(messages: readonly ChatMessage[]): {
  messageCount: number;
  lastMessagePreview: string;
} {
  const last = messages[messages.length - 1];
  return {
    messageCount: messages.length,
    lastMessagePreview: last === undefined ? '' : previewFromMessage(last),
  };
}

function previewFromMessage(message: ChatMessage): string {
  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const block = message.content[index];
    if (block !== undefined && block.type === 'text') return clampPreview(stripMarkdown(block.text));
  }
  return '';
}

/** Quita la sintaxis markdown más común: el preview de la lista es texto plano. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*)(.*?)\1/g, '$2')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Preview acotado a `PREVIEW_MAX_LENGTH` code points con marcador incluido. */
function clampPreview(text: string): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= PREVIEW_MAX_LENGTH) return text;
  return `${codePoints.slice(0, PREVIEW_MAX_LENGTH - 1).join('')}…`;
}

/**
 * Orquesta una conversación: persiste cada turno en el repo, consume `runAgent`,
 * refleja bloques/steps en vivo y sella el mensaje final con `finishReason`.
 * La API pública está congelada en la spec §9.
 */
export function createChatStore(deps: ChatStoreDeps): ChatStore {
  const repo = deps.conversations;
  const services = deps.services;
  const providerSource: ProviderConfigSource = deps.providers ?? new LocalProviderConfigRepository();
  const clock = deps.clock ?? ((): number => Date.now());
  const generateId = deps.newId ?? ((): string => defaultNewId('msg'));

  let controller: AbortController | null = null;
  let generation = 0;
  let toggleSeq = 0;
  const publishConversation = deps.onConversationUpdated;

  return create<ChatState>((set, get) => {
    const isCurrent = (token: number): boolean => token === generation;

    function abortRun(): void {
      controller?.abort();
      controller = null;
    }

    function updateAssistant(token: number, assistantId: string, content: MessageContent[]): void {
      if (!isCurrent(token)) return;
      const now = clock();
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content, updatedAt: now } : message,
        ),
      }));
    }

    function updateLiveSteps(token: number, updater: (steps: AgentStep[]) => AgentStep[]): void {
      if (!isCurrent(token)) return;
      set((state) => ({ liveSteps: updater(state.liveSteps) }));
    }

    function scheduleCheckpoint(assistantId: string, ctx: TurnContext): void {
      const now = clock();
      if (now - ctx.lastCheckpointAt < CHECKPOINT_INTERVAL_MS) return;
      ctx.lastCheckpointAt = now;
      const snapshot = cloneContent(ctx.content);
      ctx.checkpointChain = ctx.checkpointChain
        .then(() => repo.updateMessage(assistantId, { content: snapshot, status: 'streaming', updatedAt: now }))
        .catch(() => undefined);
    }

    async function persistPatch(messageId: string, patch: MessageUpdate): Promise<void> {
      try {
        await repo.updateMessage(messageId, patch);
      } catch {
        // Persistencia best-effort: el estado en memoria ya refleja el resultado del run.
      }
    }

    /** Persiste `messageCount` + `lastMessagePreview` y notifica a la lista sin recargarla. */
    async function syncConversationSummary(conversationId: string, messages: readonly ChatMessage[]): Promise<void> {
      try {
        const updated = await repo.update(conversationId, conversationSummary(messages));
        publishConversation?.(updated);
      } catch {
        // Persistencia best-effort: la lista se re-sincroniza en el próximo refresh.
      }
    }

    async function finalizeTurn(
      status: AgentRunStatus,
      finalMessage: ChatMessage,
      error: MessageError | undefined,
      token: number,
      assistantId: string,
      ctx: TurnContext,
    ): Promise<void> {
      await ctx.checkpointChain;
      const now = clock();
      const content = cloneContent(finalMessage.content);
      const patch: MessageUpdate = { content, status: finalMessage.status, updatedAt: now };
      if (finalMessage.finishReason !== undefined) patch.finishReason = finalMessage.finishReason;
      if (finalMessage.usage !== undefined) patch.usage = finalMessage.usage;
      if (error !== undefined) patch.error = error;
      await persistPatch(assistantId, patch);
      if (!isCurrent(token)) return;
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? finalizeMessage(
                { ...message, content },
                { status: finalMessage.status, finishReason: finalMessage.finishReason, usage: finalMessage.usage, error, now },
              )
            : message,
        ),
        liveSteps: closeRunningSteps(state.liveSteps, status === 'error' ? 'error' : 'complete', now),
        lastError: error ?? null,
      }));
      const conversationId = get().conversationId;
      if (conversationId !== null) await syncConversationSummary(conversationId, get().messages);
    }

    async function finalizeWithError(cause: unknown, token: number, assistantId: string): Promise<void> {
      const error = toMessageError(cause);
      const now = clock();
      await persistPatch(assistantId, { status: 'error', finishReason: 'error', error, updatedAt: now });
      if (!isCurrent(token)) return;
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? finalizeMessage(message, { status: 'error', finishReason: 'error', error, now })
            : message,
        ),
        liveSteps: closeRunningSteps(state.liveSteps, 'error', now),
        lastError: error,
      }));
      const conversationId = get().conversationId;
      if (conversationId !== null) await syncConversationSummary(conversationId, get().messages);
    }

    async function handleAgentEvent(event: AgentEvent, token: number, assistantId: string, ctx: TurnContext): Promise<void> {
      switch (event.type) {
        case 'run-start':
          updateLiveSteps(token, (steps) => applyAgentEvent(steps, event, clock()));
          return;
        case 'step-start':
          updateLiveSteps(token, (steps) => applyAgentEvent(steps, event, clock()));
          return;
        case 'text-delta':
          ctx.content = appendContentDelta(ctx.content, 'text', event.delta);
          updateLiveSteps(token, (steps) => applyAgentEvent(steps, event, clock()));
          updateAssistant(token, assistantId, ctx.content);
          scheduleCheckpoint(assistantId, ctx);
          return;
        case 'reasoning-delta':
          ctx.content = appendContentDelta(ctx.content, 'reasoning', event.delta);
          updateAssistant(token, assistantId, ctx.content);
          scheduleCheckpoint(assistantId, ctx);
          return;
        case 'tool-start':
          ctx.content = [...ctx.content, { type: 'tool-call', toolCall: event.toolCall }];
          updateLiveSteps(token, (steps) => applyAgentEvent(steps, event, clock()));
          updateAssistant(token, assistantId, ctx.content);
          scheduleCheckpoint(assistantId, ctx);
          return;
        case 'tool-end':
          ctx.content = [
            ...ctx.content,
            { type: 'tool-result', toolCallId: event.toolCall.id, toolName: event.toolCall.name, result: event.result },
          ];
          updateLiveSteps(token, (steps) => applyAgentEvent(steps, event, clock()));
          updateAssistant(token, assistantId, ctx.content);
          scheduleCheckpoint(assistantId, ctx);
          return;
        case 'step-end':
          updateLiveSteps(token, (steps) => applyAgentEvent(steps, event, clock()));
          return;
        case 'run-end':
          await finalizeTurn(event.status, event.message, event.error, token, assistantId, ctx);
          return;
      }
    }

    /** Reclama el turno de forma síncrona: un segundo envío en el mismo tick no pasa de aquí. */
    function claimRun(): number | null {
      if (get().runStatus !== 'idle') return null;
      generation += 1;
      const token = generation;
      set({ runStatus: 'running', lastError: null });
      return token;
    }

    async function ensureConversation(firstText: string, token: number): Promise<string | null> {
      const current = get().conversationId;
      if (current !== null) return current;
      let created = await repo.create({ title: conversationTitleFromText(firstText) });
      if (get().researchMode) {
        created = await repo.update(created.id, { researchMode: true });
      }
      if (!isCurrent(token)) {
        void repo.remove(created.id).catch(() => undefined);
        return null;
      }
      publishConversation?.(created);
      set({ conversationId: created.id, messages: [], liveSteps: [], lastError: null });
      return created.id;
    }

    /** Secuencia de un turno ya reclamado: asegura conversación, persiste user y corre el agente. */
    async function startTurn(content: string, token: number): Promise<void> {
      const conversationId = await ensureConversation(content, token);
      if (conversationId === null) return;
      const conversation = await repo.get(conversationId);
      if (!isCurrent(token)) return;
      if (conversation === null) throw configurationError('The conversation no longer exists.');

      const history = await repo.listMessages(conversationId);
      if (!isCurrent(token)) return;
      const userMessage = createUserMessage({ id: generateId(), conversationId, text: content, now: clock() });
      await repo.appendMessage(userMessage);
      if (!isCurrent(token)) return;
      set((state) => ({ messages: [...state.messages, userMessage] }));

      let current = conversation;
      const title = conversationTitleFromText(content);
      if (!history.some((message) => message.role === 'user') && current.title !== title) {
        current = await repo.update(conversationId, { title });
        if (!isCurrent(token)) return;
      }

      await syncConversationSummary(conversationId, get().messages);
      if (!isCurrent(token)) return;

      await runTurn({ conversation: current, userMessage, history }, token);
    }

    /** Registry de tools del run: override de tests, seam de `AppServices` o fallback directo. */
    function resolveToolRegistry(settings: AppSettings): ToolRegistry {
      if (deps.tools !== undefined) return deps.tools;
      if (services.createTools !== undefined) return services.createTools(settings);
      return createToolRegistry(settings, { http: services.http, keys: services.keys, now: clock });
    }

    async function runTurn(
      input: {
        conversation: Conversation;
        userMessage: ChatMessage;
        history: ChatMessage[];
      },
      token: number,
    ): Promise<void> {
      const settings = await services.settings.load();
      if (!isCurrent(token)) return;
      const providers = await providerSource.load();
      if (!isCurrent(token)) return;
      const target = resolveProviderTarget(input.conversation, settings, providers);
      if (target === null) {
        throw configurationError('No provider or model is configured. Add one in Settings to start chatting.');
      }

      const conversationId = input.conversation.id;
      const adapter = await services.createAdapter(target.provider);
      if (!isCurrent(token)) return;

      // Modo efectivo: intención de la conversación + settings + capacidades reales del
      // modelo/adapter. Así el system prompt no anuncia tools que `runAgent` ocultaría.
      const capabilities = resolveCapabilities(target.provider, target.model);
      const researchMode =
        input.conversation.researchMode &&
        settings.tools.webSearchEnabled &&
        capabilities.toolCalling &&
        adapter.capabilities().toolCalling;
      const tools = researchMode ? resolveToolRegistry(settings) : EMPTY_TOOL_REGISTRY;

      const conversation =
        input.conversation.providerId === target.provider.id && input.conversation.modelId === target.modelId
          ? input.conversation
          : await repo.update(conversationId, { providerId: target.provider.id, modelId: target.modelId });
      if (!isCurrent(token)) return;

      const assistant = createAssistantMessage({
        id: generateId(),
        conversationId,
        providerId: target.provider.id,
        modelId: target.modelId,
        now: clock(),
      });
      const runController = new AbortController();
      controller = runController;

      const ctx: TurnContext = { content: [], lastCheckpointAt: clock(), checkpointChain: Promise.resolve() };

      try {
        await repo.appendMessage(assistant);
        if (!isCurrent(token)) {
          void repo.deleteMessagesFrom(conversationId, assistant.id).catch(() => undefined);
          return;
        }

        set((state) => ({
          runStatus: 'running',
          liveSteps: [],
          lastError: null,
          messages: state.messages.some((message) => message.id === assistant.id)
            ? state.messages
            : [...state.messages, assistant],
        }));

        const params: RunAgentParams = {
          providerId: target.provider.id,
          modelId: target.modelId,
          conversationId,
          systemPrompt: composeSystemPrompt(conversation, settings, clock(), researchMode),
          history: input.history,
          userMessage: input.userMessage,
          defaults: { temperature: settings.chat.temperature, maxOutputTokens: settings.chat.maxOutputTokens },
          budget: settings.agent,
          historyBudget: settings.history,
          researchMode,
          signal: runController.signal,
        };
        if (target.model !== undefined) params.model = target.model;

        for await (const event of runAgent(params, { provider: adapter, tools, clock, newId: generateId })) {
          if (!isCurrent(token)) break;
          await handleAgentEvent(event, token, assistant.id, ctx);
        }
      } catch (cause) {
        await finalizeWithError(cause, token, assistant.id);
      } finally {
        if (isCurrent(token)) {
          controller = null;
          set({ runStatus: 'idle' });
        }
      }
    }

    return {
      conversationId: null,
      messages: [],
      runStatus: 'idle',
      liveSteps: [],
      lastError: null,
      researchMode: false,

      async load(conversationId) {
        abortRun();
        generation += 1;
        const token = generation;
        set({ conversationId, messages: [], runStatus: 'idle', liveSteps: [], lastError: null, researchMode: false });
        try {
          const [messages, conversation] = await Promise.all([
            repo.listMessages(conversationId),
            repo.get(conversationId),
          ]);
          if (isCurrent(token)) set({ messages, researchMode: conversation?.researchMode ?? false });
        } catch (cause) {
          if (isCurrent(token)) set({ lastError: toMessageError(cause) });
        }
      },

      async send(text) {
        const content = text.trim();
        if (content === '') return;
        const token = claimRun();
        if (token === null) return;
        try {
          await startTurn(content, token);
        } catch (cause) {
          if (!isCurrent(token)) return;
          set({ lastError: toMessageError(cause), runStatus: 'idle' });
        }
      },

      stop() {
        if (get().runStatus === 'idle') return;
        if (controller === null) {
          // Reclamo en curso (antes de abrir el stream): invalida el token y libera el turno.
          generation += 1;
          set({ runStatus: 'idle' });
          return;
        }
        set({ runStatus: 'stopping' });
        controller.abort();
      },

      async regenerate(assistantMessageId) {
        const conversationId = get().conversationId;
        if (conversationId === null) return;

        const messages = get().messages;
        const index = messages.findIndex((message) => message.id === assistantMessageId);
        const target = index === -1 ? undefined : messages[index];
        if (target === undefined || target.role !== 'assistant') return;

        const before = messages.slice(0, index);
        const userIndex = findLastUserIndex(before);
        const userMessage = userIndex === -1 ? undefined : before[userIndex];
        if (userMessage === undefined) return;

        const token = claimRun();
        if (token === null) return;
        try {
          await repo.deleteMessagesFrom(conversationId, assistantMessageId);
          if (!isCurrent(token)) return;
          const conversation = await repo.get(conversationId);
          if (!isCurrent(token)) return;
          if (conversation === null) throw configurationError('The conversation no longer exists.');
          set({ messages: before, liveSteps: [], lastError: null });
          await syncConversationSummary(conversationId, before);
          if (!isCurrent(token)) return;
          await runTurn({ conversation, userMessage, history: before.slice(0, userIndex) }, token);
        } catch (cause) {
          if (!isCurrent(token)) return;
          set({ lastError: toMessageError(cause), runStatus: 'idle' });
        }
      },

      async editUserMessage(userMessageId, text) {
        const content = text.trim();
        if (content === '') return;
        const conversationId = get().conversationId;
        if (conversationId === null) return;

        const messages = get().messages;
        const index = messages.findIndex((message) => message.id === userMessageId);
        const target = index === -1 ? undefined : messages[index];
        if (target === undefined || target.role !== 'user') return;

        const token = claimRun();
        if (token === null) return;
        try {
          await repo.deleteMessagesFrom(conversationId, userMessageId);
          if (!isCurrent(token)) return;
          set({ messages: messages.slice(0, index), liveSteps: [], lastError: null });
          await startTurn(content, token);
        } catch (cause) {
          if (!isCurrent(token)) return;
          set({ lastError: toMessageError(cause), runStatus: 'idle' });
        }
      },

      async deleteMessage(messageId) {
        if (get().runStatus !== 'idle') return;
        const conversationId = get().conversationId;
        if (conversationId === null) return;

        const messages = get().messages;
        const index = messages.findIndex((message) => message.id === messageId);
        if (index === -1) return;

        try {
          await repo.deleteMessagesFrom(conversationId, messageId);
          const remaining = messages.slice(0, index);
          set({ messages: remaining });
          await syncConversationSummary(conversationId, remaining);
        } catch (cause) {
          set({ lastError: toMessageError(cause) });
        }
      },

      async retryLast() {
        if (get().runStatus !== 'idle') return;
        const messages = get().messages;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (message !== undefined && isFailedAssistant(message)) {
            await get().regenerate(message.id);
            return;
          }
        }
      },

      async setResearchMode(enabled) {
        const token = ++toggleSeq;
        if (enabled) {
          const settings = await services.settings.load().catch(() => null);
          if (token !== toggleSeq) return;
          if (settings === null || !settings.tools.webSearchEnabled) return;
        }
        set({ researchMode: enabled });
        const conversationId = get().conversationId;
        if (conversationId === null) return;
        try {
          const updated = await repo.update(conversationId, { researchMode: enabled });
          if (token === toggleSeq) publishConversation?.(updated);
        } catch {
          // Persistencia best-effort: el estado local ya refleja el toggle.
        }
      },
    };
  });
}

function resolveProviderTarget(
  conversation: Conversation,
  settings: AppSettings,
  providers: readonly ProviderConfig[],
): ResolvedTarget | null {
  const provider =
    (conversation.providerId === null ? undefined : providers.find((entry) => entry.id === conversation.providerId)) ??
    (settings.activeProviderId === null
      ? undefined
      : providers.find((entry) => entry.id === settings.activeProviderId)) ??
    providers[0];
  if (provider === undefined) return null;

  const modelId =
    (conversation.providerId === provider.id ? conversation.modelId : null) ??
    settings.lastModelByProvider[provider.id] ??
    provider.defaultModelId ??
    provider.models[0]?.id ??
    null;
  if (modelId === null) return null;

  const model = provider.models.find((entry) => entry.id === modelId);
  return model === undefined ? { provider, modelId } : { provider, modelId, model };
}

function composeSystemPrompt(conversation: Conversation, settings: AppSettings, now: number, researchMode: boolean): string {
  const override = conversation.systemPromptOverride;
  const persona = (override !== null && override.trim() !== '' ? override : settings.chat.systemPrompt).trim();
  const scaffold = buildSystemPrompt({ researchMode, now, locale: settings.locale });
  return persona === '' ? scaffold : `${persona}\n\n${scaffold}`;
}

function appendContentDelta(
  blocks: readonly MessageContent[],
  type: 'text' | 'reasoning',
  delta: string,
): MessageContent[] {
  const next = blocks.slice();
  const last = next[next.length - 1];
  if (last !== undefined && last.type === type) {
    next[next.length - 1] = { type, text: last.text + delta };
    return next;
  }
  next.push({ type, text: delta });
  return next;
}

function cloneContent(blocks: readonly MessageContent[]): MessageContent[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'reasoning':
        return { type: 'reasoning', text: block.text };
      case 'tool-call':
        return { type: 'tool-call', toolCall: { ...block.toolCall } };
      case 'tool-result':
        return {
          type: 'tool-result',
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          result: { ...block.result },
        };
    }
  });
}

function findLastUserIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function isFailedAssistant(message: ChatMessage): boolean {
  return (
    message.status === 'error' ||
    message.status === 'aborted' ||
    message.finishReason === 'error' ||
    message.finishReason === 'aborted'
  );
}

function configurationError(message: string): Error {
  return Object.assign(new Error(message), { code: 'invalid_request' as const, retryable: false });
}

function toMessageError(cause: unknown): MessageError {
  const record = asRecord(cause);
  const code = readMessageErrorCode(record?.code);
  const message =
    cause instanceof Error && cause.message !== ''
      ? cause.message
      : typeof record?.message === 'string' && record.message !== ''
        ? record.message
        : 'Unexpected error.';
  const retryable = typeof record?.retryable === 'boolean' ? record.retryable : defaultRetryable(code);
  return { code, message, retryable };
}

function readMessageErrorCode(value: unknown): MessageErrorCode {
  return typeof value === 'string' && (MESSAGE_ERROR_CODES as readonly string[]).includes(value)
    ? (value as MessageErrorCode)
    : 'unknown';
}

function defaultRetryable(code: MessageErrorCode): boolean {
  return code === 'rate_limit' || code === 'network' || code === 'timeout' || code === 'server';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Contexto/hook de React del store de chat (patrón de `conversationsStore`). */
export { ChatStoreProvider, useChatStore } from './ChatStoreContext';
export type { ChatStoreProviderProps } from './ChatStoreContext';
