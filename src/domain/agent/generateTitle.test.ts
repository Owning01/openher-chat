import { describe, expect, it } from 'vitest';

import type { ChatCompletionRequest, ProviderAdapter } from '../ports/ProviderAdapter';
import type { ModelInfo, ProviderCapabilities } from '../types/provider';
import type { StreamEvent } from '../types/stream';
import { GENERATED_TITLE_MAX_CHARS, buildTitleMessages, generateTitle, sanitizeTitle } from './generateTitle';

class TitleAdapter implements ProviderAdapter {
  readonly providerId = 'fake';
  readonly kind = 'openai-compatible' as const;
  readonly requests: ChatCompletionRequest[] = [];
  private readonly events: StreamEvent[] | Error;

  constructor(events: StreamEvent[] | Error) {
    this.events = events;
  }

  capabilities(): ProviderCapabilities {
    return { streaming: true, toolCalling: true, systemPrompt: true, listModels: true, images: false };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<StreamEvent, void, void> {
    this.requests.push(request);
    if (this.events instanceof Error) throw this.events;
    for (const event of this.events) yield event;
  }
}

function run(events: StreamEvent[] | Error, signal = new AbortController().signal) {
  const provider = new TitleAdapter(events);
  return { provider, promise: generateTitle({ provider, modelId: 'm', userText: 'u', assistantText: 'a', signal }) };
}

describe('sanitizeTitle', () => {
  it('limpia prefijos, markdown, comillas y puntuación final', () => {
    expect(sanitizeTitle('Title: "Climate policy debate".')).toBe('Climate policy debate');
    expect(sanitizeTitle('## **Rust vs. Go**')).toBe('Rust vs. Go');
    expect(sanitizeTitle('  \n  Título: Energía solar en Chile  \n')).toBe('Energía solar en Chile');
  });

  it('devuelve null con salidas vacías o demasiado cortas', () => {
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle('   \n  ')).toBeNull();
    expect(sanitizeTitle('"x"')).toBeNull();
  });

  it('recorta en frontera de palabra sin pasar el máximo', () => {
    const long = 'palabra '.repeat(20);
    const result = sanitizeTitle(long, 20);
    expect(result).not.toBeNull();
    expect(result?.length).toBeLessThanOrEqual(20);
    expect(result?.endsWith(' ')).toBe(false);
  });

  it('usa una sola línea', () => {
    expect(sanitizeTitle('Primera línea\nSegunda línea')).toBe('Primera línea');
  });

  it('descarta bloques de razonamiento <think>', () => {
    expect(sanitizeTitle('<think>dudando…</think>\nTítulo real')).toBe('Título real');
    expect(sanitizeTitle('<think>solo pensar</think>')).toBeNull();
  });
});

describe('buildTitleMessages', () => {
  it('antepone la instrucción y adjunta el primer turno acotado', () => {
    const messages = buildTitleMessages('a'.repeat(900), 'b'.repeat(900));
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toContain('Generate a title for this conversation:');
    expect(messages[0]?.content).toContain('…');
    expect(messages[1]?.role).toBe('assistant');
  });
});

describe('generateTitle', () => {
  it('acumula los deltas de texto y devuelve el título saneado', async () => {
    const { provider, promise } = run([
      { type: 'start' },
      { type: 'text-delta', delta: 'Title: ' },
      { type: 'text-delta', delta: 'Energía solar en Chile' },
      { type: 'stop', reason: 'end_turn' },
    ]);

    await expect(promise).resolves.toBe('Energía solar en Chile');
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.maxOutputTokens).toBe(32);
    expect(provider.requests[0]?.toolChoice).toBe('none');
  });

  it('devuelve null ante error del stream o excepción del adapter', async () => {
    const failed = run([{ type: 'error', error: { code: 'server', message: 'boom', retryable: true } }]);
    await expect(failed.promise).resolves.toBeNull();

    const thrown = run(new Error('network'));
    await expect(thrown.promise).resolves.toBeNull();
  });

  it('no supera el tope de caracteres', async () => {
    const { promise } = run([
      { type: 'text-delta', delta: 'palabra '.repeat(30) },
      { type: 'stop', reason: 'end_turn' },
    ]);
    const title = await promise;
    expect(title).not.toBeNull();
    expect(title?.length).toBeLessThanOrEqual(GENERATED_TITLE_MAX_CHARS);
  });
});
