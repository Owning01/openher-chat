import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import { createToolRegistry } from '@/adapters/tools';
import type { AppServices } from '@/app/services';
import { generateTitle } from '@/domain/agent/generateTitle';
import { compactMessages, preserveRecentBudget, shouldCompact } from '@/domain/agent/compaction';
import { runAgent } from '@/domain/agent/runAgent';
import type { RunAgentParams } from '@/domain/agent/runAgent';
import { buildSystemPrompt } from '@/domain/agent/systemPrompt';
import { truncateText } from '@/domain/chat/truncateText';
import { buildCaseBrief, buildLegalBriefMessages } from '@/domain/legal/brief';
import { buildLegalCircuitSystemPrompt, buildLegalSystemPrompt } from '@/domain/legal/prompt';
import { redactLegalCase } from '@/domain/legal/redaction';
import type { RedactionMapping } from '@/domain/legal/redaction';
import { estimateLegalTokens, searchLegalPassages } from '@/domain/legal/retrieval';
import type { LegalCircuitRole, LegalPassage } from '@/domain/types/legal';
import { createAssistantMessage, createUserMessage, finalizeMessage } from '@/domain/chat/messageFactory';
import type { ImageDraft } from '@/domain/documents/documents';
import { messagePlainText } from '@/domain/chat/messageSearch';
import { resolveCapabilities } from '@/domain/providers/capabilities';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ToolPermissionGate } from '@/domain/ports/ToolPermission';
import type { AgentEvent, AgentRunStatus, AgentStep } from '@/domain/types/agent';
import type { ChatMessage, MessageContent, MessageError, MessageErrorCode } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import type { ModelInfo, ProviderConfig } from '@/domain/types/provider';
import type { AppSettings } from '@/domain/types/settings';
import type { Skill } from '@/domain/types/skill';
import type { ToolRegistry } from '@/domain/types/tools';
import { applyAgentEvent, closeRunningSteps } from '@/features/research/selectors';
import { LocalProviderConfigRepository } from '@/features/settings/state/providerStorage';
import { newId as defaultNewId } from '@/shared/utils/ids';

export type ChatRunStatus = 'idle' | 'running' | 'stopping';

/** Tool pendiente de autorización del usuario (gate de permisos). */
export interface ToolApprovalRequest {
  tool: string;
  argumentsText: string;
}

/** Longitud del título derivado del primer mensaje de usuario (spec §9). */
export const TITLE_MAX_LENGTH = 48;

/**
 * Instrucción (solo wire) para reanudar una respuesta truncada. No se persiste
 * como mensaje de usuario: el historial ya termina en el assistant parcial.
 */
