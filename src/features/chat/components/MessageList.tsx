import { memo, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage, MessageContent, ToolResult } from '@/domain/types/chat';
import { splitAttachmentBlocks } from '@/domain/chat/attachments';
import { deanonymize } from '@/domain/legal/redaction';
import type { RedactionMapping } from '@/domain/legal/redaction';
import { extractHtmlReport, pickDynamicTheme } from '@/domain/visualReport/reportThemes';
import { useCitationGuard } from '@/features/legal/state/CitationGuardContext';
import { useT } from '@/i18n/useT';
import { Sparkles } from '@/shared/icons';
import { Markdown } from '@/shared/markdown/Markdown';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import { useChatStore } from '../state/chatStore';
import type { ChatRunStatus } from '../state/chatStore';
import { MessageActions, MessageEditForm } from './MessageActions';
import { MessageUsage } from './MessageUsage';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard } from './ToolCallCard';
import { VisualReportDialog } from './VisualReportDialog';

export type DisplayBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; result: ToolResult | undefined }
  | { type: 'image'; imageId: string; name: string; dataUrl: string };

/** Agrupa `tool-call` con su `tool-result` (en orden) sin perder bloques huérfanos. */
export function buildDisplayBlocks(content: readonly MessageContent[]): DisplayBlock[] {
  const results = new Map<string, ToolResult>();
  for (const block of content) {
    if (block.type === 'tool-result') results.set(block.toolCallId, block.result);
  }

  const consumedCalls = new Set<string>();
  const display: DisplayBlock[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        display.push({ type: 'text', text: block.text });
        break;
      case 'reasoning':
        display.push({ type: 'reasoning', text: block.text });
        break;
      case 'tool-call':
        consumedCalls.add(block.toolCall.id);
        display.push({ type: 'tool', name: block.toolCall.name, result: results.get(block.toolCall.id) });
        break;
      case 'tool-result':
        if (!consumedCalls.has(block.toolCallId)) {
          display.push({ type: 'tool', name: block.toolName, result: block.result });
        }
        break;
      case 'image':
        display.push({ type: 'image', imageId: block.imageId, name: block.name, dataUrl: block.dataUrl });
        break;
    }
  }
  return display;
}

/** Texto plano de un mensaje (bloques `text` unidos); usado para copiar y editar. */
export function messageText(message: ChatMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n\n');
}

