import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { chatHref, navigate, SETTINGS_HREF, useRoute } from '@/app/routing';
import { useServices } from '@/app/services';
import type { ChatMessage } from '@/domain/types/chat';
import { buildAttackerSeed, buildFinalSeed, buildJudgeSeed } from '@/domain/legal/circuit';
import type { LegalCase, LegalCircuitRole, LegalIndex } from '@/domain/types/legal';
import { LEGAL_CIRCUIT_ROLES } from '@/domain/types/legal';
import { useConversationsStore, useConversationsStoreApi } from '@/features/conversations/state/conversationsStore';
import { CaseStoreProvider, createCaseStore, useCaseStore, useCaseStoreApi } from '@/features/legal/state/caseStore';
import type { CaseStore } from '@/features/legal/state/caseStore';
import { CitationGuardProvider } from '@/features/legal/state/CitationGuardContext';
import { ResearchPanel } from '@/features/research/ResearchPanel';
import { researchWarningText } from '@/features/research/messages';
import { researchWarning } from '@/features/research/selectors';
import { useResearchSettings } from '@/features/research/useResearchSettings';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { ChevronDown, PanelRightOpen, Scale } from '@/shared/icons';
import { Badge, IconButton, useToast } from '@/shared/ui';

import { CircuitDialog, ROLE_LABEL_KEYS } from './components/CircuitDialog';
import type { CircuitStage } from './components/CircuitDialog';
import { Composer } from './components/Composer';
import { messageText } from './components/MessageList';
import type { ComposerHandle, LegalRedactionCounts } from './components/Composer';
import { EmptyChat } from './components/EmptyChat';
import { ErrorBanner } from './components/ErrorBanner';
import { MessageList } from './components/MessageList';
import { ModelPicker } from './components/ModelPicker';
import { CaseLinkDialog } from './components/CaseLinkDialog';
import { ModesMenu } from './components/ModesMenu';
import { ConversationUsage } from './components/MessageUsage';
import { StreamingIndicator } from './components/StreamingIndicator';
import { ToolApprovalDialog } from './components/ToolApprovalDialog';
import { useAutoScroll } from './hooks/useAutoScroll';
import { useChatController } from './hooks/useChatController';
import { useChatShortcuts } from './hooks/useChatShortcuts';
import { useProviderCatalog } from './hooks/useProviderCatalog';
import { ChatStoreProvider, createChatStore, resolveModelTarget, useChatStore } from './state/chatStore';
import type { ModelTarget } from './state/chatStore';

/** Página de chat: une el store de T11 con el router, markdown y el composer. */
export function ChatPage() {
  const services = useServices();
  const conversationsStore = useConversationsStoreApi();
  const [store] = useState(() =>
    createChatStore({
      services,
      conversations: services.conversations,
      autoTitle: true,
      compaction: true,
      onConversationUpdated: (conversation) => conversationsStore.getState().merge(conversation),
    }),
  );

  // Al desmontar (o cambiar de ruta) se aborta el run en vuelo para no dejar streams huérfanos.
  useEffect(() => () => store.getState().stop(), [store]);

  // Store de expedientes memoizado desde los servicios (G1). Si faltan los
  // servicios legales no se monta provider: el diálogo, el título y el
  // consentimiento ya degradan a sesión/sin tienda en vez de romper. No se
  // pisa un provider externo: sin `legalCases` en servicios no hay provider
  // propio y un `CaseStoreProvider` de arriba (tests) sigue vigente.
  const [caseStore] = useState(() => {
    const cases = services.legalCases;
    if (cases === undefined) return null;
    return createCaseStore({ cases, conversations: services.conversations });
  });

  return (
    <ChatStoreProvider store={store}>
      {caseStore === null ? (
        <ChatPageContent />
      ) : (
        <CaseStoreProvider store={caseStore}>
          <ChatPageContent />
        </CaseStoreProvider>
      )}
    </ChatStoreProvider>
  );
}

/** Texto del consentimiento persistido en `LegalCase.consent` (fijo, en español). */
const LEGAL_CONSENT_TEXT = 'Acepto que el texto anonimizado del expediente salga del dispositivo para esta consulta.';

/** Conteos vacíos (sin mapping): el Composer muestra el preview en cero. */
const LEGAL_EMPTY_COUNTS: LegalRedactionCounts = {};

