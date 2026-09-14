import type { AppServices } from '@/app/services';
import { createDefaultSettings } from '@/domain/settings/defaults';
import type { ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { AgentBudget } from '@/domain/types/agent';
import type { ChatMessage, MessageErrorCode } from '@/domain/types/chat';
import type { Conversation } from '@/domain/types/conversation';
import type { ModelInfo, ProviderCapabilities, ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { MemoryConversationRepository, MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { createChatStore } from '../chatStore';
import type { ChatStore } from '../chatStore';

export interface ProviderScript {
  events: StreamEvent[];
  onEvent?: (event: StreamEvent, index: number, signal: AbortSignal) => Promise<void> | void;
  throwBefore?: unknown;
}

/** ProviderAdapter guionizado: cada `streamChat` consume el siguiente script. */
export class ScriptedProvider implements ProviderAdapter {
  readonly providerId = 'provider-1';
  readonly kind = 'openai-compatible' as const;
  readonly requests: ChatCompletionRequest[] = [];
  readonly scripts: ProviderScript[] = [];
  toolCalling = false;

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolCalling: this.toolCalling, systemPrompt: true, listModels: false, images: false };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    this.requests.push(request);
    const script = this.scripts.shift();
    if (script === undefined) return;
    if (script.throwBefore !== undefined) throw script.throwBefore;
    for (let index = 0; index < script.events.length; index += 1) {
      const event = script.events[index];
      if (event === undefined) continue;
      await script.onEvent?.(event, index, request.signal);
      yield event;
    }
  }
}

export class FakeToolRegistry implements ToolRegistry {
  private readonly tools: ToolDefinition[] = [];

  add(tool: ToolDefinition): void {
    this.tools.push(tool);
  }

  list(): ToolDefinition[] {
    return this.tools;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.find((tool) => tool.name === name);
  }
}

export interface RecordedUpdate {
  messageId: string;
  patch: Partial<Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>>;
}

/** MemoryRepo con registro de `updateMessage` para auditar checkpoints y sellos. */
export class CountingConversationRepository extends MemoryConversationRepository {
  readonly updates: RecordedUpdate[] = [];

  override async updateMessage(
    id: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>>,
  ): Promise<void> {
    this.updates.push({ messageId: id, patch: JSON.parse(JSON.stringify(patch)) as RecordedUpdate['patch'] });
    await super.updateMessage(id, patch);
  }
}

export interface ChatHarness {
  store: ChatStore;
  services: AppServices;
  repo: CountingConversationRepository;
  provider: ScriptedProvider;
  tools: FakeToolRegistry;
  settings: MemorySettingsRepository;
  adapterConfigs: ProviderConfig[];
  now(): number;
  advance(ms: number): void;
}

export interface ChatHarnessOptions {
  agent?: Partial<AgentBudget>;
  providers?: ProviderConfig[];
  autoTitle?: boolean;
  compaction?: boolean;
  onConversationUpdated?: (conversation: Conversation) => void;
}

export function createChatHarness(options: ChatHarnessOptions = {}): ChatHarness {
  const state = { now: 0 };
  let sequence = 0;
  const nextId = (prefix: string): string => `${prefix}${String((sequence += 1)).padStart(4, '0')}`;

  const repo = new CountingConversationRepository({ now: () => state.now, newId: () => nextId('c') });
  const provider = new ScriptedProvider();
  const tools = new FakeToolRegistry();
  const defaults = createDefaultSettings(state.now);
  const settings = new MemorySettingsRepository({
    now: () => state.now,
    initial: { ...defaults, agent: { ...defaults.agent, maxRetriesPerStep: 0, ...options.agent } },
  });
  const providerConfigs = options.providers ?? [createProviderConfig()];
  const adapterConfigs: ProviderConfig[] = [];

  const services: AppServices = {
    conversations: repo,
    settings,
    keys: new MemoryKeyVault(),
    http: { request: async () => ({ status: 200, headers: {}, text: '' }) },
    transport: {
      post: async () => {
        throw new Error('StreamTransport is not used by chatStore tests.');
      },
    },
    async createAdapter(config) {
      adapterConfigs.push(config);
      return provider;
    },
  };

  const store = createChatStore({
    services,
    conversations: repo,
    tools,
    providers: { load: async () => providerConfigs },
    clock: () => state.now,
    newId: () => nextId('m'),
    autoTitle: options.autoTitle,
    compaction: options.compaction,
    onConversationUpdated: options.onConversationUpdated,
  });

  return {
    store,
    services,
    repo,
    provider,
    tools,
    settings,
    adapterConfigs,
    now: () => state.now,
    advance: (ms) => {
      state.now += ms;
    },
  };
}

export function createProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    label: 'Test Provider',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    requiresKey: false,
    keyRef: null,
    models: [{ id: 'model-1', label: 'Model 1', source: 'manual', supportsTools: true }],
    defaultModelId: 'model-1',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function scriptFor(text: string): ProviderScript {
  return { events: [{ type: 'text-delta', delta: text }, { type: 'stop', reason: 'end_turn' }] };
}

export function okTool(name: string, content = 'tool-result'): ToolDefinition {
  return {
    name,
    description: `Fake tool ${name} for tests`,
    parameters: { type: 'object', properties: {}, required: [] },
    timeoutMs: 5000,
    maxResultChars: 4000,
    execute: async () => ({ ok: true, content, durationMs: 1 }),
  };
}

export function providerFailure(
  code: MessageErrorCode,
  options: { retryable: boolean; status?: number } = { retryable: false },
): Error {
  return Object.assign(new Error(`fake ${code}`), { code, retryable: options.retryable, status: options.status });
}

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

export function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export function assistantOf(store: ChatStore): ChatMessage {
  const messages = store.getState().messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === 'assistant') return message;
  }
  throw new Error('missing assistant message');
}