export const CONTINUATION_INSTRUCTION =
  'Continue exactly where the previous answer was cut off. Do not repeat what you already wrote; output only the continuation.';

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
  /** Genera un título con el modelo tras el primer intercambio (default: desactivado). */
  autoTitle?: boolean;
  /** Compacta el contexto con un resumen anclado al acercarse a la ventana (default: desactivado). */
  compaction?: boolean;
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
  /** Caso legal vinculado (pendiente o persistido); `null` = modo general. */
  legalCaseId: string | null;
  /**
   * Rol del chat en el circuito adversarial (`redactor` → `atacante` → `juez` → `sintesis`);
   * `null` = sin rol. Viaja con la conversación igual que `legalCaseId`.
   */
  legalRole: LegalCircuitRole | null;
  /**
   * Mappings de pseudonimización por conversación (R-1): sólo memoria del
   * store, JAMÁS persistidos (el repo sólo recibe mensajes y campos de la
   * conversación). La UI los consume vía `getRedactionMapping` para
   * `deanonymize` en render.
   */
  redactionMappings: Record<string, RedactionMapping>;
  /**
   * Mapping para deanonymize en render; `null` si la conversación no tiene
   * caso redactado en esta sesión (o si el id es `null`). Referencia estable.
   */
  getRedactionMapping(conversationId: string | null): RedactionMapping | null;
  /** Tool que espera autorización (null si no hay ninguna pendiente). */
  pendingApproval: ToolApprovalRequest | null;
  load(conversationId: string): Promise<void>;
  /**
   * Envía el turno. `images` son imágenes ya comprimidas (dataUrl) del
   * composer; el texto puede ir vacío si hay imágenes. Sin imágenes el
   * comportamiento es idéntico al de siempre.
   */
  send(text: string, images?: readonly ImageDraft[]): Promise<void>;
  stop(): void;
  /** Autoriza la tool pendiente; `always` la recuerda para toda la sesión. */
  approveTool(always: boolean): void;
  /** Deniega la tool pendiente: el agente continúa sin ejecutarla. */
  denyTool(): void;
  /** Reanuda la última respuesta truncada (`finishReason: max_tokens`) sin repetirla. */
  continueGeneration(assistantMessageId: string): Promise<void>;
  regenerate(assistantMessageId: string): Promise<void>;
  editUserMessage(userMessageId: string, text: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  retryLast(): Promise<void>;
  setResearchMode(enabled: boolean): Promise<void>;
  /** Vincula/desvincula el expediente legal (mismo lifecycle que `setResearchMode`). */
  setLegalCase(caseId: string | null): Promise<void>;
  /** Fija el rol del circuito adversarial (mismo lifecycle que `setLegalCase`). */
  setLegalRole(role: LegalCircuitRole | null): Promise<void>;
  /**
   * Semilla pendiente del circuito: `load()` la auto-envía una sola vez tras
   * hidratar (nunca antes, para que el `fetch` no pise el turno). `null` = sin
   * semilla. El consumo exige consentimiento del caso (gate H1).
   */
  pendingSeed: { conversationId: string; seed: string } | null;
  setPendingSeed(seed: { conversationId: string; seed: string } | null): void;
  /** Fija proveedor/modelo de la conversación (y el último usado) desde el chat. */
  setModel(providerId: string, modelId: string): Promise<void>;
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
  let imageName: string | null = null;
  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const block = message.content[index];
    if (block === undefined) continue;
    if (block.type === 'text') {
      if (block.text.trim() !== '') return clampPreview(stripMarkdown(block.text));
    } else if (block.type === 'image' && imageName === null) {
      imageName = block.name;
    }
  }
  return imageName === null ? '' : clampPreview(`[imagen: ${imageName}]`);
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

/** Id sintético del mensaje que porta el resumen de compactación (no se persiste). */
export const COMPACTION_ANCHOR_ID = '__compaction_summary__';

/**
 * Reinyecta el resumen anclado al frente del historial y descarta los mensajes
 * ya resumidos (todo hasta `summaryThroughMessageId`, inclusive).
 */
