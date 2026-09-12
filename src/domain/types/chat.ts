export type Role = 'system' | 'user' | 'assistant';

export interface ToolCall {
  id: string;
  name: string;
  argumentsText: string;
  arguments?: unknown;
}

export interface SourceRef {
  url: string;
  title: string;
  snippet?: string;
  accessedAt: number;
}

export type ToolErrorCode =
  | 'timeout'
  | 'network'
  | 'cors_blocked'
  | 'blocked_url'
  | 'no_provider'
  | 'invalid_args'
  | 'invalid_proxy'
  | 'missing_proxy'
  | 'http_error'
  | 'parse_error';

export interface ToolResult {
  ok: boolean;
  content: string;
  sources?: SourceRef[];
  provider?: string;
  error?: { code: ToolErrorCode; message: string };
  durationMs: number;
}

export type MessageErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'server'
  | 'invalid_request'
  | 'context_length'
  | 'aborted'
  | 'unknown';

export interface MessageError {
  code: MessageErrorCode;
  message: string;
  retryable: boolean;
}

export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'aborted' | 'error';

export type MessageFinishReason = 'complete' | 'aborted' | 'budget_exceeded' | 'error';

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCall: ToolCall }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: ToolResult };

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  status: MessageStatus;
  content: MessageContent[];
  createdAt: number;
  updatedAt: number;
  providerId?: string;
  modelId?: string;
  usage?: TokenUsage;
  finishReason?: MessageFinishReason;
  error?: MessageError;
}
