import { useEffect, useMemo, useRef, useState } from 'react';

import { chatHref, navigate, useRoute } from '@/app/routing';
import { useServices } from '@/app/services';
import type { ChatMessage } from '@/domain/types/chat';
import { useConversationsStore, useConversationsStoreApi } from '@/features/conversations/state/conversationsStore';
import { ResearchPanel } from '@/features/research/ResearchPanel';
import { researchWarningText } from '@/features/research/messages';
import { researchWarning } from '@/features/research/selectors';
import { useResearchSettings } from '@/features/research/useResearchSettings';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { ChevronDown } from '@/shared/icons';
import { Badge } from '@/shared/ui';

import { Composer } from './components/Composer';
import { EmptyChat } from './components/EmptyChat';
import { ErrorBanner } from './components/ErrorBanner';
import { MessageList } from './components/MessageList';
import { StreamingIndicator } from './components/StreamingIndicator';
import { useAutoScroll } from './hooks/useAutoScroll';
import { useChatController } from './hooks/useChatController';
import { ChatStoreProvider, createChatStore, useChatStore } from './state/chatStore';

/** Página de chat: une el store de T11 con el router, markdown y el composer. */
export function ChatPage() {
  const services = useServices();
  const conversationsStore = useConversationsStoreApi();
  const [store] = useState(() =>
    createChatStore({
      services,
      conversations: services.conversations,
      onConversationUpdated: (conversation) => conversationsStore.getState().merge(conversation),
    }),
  );

  // Al desmontar (o cambiar de ruta) se aborta el run en vuelo para no dejar streams huérfanos.
  useEffect(() => () => store.getState().stop(), [store]);

  return (
    <ChatStoreProvider store={store}>
      <ChatPageContent />
    </ChatStoreProvider>
  );
}

function ChatPageContent() {
  const t = useT();
  const route = useRoute();
  const conversationId = route.name === 'chat' ? route.conversationId : null;

  const load = useChatStore((state) => state.load);
  const storeConversationId = useChatStore((state) => state.conversationId);
  const researchMode = useChatStore((state) => state.researchMode);
  const setResearchMode = useChatStore((state) => state.setResearchMode);
  const controller = useChatController();
  const services = useServices();
  const { settings: appSettings, keyPresence, browser } = useResearchSettings(services);

  const warning =
    appSettings === null
      ? null
      : researchWarning({ search: appSettings.search, proxy: appSettings.proxy, keys: keyPresence, browser });
  const researchHint = warning === null ? null : researchWarningText(t, warning);
  const researchDisabled = appSettings === null || !appSettings.tools.webSearchEnabled;

  const items = useConversationsStore((state) => state.items);
  const loadConversations = useConversationsStore((state) => state.load);

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

  const conversation = useMemo(
    () => items.find((entry) => entry.id === conversationId),
    [items, conversationId],
  );

  const lastMessage = controller.messages[controller.messages.length - 1];
  const scrollRevision = `${controller.messages.length}:${lastMessage?.updatedAt ?? 0}:${controller.runStatus}`;
  const { scrollRef, isAtBottom, onScroll, scrollToBottom } = useAutoScroll<HTMLDivElement>(scrollRevision);

  const modelId = conversation?.modelId ?? findLastModelId(controller.messages);
  const busy = controller.runStatus !== 'idle';

  return (
    <section
      data-testid="chat-page"
      data-conversation-id={conversationId ?? ''}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {resolveTitle(conversation?.title, conversationId, t)}
        </h2>
        {modelId !== null ? (
          <Badge
            variant="neutral"
            title={t('chat.modelLabel', { model: modelId })}
            className="hidden max-w-56 truncate font-mono sm:inline-flex"
          >
            {modelId}
          </Badge>
        ) : null}
      </header>

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
                  onRegenerate={(messageId) => void controller.regenerate(messageId)}
                  onEdit={(messageId, text) => void controller.editUserMessage(messageId, text)}
                  onDelete={(messageId) => {
                    void controller.deleteMessage(messageId).then(() => loadConversations());
                  }}
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
              className="absolute bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-surface text-text shadow-sm transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        {researchMode ? (
          <ResearchPanel
            steps={controller.liveSteps}
            messages={controller.messages}
            settings={appSettings}
            keyPresence={keyPresence}
            browser={browser}
            className="max-h-72 shrink-0 border-t border-border lg:max-h-none lg:w-80 lg:border-l lg:border-t-0"
          />
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-border px-3 py-3">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {controller.lastError !== null ? (
            <ErrorBanner error={controller.lastError} onRetry={() => void controller.retryLast()} />
          ) : null}
          <Composer
            status={controller.runStatus}
            onSend={(text) => void controller.send(text)}
            onStop={controller.stop}
            research={{
              enabled: researchMode,
              disabled: researchDisabled,
              hint: researchMode ? researchHint : null,
              onToggle: (enabled) => {
                void setResearchMode(enabled);
              },
            }}
          />
        </div>
      </footer>
    </section>
  );
}

function resolveTitle(title: string | undefined, conversationId: string | null, t: Translate): string {
  if (title !== undefined && title.trim() !== '') return title;
  return conversationId === null ? t('conversations.new') : t('conversations.untitled');
}

function findLastModelId(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const modelId = messages[index]?.modelId;
    if (modelId !== undefined) return modelId;
  }
  return null;
}