export function applyCompaction(history: readonly ChatMessage[], conversation: Conversation): ChatMessage[] {
  const summary = conversation.summary;
  if (summary === undefined || summary.trim() === '') return [...history];

  let rest = [...history];
  const through = conversation.summaryThroughMessageId;
  if (through !== undefined) {
    const index = history.findIndex((message) => message.id === through);
    if (index >= 0) rest = history.slice(index + 1);
  }

  const anchor: ChatMessage = {
    id: COMPACTION_ANCHOR_ID,
    conversationId: conversation.id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: `[Summary of earlier conversation]\n\n${summary}` }],
    createdAt: 0,
    updatedAt: 0,
  };
  return [anchor, ...rest];
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
  let titleController: AbortController | null = null;
  let compactionController: AbortController | null = null;
  let generation = 0;
  // B20/B26: secuencias separadas por dimensión ortogonal (research vs legal).
  // Compartir un único `toggleSeq` hacía que toggles concurrentes de dimensiones
  // distintas se suprimieran el `publish` entre sí; con secuencias propias cada
  // dimensión sólo compite con sus propios toggles rápidos (last-write-wins).
  let researchToggleSeq = 0;
  let legalToggleSeq = 0;
  const publishConversation = deps.onConversationUpdated;

  return create<ChatState>((set, get) => {
    const isCurrent = (token: number): boolean => token === generation;

    /** Tools aprobadas con "siempre": no vuelven a preguntar en esta sesión. */
    const alwaysApproved = new Set<string>();
    let approvalResolver: ((allowed: boolean) => void) | null = null;

    function cancelApproval(): void {
      const resolver = approvalResolver;
      if (resolver === null) return;
      approvalResolver = null;
      set({ pendingApproval: null });
      resolver(false);
    }

    /** Gate de permisos: suspende la tool hasta que la UI resuelve la aprobación. */
    function createPermissionGate(): ToolPermissionGate {
      return {
        request: ({ tool, arguments: args }) => {
          if (alwaysApproved.has(tool)) return Promise.resolve(true);
          return new Promise<boolean>((resolve) => {
            approvalResolver = resolve;
            set({ pendingApproval: { tool, argumentsText: describeArguments(args) } });
          });
        },
      };
    }

    function abortRun(): void {
      cancelApproval();
      titleController?.abort();
      titleController = null;
      compactionController?.abort();
      compactionController = null;
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
      if (finalMessage.truncated === true) patch.truncated = true;
      if (error !== undefined) patch.error = error;
      await persistPatch(assistantId, patch);
      if (!isCurrent(token)) return;
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? finalizeMessage(
                { ...message, content },
                {
                  status: finalMessage.status,
                  finishReason: finalMessage.finishReason,
                  usage: finalMessage.usage,
                  truncated: finalMessage.truncated,
                  error,
                  now,
                },
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
      const pendingLegal = get().legalCaseId;
      if (pendingLegal != null) {
        created = await repo.update(created.id, { legalCaseId: pendingLegal });
      }
      const pendingRole = get().legalRole;
      if (pendingRole != null) {
        created = await repo.update(created.id, { legalRole: pendingRole });
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
    async function startTurn(content: string, token: number, images: readonly ImageDraft[] = []): Promise<void> {
      const titleSource = content !== '' ? content : (images[0]?.name ?? '');
      const conversationId = await ensureConversation(titleSource, token);
      if (conversationId === null) return;
      const conversation = await repo.get(conversationId);
      if (!isCurrent(token)) return;
      if (conversation === null) throw configurationError('The conversation no longer exists.');

      const history = await repo.listMessages(conversationId);
      if (!isCurrent(token)) return;
      const userMessage = createUserMessage({
        id: generateId(),
        conversationId,
        text: content,
        images: images.map((image) => ({ imageId: image.id, name: image.name, mime: image.mime, dataUrl: image.dataUrl })),
        now: clock(),
      });
      await repo.appendMessage(userMessage);
      if (!isCurrent(token)) return;
      set((state) => ({ messages: [...state.messages, userMessage] }));

      let current = conversation;
      const title = conversationTitleFromText(titleSource);
      if (title !== '' && !history.some((message) => message.role === 'user') && current.title !== title) {
        current = await repo.update(conversationId, { title });
        if (!isCurrent(token)) return;
      }

      await syncConversationSummary(conversationId, get().messages);
      if (!isCurrent(token)) return;

      await runTurn({ conversation: current, userMessage, history }, token);
    }

    /**
     * Consume la semilla pendiente del circuito tras hidratar (nunca antes: el
     * `fetch` de `load` pisaría el turno). Exige turno idle, misma
     * conversación y consentimiento del caso (H1: el auto-envío no pasa por el
     * Composer, así que respeta su gate acá). Nunca lanza.
     */
    function consumePendingSeed(token: number): void {
      const seed = get().pendingSeed;
      if (seed === null || get().runStatus !== 'idle') return;
      set({ pendingSeed: null });
      void (async () => {
        if (!isCurrent(token)) return;
        if (get().conversationId !== seed.conversationId) return;
        const caseId = get().legalCaseId;
        const cases = services.legalCases;
        if (caseId !== null && cases !== undefined) {
          const legalCase = await cases.get(caseId).catch(() => null);
          if (!isCurrent(token) || get().conversationId !== seed.conversationId) return;
          if (legalCase?.consent === undefined) return;
        }
        await get().send(seed.seed);
      })();
    }

    /** Registry de tools del run: override de tests, seam de `AppServices` o fallback directo. */
    function resolveToolRegistry(
      settings: AppSettings,
      conversationId: string,
      legalCaseId: string | null,
      skills: readonly Skill[],
    ): ToolRegistry {
      if (deps.tools !== undefined) return deps.tools;
      if (services.createTools !== undefined) {
        return services.createTools(settings, { conversationId, legalCaseId, skills });
      }
      return createToolRegistry(settings, { http: services.http, keys: services.keys, now: clock, skills });
    }

    /**
     * Arma el brief del expediente como sufijo efímero (sólo wire).
     * R-1 (redactado-first): el caso se pseudonimiza con `redactLegalCase`
     * ANTES de armar el brief, así título, partes, hechos y fechas clave viajan
     * con tokens y ningún valor del mapping llega al proveedor. El apéndice de
     * texto libre (`redactedText`) queda en `undefined`: hoy no hay texto extra
     * que adjuntar y el brief ya contiene el caso redactado completo.
     * El mapping se guarda sólo en memoria (`redactionMappings`, nunca
     * persistido) para `deanonymize` en render. Nunca toca `history` ni lo
     * persistido; degrada a `undefined` (turno sin brief) sin romper el turno
     * general: nunca lanza.
     */
    async function buildLegalEphemeralSuffix(input: {
      conversationId: string;
      legalCaseId: string | null;
      userMessage: ChatMessage;
      settings: AppSettings;
      toolCalling: boolean;
      supportsToolsModel: boolean;
      contextWindow?: number;
    }): Promise<ChatMessage[] | undefined> {
      try {
        const caseId = input.legalCaseId;
        if (caseId === null || caseId.trim() === '') return undefined;
        const cases = services.legalCases;
        if (cases === undefined) return undefined;
        const legalCase = await cases.get(caseId).catch(() => null);
        if (legalCase === null) return undefined;

        const redacted = redactLegalCase(legalCase);

        const budget = input.settings.legal.retrieval;
        let passages: LegalPassage[] = [];
        let corpusReady = false;
        try {
          const corpus = services.legalCorpus;
          if (corpus !== undefined) {
            const index = await corpus.ensureIndex();
            corpusReady = index.size > 0;
            if (corpusReady) {
              const query = composeLegalQuery(input.userMessage, legalCase.title);
              passages = searchLegalPassages(index, query, budget.maxPassages)
                .slice(0, Math.max(0, budget.maxPassages))
                .map((passage) => truncateLegalPassage(passage, budget.maxPassageChars));
            }
          }
        } catch {
          passages = [];
          corpusReady = false;
        }

        const brief = capBriefToBudget(
          buildCaseBrief({ case: redacted.redacted, passages, redactedText: undefined }),
          budget.maxBriefTokens,
          input.contextWindow,
        );
        const supportsTools = input.toolCalling && input.supportsToolsModel && corpusReady;
        const now = clock();
        const id = generateId();
        const messages = buildLegalBriefMessages({
          brief,
          supportsTools,
          id,
          conversationId: input.conversationId,
          now,
        }).messages;
        set((state) => ({
          redactionMappings: { ...state.redactionMappings, [input.conversationId]: redacted.mapping },
        }));
        return messages;
      } catch {
        return undefined;
      }
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
      // El modo legal se deriva sólo de `legalCaseId` (independiente del workspace
      // global y de `webSearchEnabled`); ambos modos son ortogonales y combinables.
      const capabilities = resolveCapabilities(target.provider, target.model);
      const adapterCapabilities = adapter.capabilities();
      const webResearchMode =
        input.conversation.researchMode &&
        settings.tools.webSearchEnabled &&
        capabilities.toolCalling &&
        adapterCapabilities.toolCalling;
      const legalMode = input.conversation.legalCaseId != null;
      // Skills: leerlas una vez por turno (nombre+descripción al prompt, cuerpo al
      // `load_skill`). Sin skills guardadas no cambia nada respecto de antes.
      const skills = await loadSkills(services);
      if (!isCurrent(token)) return;
      const skillsMode = skills.length > 0 && capabilities.toolCalling && adapterCapabilities.toolCalling;
      const enableTools = webResearchMode || legalMode || skillsMode;
      const legalCaseId = input.conversation.legalCaseId ?? null;
      const tools = enableTools
        ? resolveToolRegistry(settings, conversationId, legalCaseId, skillsMode ? skills : [])
        : EMPTY_TOOL_REGISTRY;

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
          systemPrompt: composeSystemPrompt(
            conversation,
            settings,
            clock(),
            webResearchMode,
            legalMode,
            skillsMode ? skills : [],
          ),
          history: applyCompaction(input.history, conversation),
          userMessage: input.userMessage,
          defaults: {
            temperature: settings.chat.temperature,
            maxOutputTokens: settings.chat.maxOutputTokens,
            thinking: settings.chat.thinking,
          },
          budget: settings.agent,
          historyBudget: settings.history,
          researchMode: webResearchMode,
          enableTools,
          signal: runController.signal,
        };
        if (target.model !== undefined) params.model = target.model;
        const legalSuffix = legalMode
          ? await buildLegalEphemeralSuffix({
              conversationId,
              legalCaseId,
              userMessage: input.userMessage,
              settings,
              toolCalling: capabilities.toolCalling && adapter.capabilities().toolCalling,
              supportsToolsModel: target.model?.supportsTools !== false,
              contextWindow: target.model?.contextWindow,
            })
          : undefined;
        if (legalSuffix !== undefined && legalSuffix.length > 0) params.ephemeralSuffix = legalSuffix;

        const permissions = settings.tools.requireApproval ? createPermissionGate() : undefined;
        for await (const event of runAgent(params, {
          provider: adapter,
          tools,
          clock,
          newId: generateId,
          ...(permissions === undefined ? {} : { permissions }),
        })) {
          if (!isCurrent(token)) break;
          await handleAgentEvent(event, token, assistant.id, ctx);
        }
      } catch (cause) {
        await finalizeWithError(cause, token, assistant.id);
      } finally {
        if (isCurrent(token)) {
          controller = null;
          set({ runStatus: 'idle' });
          if (deps.autoTitle === true) {
            void maybeGenerateTitle(token, conversationId, adapter, target);
          }
          if (deps.compaction === true) {
            void maybeCompact(token, conversationId, adapter, target, settings);
          }
        }
      }
    }

    /**
     * Genera un título con el modelo tras el primer intercambio. No bloquea el
     * turno y nunca pisa un título que el usuario haya cambiado a mano (solo si
     * sigue siendo el derivado del primer mensaje de usuario).
     */
    async function maybeGenerateTitle(
      token: number,
      conversationId: string,
      adapter: ProviderAdapter,
      target: ResolvedTarget,
    ): Promise<void> {
      const messages = get().messages;
      if (messages.length !== 2) return;
      const userMessage = messages.find((message) => message.role === 'user');
      const assistant = messages.find((message) => message.role === 'assistant');
      if (userMessage === undefined || assistant === undefined) return;
      if (assistant.status !== 'complete' && assistant.status !== 'aborted') return;

      const userText = messagePlainText(userMessage);
      const assistantText = messagePlainText(assistant);
      if (userText.trim() === '' || assistantText.trim() === '') return;

      const local = new AbortController();
      titleController = local;
      const title = await generateTitle({
        provider: adapter,
        modelId: target.modelId,
        userText,
        assistantText,
        sessionId: conversationId,
        signal: local.signal,
      });
      if (titleController === local) titleController = null;
      if (title === null || !isCurrent(token)) return;

      try {
        const conversation = await repo.get(conversationId);
        if (conversation === null) return;
        if (conversation.title !== conversationTitleFromText(userText)) return;
        const updated = await repo.update(conversationId, { title });
        if (!isCurrent(token)) return;
        publishConversation?.(updated);
      } catch {
        // Persistencia best-effort: el título derivado sigue siendo válido.
      }
    }

    /**
     * Compacta cuando la estimación de contexto supera `ventana - max(salida, buffer)`
     * (umbral de OpenCode). Guarda el resumen anclado y el punto de corte; el turno
     * siguiente reinyecta el resumen y descarta los mensajes ya resumidos.
     */
    async function maybeCompact(
      token: number,
      conversationId: string,
      adapter: ProviderAdapter,
      target: ResolvedTarget,
      settings: AppSettings,
    ): Promise<void> {
      const contextWindow =
        target.model?.contextWindow ??
        (settings.history.mode === 'fixed' ? settings.history.maxPromptTokens : null);
      if (contextWindow === null || contextWindow <= 0) return;

      const history = get().messages;
      const reservedOutput = settings.chat.maxOutputTokens ?? settings.history.reservedOutputTokens;
      if (!shouldCompact({ history, contextWindow, reservedOutput })) return;

      const conversation = await repo.get(conversationId);
      if (conversation === null || !isCurrent(token)) return;

      const local = new AbortController();
      compactionController = local;
      const result = await compactMessages({
        provider: adapter,
        modelId: target.modelId,
        messages: history,
        previousSummary: conversation.summary,
        keepTokens: preserveRecentBudget(contextWindow),
        maxSummaryTokens: reservedOutput > 0 ? reservedOutput : undefined,
        sessionId: conversationId,
        signal: local.signal,
      });
      if (compactionController === local) compactionController = null;
      if (result === null || !isCurrent(token)) return;

      try {
        const updated = await repo.update(conversationId, {
          summary: result.summary,
          summaryThroughMessageId: result.throughMessageId,
        });
        if (!isCurrent(token)) return;
        publishConversation?.(updated);
      } catch {
        // Persistencia best-effort: el historial completo sigue siendo válido.
      }
    }

    return {
      conversationId: null,
      messages: [],
      runStatus: 'idle',
      liveSteps: [],
      lastError: null,
      researchMode: false,
      legalCaseId: null,
      legalRole: null,
      redactionMappings: {},
      getRedactionMapping(conversationId) {
        if (conversationId === null) return null;
        return get().redactionMappings[conversationId] ?? null;
      },
      pendingApproval: null,
      pendingSeed: null,
      setPendingSeed(seed) {
        set({ pendingSeed: seed });
      },

      async load(conversationId) {
        abortRun();
        generation += 1;
        const token = generation;
        set({ conversationId, messages: [], runStatus: 'idle', liveSteps: [], lastError: null, researchMode: false, legalCaseId: null, legalRole: null });
        try {
          const [messages, conversation] = await Promise.all([
            repo.listMessages(conversationId),
            repo.get(conversationId),
          ]);
          if (isCurrent(token)) {
            set({
              messages,
              researchMode: conversation?.researchMode ?? false,
              legalCaseId: conversation?.legalCaseId ?? null,
              legalRole: conversation?.legalRole ?? null,
            });
            consumePendingSeed(token);
          }
        } catch (cause) {
          if (isCurrent(token)) set({ lastError: toMessageError(cause) });
        }
      },

      async send(text, images = []) {
        const content = text.trim();
        if (content === '' && images.length === 0) return;
        const token = claimRun();
        if (token === null) return;
        try {
          await startTurn(content, token, images);
        } catch (cause) {
          if (!isCurrent(token)) return;
          set({ lastError: toMessageError(cause), runStatus: 'idle' });
        }
      },

      stop() {
        if (get().runStatus === 'idle') return;
        cancelApproval();
        if (controller === null) {
          // Reclamo en curso (antes de abrir el stream): invalida el token y libera el turno.
          generation += 1;
          set({ runStatus: 'idle' });
          return;
        }
        set({ runStatus: 'stopping' });
        controller.abort();
      },

      approveTool(always) {
        const pending = get().pendingApproval;
        if (pending === null) return;
        if (always) alwaysApproved.add(pending.tool);
        const resolver = approvalResolver;
        approvalResolver = null;
        set({ pendingApproval: null });
        resolver?.(true);
      },

      denyTool() {
        const resolver = approvalResolver;
        approvalResolver = null;
        set({ pendingApproval: null });
        resolver?.(false);
      },

      async continueGeneration(assistantMessageId) {
        const state = get();
        const conversationId = state.conversationId;
        if (conversationId === null || state.runStatus !== 'idle') return;
        const target = state.messages.find((message) => message.id === assistantMessageId);
        if (target === undefined || target.role !== 'assistant') return;
        if (state.messages[state.messages.length - 1]?.id !== assistantMessageId) return;
        const conversation = await repo.get(conversationId);
        if (conversation === null) return;
        const history = await repo.listMessages(conversationId);
        const token = ++generation;
        const instruction = createUserMessage({
          id: generateId(),
          conversationId,
          text: CONTINUATION_INSTRUCTION,
          now: clock(),
        });
        try {
          await runTurn({ conversation, userMessage: instruction, history }, token);
        } catch (cause) {
          if (isCurrent(token)) set({ lastError: toMessageError(cause), runStatus: 'idle' });
        }
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
          // La edición conserva las imágenes del mensaje original (el texto se reescribe).
          const keptImages: ImageDraft[] = [];
          for (const block of target.content) {
            if (block.type === 'image') {
              keptImages.push({ id: block.imageId, name: block.name, mime: block.mime, dataUrl: block.dataUrl });
            }
          }
          await startTurn(content, token, keptImages);
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
        const token = ++researchToggleSeq;
        if (enabled) {
          const settings = await services.settings.load().catch(() => null);
          if (token !== researchToggleSeq) return;
          if (settings === null || !settings.tools.webSearchEnabled) return;
        }
        set({ researchMode: enabled });
        const conversationId = get().conversationId;
        if (conversationId === null) return;
        try {
          const updated = await repo.update(conversationId, { researchMode: enabled });
          if (token === researchToggleSeq) publishConversation?.(updated);
        } catch {
          // Persistencia best-effort: el estado local ya refleja el toggle.
        }
      },

      async setLegalCase(caseId) {
        const token = ++legalToggleSeq;
        // B19: un id no-nulo se valida contra el repo cuando el servicio existe.
        // Decisión documentada: si el caso no existe (o la lectura falla), NO se
        // setea el vínculo —un modo legal fantasma (scaffold + tools sin brief)
        // es peor que un error visible— y el motivo queda en `lastError`.
        if (caseId !== null) {
          const cases = services.legalCases;
          if (cases !== undefined) {
            const existing = await cases.get(caseId).catch(() => null);
            if (token !== legalToggleSeq) return;
            if (existing === null) {
              set({
                lastError: {
                  code: 'invalid_request',
                  message: 'The legal case does not exist.',
                  retryable: false,
                },
              });
              return;
            }
          } else if (token !== legalToggleSeq) return;
        }
        set({ legalCaseId: caseId });
        const conversationId = get().conversationId;
        if (caseId === null && conversationId !== null) {
          // Higiene de memoria: al desvincular se descarta el mapping asociado.
          set((state) => {
            if (state.redactionMappings[conversationId] === undefined) return state;
            const redactionMappings = { ...state.redactionMappings };
            delete redactionMappings[conversationId];
            return { redactionMappings };
          });
        }
        if (conversationId === null) return;
        try {
          const updated = await repo.update(conversationId, { legalCaseId: caseId });
          if (token === legalToggleSeq) publishConversation?.(updated);
        } catch {
          // Persistencia best-effort: el estado local ya refleja el vínculo.
        }
      },

      async setLegalRole(role) {
        set({ legalRole: role });
        const conversationId = get().conversationId;
        if (conversationId === null) return;
        try {
          const updated = await repo.update(conversationId, { legalRole: role });
          publishConversation?.(updated);
        } catch {
          // Persistencia best-effort: el estado local ya refleja el rol.
        }
      },

      async setModel(providerId, modelId) {
        const conversationId = get().conversationId;
        if (conversationId !== null) {
          try {
            const updated = await repo.update(conversationId, { providerId, modelId });
            publishConversation?.(updated);
          } catch {
            // Persistencia best-effort: la selección sigue visible en el selector.
          }
        }
        // El último modelo por proveedor alimenta chats nuevos y conversaciones sin target.
        try {
          const settings = await services.settings.load();
          await services.settings.save({
            ...settings,
            activeProviderId: conversationId === null ? providerId : settings.activeProviderId,
            lastModelByProvider: { ...settings.lastModelByProvider, [providerId]: modelId },
            updatedAt: clock(),
          });
        } catch {
          // Sin settings persistidos el turno usa el target de la conversación.
        }
      },
    };
  });
}

