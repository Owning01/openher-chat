import type { ChatMessage, MessageError, ToolCall, TokenUsage, ToolResult } from './chat';
import type { StopReason } from './stream';

export interface AgentBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxToolResultChars: number;
  maxTotalTokens: number;
  maxWallClockMs: number;
  maxRetriesPerStep: number;
  toolTimeoutMs: number;
}

export interface AgentStep {
  index: number;
  status: 'running' | 'complete' | 'error';
  startedAt: number;
  endedAt?: number;
  stopReason?: StopReason;
  usage?: TokenUsage;
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

export type AgentRunStatus = 'complete' | 'aborted' | 'budget_exceeded' | 'error';

export type AgentEvent =
  | { type: 'run-start'; runId: string }
  | { type: 'step-start'; stepIndex: number }
  | { type: 'text-delta'; stepIndex: number; delta: string }
  | { type: 'reasoning-delta'; stepIndex: number; delta: string }
  | { type: 'tool-start'; stepIndex: number; toolCall: ToolCall }
  | { type: 'tool-end'; stepIndex: number; toolCall: ToolCall; result: ToolResult }
  | { type: 'step-end'; stepIndex: number; stopReason: StopReason; usage?: TokenUsage }
  | { type: 'run-end'; status: AgentRunStatus; message: ChatMessage; error?: MessageError };
