import type { MessageError, TokenUsage, ToolCall } from './chat';

/** Mensaje ya normalizado para el wire de cualquier adapter. */
export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: { id: string; name: string; argumentsText: string }[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName?: string };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'aborted';

export type StreamEvent =
  | { type: 'start' }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'transport-fallback'; reason: 'cors' | 'stream_unsupported' | 'network' }
  | { type: 'stop'; reason: StopReason }
  | { type: 'error'; error: MessageError };