export interface ModelTarget {
  providerId: string;
  modelId: string;
}

/**
 * Resuelve proveedor/modelo efectivos con la precedencia canónica:
 * conversación → proveedor activo → primer proveedor; y
 * modelo de la conversación → último usado → default del proveedor → primer modelo.
 * Compartido por el run del agente y por el selector de modelo del chat.
 */
export function resolveModelTarget(
  conversation: Pick<Conversation, 'providerId' | 'modelId'> | null,
  settings: Pick<AppSettings, 'activeProviderId' | 'lastModelByProvider'>,
  providers: readonly ProviderConfig[],
): ModelTarget | null {
  const provider =
    (conversation?.providerId == null
      ? undefined
      : providers.find((entry) => entry.id === conversation.providerId)) ??
    (settings.activeProviderId === null
      ? undefined
      : providers.find((entry) => entry.id === settings.activeProviderId)) ??
    providers[0];
  if (provider === undefined) return null;

  const modelId =
    (conversation?.providerId === provider.id ? conversation.modelId : null) ??
    settings.lastModelByProvider[provider.id] ??
    provider.defaultModelId ??
    provider.models[0]?.id ??
    null;
  if (modelId === null) return null;

  return { providerId: provider.id, modelId };
}

function resolveProviderTarget(
  conversation: Conversation,
  settings: AppSettings,
  providers: readonly ProviderConfig[],
): ResolvedTarget | null {
  const target = resolveModelTarget(conversation, settings, providers);
  if (target === null) return null;

  const provider = providers.find((entry) => entry.id === target.providerId);
  if (provider === undefined) return null;

  const model = provider.models.find((entry) => entry.id === target.modelId);
  return model === undefined ? { provider, modelId: target.modelId } : { provider, modelId: target.modelId, model };
}

