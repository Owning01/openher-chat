import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/chat';
import { createAssistantMessage, createToolResultBlock, createUserMessage, finalizeMessage } from './messageFactory';

describe('createUserMessage', () => {
  it('crea un mensaje user completo con timestamp inyectado', () => {
    expect(createUserMessage({ id: 'u1', conversationId: 'c1', text: 'hola', now: 1000 })).toEqual({
      id: 'u1',
      conversationId: 'c1',
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'hola' }],
      createdAt: 1000,
      updatedAt: 1000,
    });
  });
});

describe('createAssistantMessage', () => {
  it('crea un mensaje assistant vacío en streaming con provider/model', () => {
    expect(createAssistantMessage({ id: 'a1', conversationId: 'c1', providerId: 'groq', modelId: 'llama', now: 2000 })).toEqual({
      id: 'a1',
      conversationId: 'c1',
      role: 'assistant',
      status: 'streaming',
      content: [],
      createdAt: 2000,
      updatedAt: 2000,
      providerId: 'groq',
      modelId: 'llama',
    });
  });
});

describe('createToolResultBlock', () => {
  it('crea el bloque tool-result', () => {
    const result = { ok: false, content: 'boom', error: { code: 'timeout' as const, message: 'timeout' }, durationMs: 15000 };
    expect(createToolResultBlock({ toolCallId: 't1', toolName: 'open_url', result })).toEqual({
      type: 'tool-result',
      toolCallId: 't1',
      toolName: 'open_url',
      result,
    });
  });
});

describe('finalizeMessage', () => {
  it('cierra el mensaje sin mutar el original', () => {
    const message = createAssistantMessage({ id: 'a1', conversationId: 'c1', providerId: 'groq', modelId: 'llama', now: 2000 });
    const finalized = finalizeMessage(message, {
      status: 'complete',
      finishReason: 'complete',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      now: 3000,
    });
    expect(finalized).not.toBe(message);
    expect(finalized.status).toBe('complete');
    expect(finalized.finishReason).toBe('complete');
    expect(finalized.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(finalized.updatedAt).toBe(3000);
    expect(message.status).toBe('streaming');
    expect(message.updatedAt).toBe(2000);
    expect(message.finishReason).toBeUndefined();
  });

  it('registra error y conserva campos no informados', () => {
    const message = createAssistantMessage({ id: 'a1', conversationId: 'c1', providerId: 'groq', modelId: 'llama', now: 2000 });
    message.usage = { totalTokens: 3 };
    const finalized = finalizeMessage(message, {
      status: 'error',
      error: { code: 'rate_limit', message: 'slow down', retryable: true },
    });
    expect(finalized.error).toEqual({ code: 'rate_limit', message: 'slow down', retryable: true });
    expect(finalized.usage).toEqual({ totalTokens: 3 });
    expect(finalized.updatedAt).toBe(2000);
  });

  it('no agrega campos opcionales ausentes', () => {
    const message: ChatMessage = createUserMessage({ id: 'u1', conversationId: 'c1', text: 'x', now: 1 });
    const finalized = finalizeMessage(message, { status: 'aborted', now: 2 });
    expect('usage' in finalized).toBe(false);
    expect('error' in finalized).toBe(false);
    expect('finishReason' in finalized).toBe(false);
  });
});
