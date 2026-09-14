import { estimateMessageTokens, estimateToolsTokens } from '../chat/estimateTokens';
import type { ProviderAdapter } from '../ports/ProviderAdapter';
import type { ChatMessage } from '../types/chat';
import type { ToolDefinition } from '../types/tools';

/**
 * Puerto de la compactación de OpenCode (`core/src/session/compaction.ts`):
 * resume los turnos antiguos en un "anchored summary" y conserva los recientes.
 * El resumen sobrevive a la ventana de contexto y se reinyecta en cada turno.
 */

export const COMPACTION_BUFFER_TOKENS = 20_000;
export const COMPACTION_KEEP_TOKENS = 8_000;
export const MIN_PRESERVE_RECENT_TOKENS = 2_000;
export const MAX_PRESERVE_RECENT_TOKENS = 15_000;
export const TOOL_OUTPUT_MAX_CHARS = 2_000;
export const SUMMARY_OUTPUT_TOKENS = 4_096;

/** Plantilla de resumen anclado (idéntica a la de OpenCode). */
export const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`;

/** Instrucciones para fusionar un resumen previo con la conversación nueva. */
export const SUMMARY_UPDATE_INSTRUCTIONS = `The <prior-summary> summarizes everything that happened before the <conversation>. Construct a new summary that combines both. The <prior-summary> is discarded after this: anything you do not carry into the new summary is lost.

When combining:
- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary> even when the <conversation> does not mention them. Drop only what is finished and no longer needed.
- The <conversation> is more recent than the <prior-summary>. Where they conflict, the conversation wins: state the corrected fact and drop the old claim.
- Add new progress, decisions, constraints, and context from the conversation.
- Move completed work from "Active" to "Completed".
- If a blocker has been resolved, update the summary to reflect that while keeping any details still needed to continue the work.
- Update "Objective" and "Next Move" to reflect the current work state.`;

function truncate(value: string): string {
  return value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`;
}

/** Serializa un mensaje al formato `[User]/[Assistant]/[Tool result]` de OpenCode. */
export function serializeForSummary(message: ChatMessage): string {
  if (message.role === 'user') {
    const text = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text.trim())
      .filter((entry) => entry !== '')
      .join('\n');
    return text === '' ? '' : `[User]: ${text}`;
  }
  if (message.role !== 'assistant') return '';
  return message.content
    .flatMap((block) => {
      switch (block.type) {
        case 'text':
          return block.text === '' ? [] : [`[Assistant]: ${block.text}`];
        case 'reasoning':
          return block.text === '' ? [] : [`[Assistant reasoning]: ${block.text}`];
        case 'tool-call':
          return [`[Assistant tool call]: ${block.toolCall.name}(${block.toolCall.argumentsText})`];
        case 'tool-result':
          return [`[Tool result]: ${truncate(block.result.content)}`];
      }
    })
    .join('\n');
}

export interface CompactionWindow {
  /** Mensajes antiguos que se resumen. */
  head: ChatMessage[];
  /** Mensajes recientes que se conservan tal cual. */
  recent: ChatMessage[];
}

/** Conserva los mensajes más recientes hasta `keepTokens` (recorre del final al inicio). */
export function selectCompactionWindow(
  messages: readonly ChatMessage[],
  keepTokens = COMPACTION_KEEP_TOKENS,
): CompactionWindow {
  let total = 0;
  let split = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) continue;
    const size = estimateMessageTokens(message);
    if (total + size > keepTokens) break;
    total += size;
    split = index;
  }
  return { head: messages.slice(0, split), recent: messages.slice(split) };
}

/** Presupuesto reciente a conservar (OpenCode: 25% de la ventana, acotado a [2k, 15k]). */
export function preserveRecentBudget(contextWindow: number): number {
  return Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(contextWindow * 0.25)));
}

export function buildCompactionPrompt(input: { previousSummary?: string; context: readonly string[] }): string {
  const conversation = `Here is the conversation so far:\n\n<conversation>\n${input.context.join('\n\n')}\n</conversation>`;
  if (input.previousSummary === undefined || input.previousSummary.trim() === '') {
    return [
      conversation,
      'Create a new anchored summary from the conversation history in the <conversation> tags above so another agent can continue the work.',
      SUMMARY_TEMPLATE,
    ].join('\n\n');
  }
  return [
    conversation,
    `Here is the summary of the conversation before the <conversation> above:\n\n<prior-summary>\n${input.previousSummary}\n</prior-summary>`,
    SUMMARY_UPDATE_INSTRUCTIONS,
    SUMMARY_TEMPLATE,
  ].join('\n\n');
}

export interface ShouldCompactInput {
  history: readonly ChatMessage[];
  tools?: readonly ToolDefinition[];
  systemTokens?: number;
  contextWindow: number;
  reservedOutput: number;
  buffer?: number;
}

/** Umbral de OpenCode: `estimate <= context - max(output, buffer)` no compacta. */
export function shouldCompact(input: ShouldCompactInput): boolean {
  if (input.contextWindow <= 0) return false;
  const estimate =
    input.history.reduce((total, message) => total + estimateMessageTokens(message), 0) +
    estimateToolsTokens([...(input.tools ?? [])]) +
    (input.systemTokens ?? 0);
  return estimate > input.contextWindow - Math.max(input.reservedOutput, input.buffer ?? COMPACTION_BUFFER_TOKENS);
}

export interface CompactMessagesInput {
  provider: ProviderAdapter;
  modelId: string;
  messages: readonly ChatMessage[];
  previousSummary?: string;
  /** Tokens recientes a preservar (default `COMPACTION_KEEP_TOKENS`). */
  keepTokens?: number;
  maxSummaryTokens?: number;
  signal: AbortSignal;
  sessionId?: string;
}

export interface CompactionResult {
  summary: string;
  /** Último mensaje incluido en el resumen: el contexto enviado empieza después. */
  throughMessageId: string;
}

/** Resume `head` con el modelo y devuelve el ancla; `null` si no hay nada que resumir o falla. */
export async function compactMessages(input: CompactMessagesInput): Promise<CompactionResult | null> {
  const { head } = selectCompactionWindow(input.messages, input.keepTokens ?? COMPACTION_KEEP_TOKENS);
  const lastHead = head[head.length - 1];
  if (lastHead === undefined) return null;

  const context = head.map(serializeForSummary).filter((entry) => entry !== '');
  if (context.length === 0) return null;

  const prompt = buildCompactionPrompt({ previousSummary: input.previousSummary, context });
  const maxTokens = Math.min(input.maxSummaryTokens ?? SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS);

  let text = '';
  try {
    for await (const event of input.provider.streamChat({
      modelId: input.modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxOutputTokens: maxTokens,
      signal: input.signal,
      sessionId: input.sessionId,
      toolChoice: 'none',
    })) {
      if (event.type === 'text-delta') text += event.delta;
      else if (event.type === 'stop') break;
      else if (event.type === 'error') return null;
    }
  } catch {
    return null;
  }

  const summary = text.trim();
  if (summary === '') return null;
  return { summary, throughMessageId: lastHead.id };
}