/**
 * Skills guardadas para este turno. Best-effort: sin repo, sin IndexedDB o con
 * cualquier fallo la lista queda vacía y el turno sigue como modo general.
 */
async function loadSkills(services: AppServices): Promise<Skill[]> {
  const repo = services.skills;
  if (repo === undefined) return [];
  try {
    return await repo.list();
  } catch {
    return [];
  }
}

function composeSystemPrompt(
  conversation: Conversation,
  settings: AppSettings,
  now: number,
  webResearchMode: boolean,
  legalMode: boolean,
  skills: readonly Skill[] = [],
): string {
  const override = conversation.systemPromptOverride;
  const persona = (override !== null && override.trim() !== '' ? override : settings.chat.systemPrompt).trim();
  const scaffold = buildSystemPrompt({
    researchMode: webResearchMode,
    now,
    locale: settings.locale,
    skills: skills.map((skill) => ({ name: skill.name, description: skill.description })),
  });
  const circuitRole = legalMode === false ? null : (conversation.legalRole ?? null);
  if (circuitRole !== null) {
    const circuit = buildLegalCircuitSystemPrompt({
      role: circuitRole,
      locale: settings.locale,
      today: new Date(now).toISOString(),
    });
    const combined = [scaffold, circuit].filter((part) => part !== '').join('\n\n');
    return persona === '' ? combined : `${persona}\n\n${combined}`;
  }
  // El scaffold legal se agrega sólo en modo legal sin rol; mismos inputs ⇒ mismo string.
  const legal =
    legalMode === false
      ? ''
      : buildLegalSystemPrompt({
          locale: settings.locale,
          perspectives: settings.legal.perspectives,
          today: new Date(now).toISOString(),
        });
  const combined = [scaffold, legal].filter((part) => part !== '').join('\n\n');
  return persona === '' ? combined : `${persona}\n\n${combined}`;
}