/** Conteos por categoría para el Composer, derivados del mapping en memoria. */
function useRedactedCounts(): LegalRedactionCounts {
  const mapping = useChatStore((state) => state.getRedactionMapping(state.conversationId));
  return useMemo(() => {
    if (mapping === null) return LEGAL_EMPTY_COUNTS;
    const counts: LegalRedactionCounts = {};
    for (const entry of mapping.entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    return counts;
  }, [mapping]);
}

function ChatPageContent() {
  const t = useT();
  const route = useRoute();
  const conversationId = route.name === 'chat' ? route.conversationId : null;

  const load = useChatStore((state) => state.load);
  const storeConversationId = useChatStore((state) => state.conversationId);
  const researchMode = useChatStore((state) => state.researchMode);
  const setResearchMode = useChatStore((state) => state.setResearchMode);
  const legalCaseId = useChatStore((state) => state.legalCaseId);
  const setLegalCase = useChatStore((state) => state.setLegalCase);
  const legalRole = useChatStore((state) => state.legalRole);
  const setLegalRole = useChatStore((state) => state.setLegalRole);
  const setModel = useChatStore((state) => state.setModel);
  const redactedCounts = useRedactedCounts();
  const controller = useChatController();
  const services = useServices();
  const providers = useProviderCatalog();
  const { settings: appSettings, keyPresence, browser, setResearchPanelVisible } = useResearchSettings(services);
  // Selección optimista del selector de modelo: se limpia al cambiar de conversación.
  const [pendingTarget, setPendingTarget] = useState<ModelTarget | null>(null);

  // Overlay de arrastre de archivos sobre mensajes + footer: sólo reacciona a
  // drags que traen archivos (`Files`); el drop lo procesa el Composer vía ref.
  const [dragActive, setDragActive] = useState(false);
  const composerRef = useRef<ComposerHandle | null>(null);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragActive(true);
  };
  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    // Sin preventDefault el navegador no permite soltar.
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
  };
  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    // Al entrar en un hijo el navegador dispara dragleave en el contenedor:
    // si el destino sigue adentro, el overlay permanece.
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragActive(false);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragActive(false);
    // Un drop dentro del formulario lo procesa el propio Composer.
    const target = event.target;
    if (target instanceof Element && target.closest('[data-testid="chat-composer"]') !== null) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) void composerRef.current?.addFiles(files);
  };

  const warning =
    appSettings === null
      ? null
      : researchWarning({ search: appSettings.search, proxy: appSettings.proxy, keys: keyPresence, browser });
  const researchHint = warning === null ? null : researchWarningText(t, warning);
  const researchDisabled = appSettings === null || !appSettings.tools.webSearchEnabled;

  const items = useConversationsStore((state) => state.items);
  const loadConversations = useConversationsStore((state) => state.load);
  const createConversation = useConversationsStore((state) => state.create);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (conversationId === null || conversationId === storeConversationId) return;
    void load(conversationId);
  }, [conversationId, storeConversationId, load]);

  // Si el primer envío crea la conversación, sincroniza la URL y refresca el historial.
  useEffect(() => {
    if (conversationId !== null || storeConversationId === null) return;
    navigate(chatHref(storeConversationId));
    void loadConversations();
  }, [conversationId, storeConversationId, loadConversations]);

  // Título, preview y modelo cambian dentro del turno: refresca la lista al volver a idle.
  const previousRunStatus = useRef(controller.runStatus);
  useEffect(() => {
    const finished = previousRunStatus.current !== 'idle' && controller.runStatus === 'idle';
    previousRunStatus.current = controller.runStatus;
    if (finished) void loadConversations();
  }, [controller.runStatus, loadConversations]);

  // Handlers estables para `MessageList`: con `MessageItem` memoizado, una
  // referencia nueva por render invalidaría el memo y re-parsearía todo.
  // Ojo: `controller` es un objeto nuevo por render; las deps son las acciones
  // del store, que sí son estables.
  const handleRegenerate = useCallback(
    (messageId: string): void => {
      void controller.regenerate(messageId);
    },
    [controller.regenerate],
  );
  const handleContinue = useCallback(
    (messageId: string): void => {
      void controller.continueGeneration(messageId);
    },
    [controller.continueGeneration],
  );
  const handleEdit = useCallback(
    (messageId: string, text: string): void => {
      void controller.editUserMessage(messageId, text);
    },
    [controller.editUserMessage],
  );
  const handleDelete = useCallback(
    (messageId: string): void => {
      void controller.deleteMessage(messageId).then(() => loadConversations());
    },
    [controller.deleteMessage, loadConversations],
  );

  const conversation = useMemo(
    () => items.find((entry) => entry.id === conversationId),
    [items, conversationId],
  );

  const lastMessage = controller.messages[controller.messages.length - 1];
  const scrollRevision = `${controller.messages.length}:${lastMessage?.updatedAt ?? 0}:${controller.runStatus}`;
  const { scrollRef, isAtBottom, onScroll, scrollToBottom } = useAutoScroll<HTMLDivElement>(scrollRevision, {
    enabled: controller.messages.length > 0,
  });

  const modelId = conversation?.modelId ?? findLastModelId(controller.messages);
  const busy = controller.runStatus !== 'idle';
  const researchPanelVisible = appSettings?.ui.researchPanelVisible ?? true;
  // Diálogo de vínculo legal (T27) y título del expediente para el resumen del menú.
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const linkedCase = useLinkedCase(legalCaseId);
  const linkedCaseTitle = linkedCase?.title ?? null;
  const caseApi = useOptionalCaseApi();
  const legalActive = legalCaseId !== null;

  // Índice del corpus para el guard de citas (G1): se resuelve al entrar en
  // modo legal. Mientras carga o si no hay corpus NO se monta el provider
  // (guard neutro = identidad); el fallo degrada en silencio sin romper el chat.
  const [legalIndex, setLegalIndex] = useState<LegalIndex | null>(null);
  useEffect(() => {
    const corpus = services.legalCorpus;
    if (!legalActive || corpus === undefined) {
      setLegalIndex(null);
      return;
    }
    let alive = true;
    void corpus.ensureIndex().then(
      (index) => {
        if (alive) setLegalIndex(index);
      },
      () => {
        if (alive) setLegalIndex(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [legalActive, services]);

  // Consentimiento del expediente (G1): `LegalCase.consent` existe, así que se
  // persiste vía `caseStore.update`; sin tienda o sin caso el Composer lo vale
  // por sesión (su `sessionConsent` interno) y acá no se hace nada.
  const consentAccepted = linkedCase?.consent !== undefined;
  const handleConsentChange = (accepted: boolean): void => {
    if (caseApi === null || legalCaseId === null) return;
    const patch: Partial<Pick<LegalCase, 'consent'>> = accepted
      ? { consent: { at: Date.now(), text: LEGAL_CONSENT_TEXT, scope: 'sensitive-data' } }
      : { consent: undefined };
    void caseApi.getState().update(legalCaseId, patch);
  };
  // Workspace configurado por onboarding o Ajustes; si no, el menú/diálogo ofrecen configurarlo.
  const legalConfigured =
    appSettings?.legal.setupCompleted === true || appSettings?.legal.enabled === true;
  const { push } = useToast();
  // Encender “Modo abogado” activa directo: con casos disponibles reutiliza el
  // último expediente; si no hay ninguno, crea uno mínimo y avisa. Sin tienda
  // de expedientes (servicios reducidos) degrada al diálogo de vínculo de siempre.
  const handleActivateLegal = (): void => {
    const api = caseApi;
    if (api === null) {
      setCaseDialogOpen(true);
      return;
    }
    void (async () => {
      // Reutiliza el expediente activo más reciente si ya hay alguno; si no,
      // crea uno mínimo para que el modo quede usable al instante.
      await api.getState().list();
      const cases = api.getState().cases;
      const linked = cases.find((entry) => entry.status === 'active') ?? cases[0] ?? null;
      if (linked !== null) {
        await setLegalCase(linked.id);
        return;
      }
      const created = await api.getState().create({
        title: t('modes.defaultCaseTitle'),
        jurisdiction: appSettings?.legal.defaultJurisdiction ?? 'national',
        court: '',
        matter: 'civil',
        clientRole: 'plaintiff',
      });
      if (created === null) {
        setCaseDialogOpen(true);
        return;
      }
      await setLegalCase(created.id);
      push({ title: t('modes.legalActivated'), variant: 'success' });
    })();
  };

  // Circuito adversarial del expediente (redactor → atacante → juez → síntesis):
  // etapas existentes y derivación con semilla. El auto-envío lo consume `load()` del
  // store tras hidratar (sin carreras con su `fetch`).
  const [circuitOpen, setCircuitOpen] = useState(false);
  const setPendingSeed = useChatStore((state) => state.setPendingSeed);

  const circuitStages: CircuitStage[] = useMemo(() => {
    if (legalCaseId === null) return [];
    return LEGAL_CIRCUIT_ROLES.map((role) => {
      const match = items.find((entry) => entry.legalCaseId === legalCaseId && entry.legalRole === role);
      if (match === undefined) return { role, conversationId: null, title: null };
      return { role, conversationId: match.id, title: match.title };
    });
  }, [items, legalCaseId]);

  const currentDoc = useMemo(() => lastAssistantMarkdown(controller.messages), [controller.messages]);
  const canDeriveAtacante =
    legalCaseId !== null && (legalRole === null || legalRole === 'redactor') && currentDoc.trim() !== '';
  /** Una etapa está lista para derivar cuando tiene ida y vuelta (semilla + respuesta). */
  const stageMessageCount = (stageRole: LegalCircuitRole): number => {
    if (legalCaseId === null) return 0;
    const match = items.find((entry) => entry.legalCaseId === legalCaseId && entry.legalRole === stageRole);
    return match?.messageCount ?? 0;
  };
  const attackerStageId = circuitStages.find((stage) => stage.role === 'atacante')?.conversationId ?? null;
  const canDeriveJuez = legalCaseId !== null && attackerStageId !== null && stageMessageCount('atacante') >= 2;
  const judgeStageId = circuitStages.find((stage) => stage.role === 'juez')?.conversationId ?? null;
  const canDeriveSintesis = legalCaseId !== null && judgeStageId !== null && stageMessageCount('juez') >= 2;

  const deriveCircuitRole = (role: LegalCircuitRole): void => {
    if (legalCaseId === null || busy) return;
    const caseId = legalCaseId;
    const caseTitle = linkedCase?.title?.trim() !== '' ? (linkedCase?.title.trim() ?? '') : '';
    void (async () => {
      let seed: string | null = null;
      if (role === 'atacante') {
        const doc = lastAssistantMarkdown(controller.messages);
        if (doc.trim() === '') return;
        if (legalRole === null) await setLegalRole('redactor');
        seed = buildAttackerSeed(doc);
      } else if (role === 'juez') {
        const [doc, attack] = await Promise.all([stageDoc('redactor'), stageDoc('atacante')]);
        if (doc.trim() === '' || attack.trim() === '') return;
        seed = buildJudgeSeed(doc, attack);
      } else if (role === 'sintesis') {
        const [doc, attack, verdict] = await Promise.all([
          stageDoc('redactor'),
          stageDoc('atacante'),
          stageDoc('juez'),
        ]);
        if (doc.trim() === '' || attack.trim() === '' || verdict.trim() === '') return;
        seed = buildFinalSeed(doc, attack, verdict);
      }
      const title = caseTitle === '' ? t('chat.circuit') : `${t(ROLE_LABEL_KEYS[role])} — ${caseTitle}`;
      const created = await createConversation({ title, legalCaseId: caseId, legalRole: role });
      if (created === null) return;
      setCircuitOpen(false);
      if (seed !== null) setPendingSeed({ conversationId: created.id, seed });
      navigate(chatHref(created.id));
    })();
  };

  async function stageDoc(stageRole: LegalCircuitRole): Promise<string> {
    const stage = circuitStages.find((entry) => entry.role === stageRole);
    if (stage?.conversationId == null) return '';
    try {
      const messages = await services.conversations.listMessages(stage.conversationId);
      return lastAssistantMarkdown(messages);
    } catch {
      return '';
    }
  }

  useEffect(() => {
    setPendingTarget(null);
  }, [conversationId]);

  const modelTarget = useMemo(
    () => pendingTarget ?? (appSettings === null ? null : resolveModelTarget(conversation ?? null, appSettings, providers)),
    [pendingTarget, appSettings, conversation, providers],
  );

  useChatShortcuts({ running: busy, onStop: controller.stop });

  const page = (
    <section
      data-testid="chat-page"
      data-conversation-id={conversationId ?? ''}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-1.5">
        <h2 className="hidden min-w-0 flex-1 truncate text-sm font-medium text-text sm:block">
          {resolveTitle(conversation?.title, conversationId, t)}
        </h2>
        <div className="min-w-0 flex-1 sm:hidden" />
        <ModesMenu
          researchMode={researchMode}
          legalCaseId={legalCaseId}
          legalCaseTitle={linkedCaseTitle}
          researchDisabled={researchDisabled}
          legalConfigured={legalConfigured}
          onToggleResearch={(enabled) => {
            void setResearchMode(enabled);
          }}
          onToggleLegal={(enabled) => {
            // Apagar desvincula; encender lo resuelve `handleActivateLegal`.
            if (!enabled) void setLegalCase(null);
          }}
          onActivateLegal={handleActivateLegal}
          onConfigureLegal={() => navigate(SETTINGS_HREF)}
          onOpenCase={
            legalCaseId === null ? undefined : () => navigate(`#/legal/${legalCaseId}`)
          }
          className="min-w-0 flex-1 sm:flex-none"
        />
        {researchMode && !researchPanelVisible ? (
          <IconButton
            data-testid="research-panel-show"
            label={t('research.showPanel')}
            size="sm"
            icon={<PanelRightOpen aria-hidden="true" className="size-4" />}
            onClick={() => setResearchPanelVisible(true)}
            className="shrink-0"
          />
        ) : null}
        {legalCaseId !== null ? (
          <IconButton
            data-testid="circuit-open"
            label={t('chat.circuit')}
            size="sm"
            icon={<Scale aria-hidden="true" className="size-4" />}
            onClick={() => setCircuitOpen(true)}
            className="shrink-0"
          />
        ) : null}
        {modelTarget !== null ? (
          <ModelPicker
            providers={providers}
            providerId={modelTarget.providerId}
            modelId={modelTarget.modelId}
            label={t('chat.selectModel')}
            placeholder={t('chat.selectModel')}
            onSelect={(nextProviderId, nextModelId) => {
              setPendingTarget({ providerId: nextProviderId, modelId: nextModelId });
              void setModel(nextProviderId, nextModelId);
            }}
            className="w-28 shrink-0 sm:w-44"
          />
        ) : modelId !== null ? (
          <Badge
            variant="neutral"
            title={t('chat.modelLabel', { model: modelId })}
            className="hidden max-w-56 truncate font-mono sm:inline-flex"
          >
            {modelId}
          </Badge>
        ) : null}
        {conversation?.summary !== undefined && conversation.summary.trim() !== '' ? (
          <Badge variant="neutral" title={t('chat.compacted')} className="hidden sm:inline-flex">
            {t('chat.compacted')}
          </Badge>
        ) : null}
        <ConversationUsage messages={controller.messages} />
      </header>

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-6">
              <div className="mx-auto w-full max-w-3xl space-y-4">
                {controller.messages.length === 0 ? (
                  <EmptyChat onSuggestion={(text) => void controller.send(text)} />
                ) : (
                  <MessageList
                    messages={controller.messages}
                    runStatus={controller.runStatus}
                    legalMode={legalActive}
                    onRegenerate={handleRegenerate}
                    onContinue={handleContinue}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                )}
                {busy ? <StreamingIndicator /> : null}
              </div>
            </div>
            {isAtBottom ? null : (
              <button
                type="button"
                data-testid="chat-scroll-to-bottom"
                aria-label={t('chat.scrollToBottom')}
                title={t('chat.scrollToBottom')}
                onClick={() => scrollToBottom('smooth')}
                className="hit-expand absolute bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-surface text-text shadow-sm transition-all duration-150 hover:bg-surface-subtle active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <ChevronDown aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
          {researchMode && researchPanelVisible ? (
            <ResearchPanel
              steps={controller.liveSteps}
              messages={controller.messages}
              settings={appSettings}
              keyPresence={keyPresence}
              browser={browser}
              onHide={() => setResearchPanelVisible(false)}
              className="h-[42dvh] max-h-96 min-h-80 shrink-0 border-t border-border lg:h-auto lg:max-h-none lg:w-80 lg:border-l lg:border-t-0"
            />
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-border px-3 py-3">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {controller.lastError !== null ? (
              <ErrorBanner error={controller.lastError} onRetry={() => void controller.retryLast()} />
            ) : null}
            <Composer
              ref={composerRef}
              status={controller.runStatus}
              onSend={(text, images) => void controller.send(text, images)}
              onStop={controller.stop}
              research={{
                enabled: researchMode,
                disabled: researchDisabled,
                hint: researchMode ? researchHint : null,
                onToggle: (enabled) => {
                  void setResearchMode(enabled);
                },
              }}
              legal={
                legalCaseId === null
                  ? undefined
                  : {
                      // Expediente vinculado: preview de privacidad + gate de
                      // consentimiento. Los conteos salen del mapping de
                      // redacción en memoria (vacío hasta el primer turno).
                      redactionActive: true,
                      redactedCounts,
                      consentAccepted,
                      onConsentChange: handleConsentChange,
                    }
              }
            />
          </div>
        </footer>
        {dragActive ? (
          <div
            data-testid="chat-drop-overlay"
            role="status"
            className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary-soft/80 px-4 text-center"
          >
            <p className="text-sm font-medium text-primary">{t('chat.dropOverlay')}</p>
          </div>
        ) : null}
      </div>
      {controller.pendingApproval !== null ? (
        <ToolApprovalDialog
          request={controller.pendingApproval}
          onApprove={controller.approveTool}
          onDeny={controller.denyTool}
        />
      ) : null}
      <CircuitDialog
        open={circuitOpen}
        caseTitle={linkedCase?.title ?? null}
        currentConversationId={conversationId}
        stages={circuitStages}
        canDeriveAtacante={canDeriveAtacante}
        canDeriveJuez={canDeriveJuez}
        canDeriveSintesis={canDeriveSintesis}
        busy={busy}
        onDerive={(role) => deriveCircuitRole(role)}
        onOpen={(id) => {
          setCircuitOpen(false);
          navigate(chatHref(id));
        }}
        onClose={() => setCircuitOpen(false)}
      />
      <CaseLinkDialog
        open={caseDialogOpen}
        linkedCaseId={legalCaseId}
        legalConfigured={legalConfigured}
        defaultJurisdiction={appSettings?.legal.defaultJurisdiction ?? 'national'}
        onLink={(caseId) => {
          void setLegalCase(caseId);
        }}
        onConfigureLegal={() => {
          setCaseDialogOpen(false);
          navigate(SETTINGS_HREF);
        }}
        onClose={() => setCaseDialogOpen(false)}
      />
    </section>
  );

  // Guard de citas (G1): sólo con índice resuelto se monta el provider; sin
  // índice el guard es neutro y el render queda idéntico al modo general.
  if (legalIndex === null) return page;
  return <CitationGuardProvider index={legalIndex}>{page}</CitationGuardProvider>;
}

/** Detecta si un arrastre trae archivos (los de texto/HTML se ignoran). */
function hasDraggedFiles(event: DragEvent<Element>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function resolveTitle(title: string | undefined, conversationId: string | null, t: Translate): string {
  if (title !== undefined && title.trim() !== '') return title;
  return conversationId === null ? t('conversations.new') : t('conversations.untitled');
}

/** Último texto del asistente (markdown) para sembrar el chat derivado; vacío si no hay. */
function lastAssistantMarkdown(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== 'assistant') continue;
    const text = messageText(message).trim();
    if (text !== '') return text;
  }
  return '';
}

/**
 * Expediente vinculado (o `null`). El provider del caseStore es opcional sobre
 * el chat: sin provider montado degrada a `null` en vez de romper la página
 * (mismo patrón que `CaseLinkDialog.useOptionalCaseStore`).
 */
function useLinkedCase(caseId: string | null): LegalCase | null {
  try {
    return useCaseStore((state) =>
      caseId === null ? null : (state.cases.find((entry) => entry.id === caseId) ?? null),
    );
  } catch {
    return null;
  }
}

/** API del caseStore o `null` sin provider (el consentimiento vale por sesión). */
function useOptionalCaseApi(): CaseStore | null {
  try {
    return useCaseStoreApi();
  } catch {
    return null;
  }
}

function findLastModelId(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const modelId = messages[index]?.modelId;
    if (modelId !== undefined) return modelId;
  }
  return null;
}
