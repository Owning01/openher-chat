import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage, MessageContent, ToolResult } from '@/domain/types/chat';
import { deanonymize } from '@/domain/legal/redaction';
import type { RedactionMapping } from '@/domain/legal/redaction';
import { useCitationGuard } from '@/features/legal/state/CitationGuardContext';
import { useT } from '@/i18n/useT';
import { Markdown } from '@/shared/markdown/Markdown';
import { cn } from '@/shared/utils/cn';

import { useChatStore } from '../state/chatStore';
import type { ChatRunStatus } from '../state/chatStore';
import { MessageActions, MessageEditForm } from './MessageActions';
import { MessageUsage } from './MessageUsage';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCallCard } from './ToolCallCard';

export type DisplayBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; result: ToolResult | undefined };

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
}

export function MessageList({
  messages,
  runStatus,
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
  legalMode = false,
}: MessageListProps) {
  const busy = runStatus !== 'idle';
  const lastAssistantId = useMemo(() => findLastAssistantId(messages), [messages]);
  const streamingId = useMemo(() => findStreamingAssistantId(messages), [messages]);

  return (
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
          />
        </li>
      ))}
    </ol>
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
}

function MessageItem({
  message,
  isLastAssistant,
  streaming,
  busy,
  legalMode,
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const guard = useCitationGuard();
  const t = useT();
  const isUser = message.role === 'user';
  // Mapping del turno (sólo memoria, nunca persistido); el render y el copiar
  // comparten este texto. Sin mapping no se restaura (sólo guard de citas).
  const mapping = useOptionalRedactionMapping(message.conversationId);
  // El texto crudo se conserva para editar; el render y el copiar usan el
  // post-guard (con `[VERIFICAR]` visibles en contexto legal). En modo legal
  // además se restauran los valores con el mapping del turno (sin mapping
  // no se restaura). Fuera del provider el guard es identidad.
  const rawText = messageText(message);
  const markedText = guard.mark(rawText);
  const text = legalMode ? deanonymizeOrSelf(markedText, mapping) : markedText;
  const blocks = useMemo(
    () =>
      buildDisplayBlocks(message.content).map((block) =>
        block.type === 'text'
          ? { ...block, text: legalMode ? deanonymizeOrSelf(guard.mark(block.text), mapping) : guard.mark(block.text) }
          : block,
      ),
    [message.content, guard, legalMode, mapping],
  );
  // Los contadores describen la salida del modelo; sólo se muestran en el
  // asistente y cuando hay citas (en modo general siempre son cero).
  const counts = useMemo(() => guard.counters(rawText), [guard, rawText]);
  const showCounts = !isUser && counts.verified + counts.unverified > 0;

  const handleSave = (next: string): void => {
    setEditing(false);
    onEdit(message.id, next);
  };

  return (
    <article
      data-testid="chat-message"
      data-role={message.role}
      data-status={message.status}
      className={cn('group flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}
    >
      {isUser ? (
        editing ? (
          <div className="w-full max-w-[85%]">
            <MessageEditForm
              initialText={rawText}
              disabled={busy}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-on-primary">
            <p className="whitespace-pre-wrap break-words">{text}</p>
          </div>
        )
      ) : (
        <div className="w-full space-y-2 rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3">
          {blocks.map((block, index) => renderBlock(block, index, blocks.length, streaming))}
        </div>
      )}
      {editing ? null : (
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
          onEditStart={() => setEditing(true)}
          onDelete={onDelete}
        />
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

function renderBlock(block: DisplayBlock, index: number, total: number, streaming: boolean): ReactNode {
  switch (block.type) {
    case 'text':
      return (
        <div key={`text-${index}`} data-block="text">
          <Markdown>{block.text}</Markdown>
          {streaming && index === total - 1 ? <StreamingCursor /> : null}
        </div>
      );
    case 'reasoning':
      return <ReasoningBlock key={`reasoning-${index}`} text={block.text} />;
    case 'tool':
      return <ToolCallCard key={`tool-${index}`} name={block.name} result={block.result} />;
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