/** Consulta de recuperación: título del caso + texto del usuario (sin PII extra). */
function composeLegalQuery(userMessage: ChatMessage, caseTitle: string): string {
  const text = messagePlainText(userMessage).trim();
  const title = caseTitle.trim();
  if (title === '' || text === '') return title !== '' ? title : text;
  return `${title}\n${text}`;
}

/** Acota cada pasaje a `maxPassageChars` (copia; la provisión original no se muta). */
function truncateLegalPassage(passage: LegalPassage, maxPassageChars: number): LegalPassage {
  if (!Number.isFinite(maxPassageChars) || maxPassageChars <= 0) return passage;
  const limit = Math.max(0, Math.floor(maxPassageChars));
  const text = passage.provision.text;
  const truncated = truncateText(text, limit);
  if (truncated === text) return passage;
  return { ...passage, provision: { ...passage.provision, text: truncated } };
}

/**
 * Capa el brief a `min(maxBriefTokens, 25% de la ventana)` con marcador
 * `[brief truncado]`; la reserva del wire la calcula `runAgent` desde el
 * sufijo (este cap sólo acota el contenido).
 */
function capBriefToBudget(brief: string, maxBriefTokens: number, contextWindow?: number): string {
  const cap = Number.isFinite(maxBriefTokens) && maxBriefTokens > 0 ? Math.floor(maxBriefTokens) : 0;
  if (cap <= 0) return brief;
  let allowed = cap;
  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    allowed = Math.min(allowed, Math.floor(contextWindow * 0.25));
  }
  if (allowed <= 0 || estimateLegalTokens(brief) <= allowed) return brief;
  return `${truncateText(brief, allowed * 3)}\n[brief truncado]`;
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
      case 'image':
        return { type: 'image', imageId: block.imageId, name: block.name, mime: block.mime, dataUrl: block.dataUrl };
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

/** Argumentos de una tool formateados para el diálogo de aprobación. */
function describeArguments(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
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
