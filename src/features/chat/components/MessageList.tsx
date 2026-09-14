import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage, MessageContent, ToolResult } from '@/domain/types/chat';
import { Markdown } from '@/shared/markdown/Markdown';
import { cn } from '@/shared/utils/cn';

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
}

export function MessageList({ messages, runStatus, onRegenerate, onContinue, onEdit, onDelete }: MessageListProps) {
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

interface MessageItemProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  streaming: boolean;
  busy: boolean;
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
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const isUser = message.role === 'user';
  const text = messageText(message);
  const blocks = useMemo(() => buildDisplayBlocks(message.content), [message.content]);

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
              initialText={text}
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