export interface MessageListProps {
  messages: ChatMessage[];
  runStatus: ChatRunStatus;
  onRegenerate: (assistantMessageId: string) => void;
  /** Opcional: reanudar respuestas truncadas. Sin él, no se muestra el botón. */
  onContinue?: (assistantMessageId: string) => void;
  onEdit: (userMessageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  /**
   * Modo legal (G1): con `true` el render aplica `guard.mark` + `deanonymize`
   * con el mapping de redacción; con `false` (default) queda idéntico a hoy
   * (sólo el guard, neutro fuera del provider).
   */
  legalMode?: boolean;
  /** Solicitud para generar un reporte visual interactivo nuevo */
  onVisualReport?: (assistantMessageId: string) => void;
  /** Solicitud para modificar el HTML artifact / reporte interactivo */
  onRequestHtmlEdit?: (instruction: string, code: string) => void;
}

export function MessageList({
  messages,
  runStatus,
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
  legalMode = false,
  onVisualReport,
  onRequestHtmlEdit,
}: MessageListProps) {
  const busy = runStatus !== 'idle';
  const lastAssistantId = useMemo(() => findLastAssistantId(messages), [messages]);
  const streamingId = useMemo(() => findStreamingAssistantId(messages), [messages]);
  const [activeVisualReport, setActiveVisualReport] = useState<{
    id: string;
    html: string;
    title?: string;
  } | null>(null);

  const handleOpenVisualReport = useCallback((messageId: string, html: string) => {
    setActiveVisualReport({ id: messageId, html });
  }, []);

  // Si el diálogo está abierto y el mensaje continúa recibiendo tokens en streaming,
  // sincroniza el HTML en vivo para que el modal a pantalla completa también dibuje en tiempo real
  const currentVisualReportHtml = useMemo(() => {
    if (!activeVisualReport) return null;
    const msg = messages.find((m) => m.id === activeVisualReport.id);
    if (!msg) return activeVisualReport.html;
    const extracted = extractHtmlReport(messageText(msg));
    return extracted ?? activeVisualReport.html;
  }, [activeVisualReport, messages]);

  return (
    <>
      <ol data-testid="chat-message-list" className="flex flex-col gap-4">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageItem
              message={message}
              isLastAssistant={message.id === lastAssistantId}
              streaming={message.id === streamingId}
              busy={busy}
              legalMode={legalMode}
              onRegenerate={onRegenerate}
              onContinue={onContinue}
              onEdit={onEdit}
              onDelete={onDelete}
              onOpenVisualReport={handleOpenVisualReport}
              onGenerateVisualReport={onVisualReport}
              onRequestHtmlEdit={onRequestHtmlEdit}
            />
          </li>
        ))}
      </ol>
      {activeVisualReport && currentVisualReportHtml ? (
        <VisualReportDialog
          open={Boolean(activeVisualReport)}
          rawHtml={currentVisualReportHtml}
          title={activeVisualReport.title}
          initialThemeId={pickDynamicTheme(activeVisualReport.id).id}
          onRequestEdit={onRequestHtmlEdit}
          onClose={() => setActiveVisualReport(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Mapping de redacción para el `deanonymize` del modo legal, leído del
 * `chatStore` (lo guarda `buildLegalEphemeralSuffix` sólo en memoria).
 * Sin provider o sin mapping degrada a `null` (sólo guard de citas).
 * La llamada al hook es incondicional: el `try/catch` no altera el orden.
 */
function useOptionalRedactionMapping(conversationId: string): RedactionMapping | null {
  try {
    return useChatStore((state) => state.getRedactionMapping(conversationId));
  } catch {
    return null;
  }
}

/** Restaura los tokens con el mapping; sin mapping devuelve el texto tal cual. */
function deanonymizeOrSelf(text: string, mapping: RedactionMapping | null): string {
  return mapping === null ? text : deanonymize(text, mapping);
}

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  streaming: boolean;
  busy: boolean;
  legalMode: boolean;
  onRegenerate: (assistantMessageId: string) => void;
  onContinue?: (assistantMessageId: string) => void;
  onEdit: (userMessageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onOpenVisualReport?: (messageId: string, html: string) => void;
  onGenerateVisualReport?: (messageId: string) => void;
  onRequestHtmlEdit?: (instruction: string, code: string) => void;
}

function MessageItemInner({
  message,
  isLastAssistant,
  streaming,
  busy,
  legalMode,
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
  onOpenVisualReport,
  onGenerateVisualReport,
  onRequestHtmlEdit,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const guard = useCitationGuard();
  const t = useT();
  const isUser = message.role === 'user';
  // Mapping del turno (sólo memoria, nunca persistido); el render y el copiar
  // comparten este texto. Sin mapping no se restaura (sólo guard de citas).
  const mapping = useOptionalRedactionMapping(message.conversationId);
  // `rawText`/`markedText` memoizados: sin esto, cada render del padre
  // (p. ej. cada token del streaming) re-une strings y re-corre el guard en
  // TODOS los mensajes aunque su contenido no haya cambiado.
  const rawText = useMemo(() => messageText(message), [message]);
  const markedText = useMemo(() => guard.mark(rawText), [guard, rawText]);
  // El texto crudo se conserva para editar; el render y el copiar usan el
  // post-guard (con `[VERIFICAR]` visibles en contexto legal). En modo legal
  // además se restauran los valores con el mapping del turno (sin mapping
  // no se restaura). Fuera del provider el guard es identidad.
  const text = legalMode ? deanonymizeOrSelf(markedText, mapping) : markedText;  const blocks = useMemo(
    () =>
      buildDisplayBlocks(message.content).map((block) =>
        block.type === 'text'
          ? { ...block, text: legalMode ? deanonymizeOrSelf(guard.mark(block.text), mapping) : guard.mark(block.text) }
          : block,
      ),
    [message.content, guard, legalMode, mapping],
  );
  const userImages = useMemo(() => blocks.filter((block) => block.type === 'image'), [blocks]);
  // Adjuntos acoplados pero colapsados: la burbuja muestra el texto y cada
  // documento como <details> (se abre al tocar). Solo presentación.
  const userSplit = useMemo(() => (isUser ? splitAttachmentBlocks(text) : null), [isUser, text]);
  // Los contadores describen la salida del modelo; sólo se muestran en el
  // asistente y cuando hay citas (en modo general siempre son cero).
  const counts = useMemo(() => guard.counters(rawText), [guard, rawText]);
  const showCounts = !isUser && counts.verified + counts.unverified > 0;

  const handleSave = useCallback(
    (next: string): void => {
      setEditing(false);
      onEdit(message.id, next);
    },
    [message.id, onEdit],
  );
  const handleEditStart = useCallback((): void => {
    setEditing(true);
  }, []);
  const handleEditCancel = useCallback((): void => {
    setEditing(false);
  }, []);

  const htmlReport = useMemo(
    () => (!isUser && message.status === 'complete' ? extractHtmlReport(rawText) : null),
    [isUser, message.status, rawText],
  );

  const handleVisualReportClick = useCallback(
    (messageId: string) => {
      if (htmlReport !== null) {
        onOpenVisualReport?.(messageId, htmlReport);
      } else {
        onGenerateVisualReport?.(messageId);
      }
    },
    [htmlReport, onOpenVisualReport, onGenerateVisualReport],
  );

  return (
    <article
      data-testid="chat-message"
      data-role={message.role}
      data-status={message.status}
      className={cn(
        'group flex flex-col gap-1.5',
        isUser ? 'items-end' : 'items-start',
        message.status === 'complete' && 'chat-message-contained',
      )}
    >
      {isUser ? (
        editing ? (
          <div className="w-full max-w-[85%]">
            <MessageEditForm
              initialText={rawText}
              disabled={busy}
              onSubmit={handleSave}
              onCancel={handleEditCancel}
            />
          </div>
        ) : (
          <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-on-primary shadow-xs">
            {userImages.length > 0 ? (
              <ul aria-label={t('chat.attachments')} className="mb-2 flex flex-wrap gap-2">
                {userImages.map((image) => (
                  <li key={image.imageId}>
                    <img
                      src={image.dataUrl}
                      alt={image.name}
                      title={image.name}
                      className="h-20 w-20 rounded-lg object-cover"
                      loading="lazy"
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            {userSplit !== null && userSplit.text !== '' ? (
              <p className="whitespace-pre-wrap break-words leading-relaxed">{userSplit.text}</p>
            ) : null}
            {userSplit?.attachments.map((attachment) => (
              <details
                key={attachment.name}
                className="mt-1.5 max-w-full rounded-lg bg-black/15 px-2.5 py-1.5 text-xs"
              >
                <summary
                  title={attachment.name}
                  className="cursor-pointer truncate font-medium select-none"
                >
                  {attachment.name}
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto font-mono whitespace-pre-wrap break-words opacity-90">
                  {attachment.body}
                </pre>
              </details>
            ))}
          </div>
        )
      ) : (
        <div className="w-full space-y-3 px-1 py-1 text-text leading-relaxed">
          {blocks.map((block, index) =>
            renderBlock(
              block,
              index,
              blocks.length,
              streaming,
              (html) => onOpenVisualReport?.(message.id, html),
              onRequestHtmlEdit,
            ),
          )}
          {htmlReport !== null && message.status === 'complete' ? (
            <div
              data-testid="visual-report-callout"
              className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5 shadow-xs transition-all hover:border-primary/40 hover:bg-primary/10"
            >
              <div className="flex items-center gap-2.5 text-xs font-medium text-primary">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                </span>
                <div>
                  <div className="font-semibold text-text">{t('chat.viewVisualReport')}</div>
                  <div className="text-[11px] text-muted">Informe interactivo renderizado en HTML</div>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5 bg-surface text-xs font-semibold shadow-xs hover:bg-surface-subtle"
                onClick={() => onOpenVisualReport?.(message.id, htmlReport)}
              >
                <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                <span>{t('chat.viewVisualReport')}</span>
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {editing ? null : (
        <div className="opacity-90 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <MessageActions
            messageId={message.id}
            role={message.role}
            text={text}
            canRegenerate={!isUser && isLastAssistant}
            onContinue={
              onContinue !== undefined && !isUser && isLastAssistant && !busy && message.truncated === true
                ? onContinue
                : undefined
            }
            disabled={busy}
            onRegenerate={onRegenerate}
            onEditStart={handleEditStart}
            onDelete={onDelete}
            onVisualReport={
              !isUser && (htmlReport !== null || onGenerateVisualReport !== undefined)
                ? handleVisualReportClick
                : undefined
            }
            hasVisualReport={htmlReport !== null}
          />
        </div>
      )}
      {showCounts ? (
        <p
          data-testid="citation-counters"
          title={t('legalTrust.verifyHint')}
          className="text-[11px] text-muted"
        >
          {t('legalTrust.counters', { verified: counts.verified, unverified: counts.unverified })}
        </p>
      ) : null}
      {!isUser ? <MessageUsage message={message} /> : null}
    </article>
  );
}

/**
 * Item memoizado: durante el streaming sólo re-renderiza el mensaje que crece.
 * El store preserva la identidad de los mensajes intactos (`map` devuelve la
 * misma referencia) y `ChatPage` pasa callbacks estables, así que el resto de
 * la lista salta el re-parse de Markdown + highlight. Sin esto, cada token
 * re-parseaba TODA la conversación (O(historia × tokens) → pestaña colgada).
 */
const MessageItem = memo(MessageItemInner);

function renderBlock(
  block: DisplayBlock,
  index: number,
  total: number,
  streaming: boolean,
  onOpenVisualReport?: (html: string) => void,
  onRequestHtmlEdit?: (instruction: string, code: string) => void,
): ReactNode {
  const live = streaming && index === total - 1;
  switch (block.type) {
    case 'text':
      return (
        <div key={`text-${index}`} data-block="text">
          <Markdown
            streaming={live}
            onOpenVisualReport={onOpenVisualReport}
            onRequestHtmlEdit={onRequestHtmlEdit}
          >
            {block.text}
          </Markdown>
          {live ? <StreamingCursor /> : null}
        </div>
      );
    case 'reasoning':
      return <ReasoningBlock key={`reasoning-${index}`} text={block.text} />;
    case 'tool':
      return <ToolCallCard key={`tool-${index}`} name={block.name} result={block.result} />;
    case 'image':
      return (
        <figure key={`image-${index}`} data-block="image">
          <img src={block.dataUrl} alt={block.name} title={block.name} className="max-h-64 rounded-lg" loading="lazy" />
        </figure>
      );
  }
}

function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      data-testid="streaming-cursor"
      className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-text-bottom"
    />
  );
}

function findLastAssistantId(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === 'assistant') return message.id;
  }
  return null;
}

function findStreamingAssistantId(messages: readonly ChatMessage[]): string | null {
  const message = messages[messages.length - 1];
  return message !== undefined && message.role === 'assistant' && message.status === 'streaming' ? message.id : null;
}
