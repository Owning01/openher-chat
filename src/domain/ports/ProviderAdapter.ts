import type { ModelInfo, ProviderCapabilities, ProviderKind } from '../types/provider';
import type { StreamEvent, WireMessage } from '../types/stream';
import type { ToolDefinition } from '../types/tools';
import type { HttpClient, StreamTransport } from './HttpClient';

export interface ChatCompletionRequest {
  modelId: string;
  system?: string;
  messages: WireMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none';
  temperature?: number;
  maxOutputTokens?: number | null;
  signal: AbortSignal;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly kind: ProviderKind;
  capabilities(): ProviderCapabilities;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  streamChat(request: ChatCompletionRequest): AsyncIterable<StreamEvent>;
}

export interface AdapterDeps {
  transport: StreamTransport;
  http: HttpClient;
  now: () => number;
}
