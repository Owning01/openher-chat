import type { ToolResult } from './chat';

export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

export interface ToolExecutionContext {
  signal: AbortSignal;
  conversationId: string;
}

export interface ToolDefinition<Args = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JsonSchema;
  timeoutMs: number;
  maxResultChars: number;
  execute(args: Args, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface ToolRegistry {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
}
