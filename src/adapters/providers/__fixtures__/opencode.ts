/**
 * Fixtures de los delegates de OpenCode Zen: adapters de grabación que anotan
 * a qué transporte se les enrutó y con qué request, sin tocar la red.
 */

import type { AdapterDeps, ChatCompletionRequest, ProviderAdapter } from '@/domain/ports/ProviderAdapter';
import type { ModelApi, ProviderCapabilities, ProviderConfig } from '@/domain/types/provider';
import type { StreamEvent } from '@/domain/types/stream';
import type { AdapterFactory, OpenCodeDelegates } from '../opencode';

/** Una invocación registrada por un delegate. */
export interface DelegateCall {
  api: ModelApi;
  request: ChatCompletionRequest;
}

/** Delegates de grabación + bitácoras de uso. */
export interface RecordingDelegates {
  delegates: OpenCodeDelegates;
  calls: DelegateCall[];
  /** APIs para las que se construyó efectivamente un adapter. */
  built: ModelApi[];
}

export function recordingDelegates(): RecordingDelegates {
  const calls: DelegateCall[] = [];
  const built: ModelApi[] = [];
  const factory = (api: ModelApi): AdapterFactory => {
    return (config, deps) => {
      built.push(api);
      return recordingAdapter(api, calls, config, deps);
    };
  };
  return {
    delegates: {
      'chat-completions': factory('chat-completions'),
      messages: factory('messages'),
      responses: factory('responses'),
    },
    calls,
    built,
  };
}

function recordingAdapter(
  api: ModelApi,
  calls: DelegateCall[],
  config: ProviderConfig,
  _deps: AdapterDeps,
): ProviderAdapter {
  const capabilities = (): ProviderCapabilities => ({
    streaming: true,
    toolCalling: true,
    systemPrompt: true,
    listModels: true,
    images: true,
  });

  return {
    providerId: config.id,
    kind: 'openai-compatible',
    capabilities,
    async listModels() {
      return [];
    },
    async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
      calls.push({ api, request });
      yield { type: 'start' };
      yield { type: 'text-delta', delta: api };
      yield { type: 'stop', reason: 'end_turn' };
    },
  };
}
