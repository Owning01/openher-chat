import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/chat';
import type { ToolDefinition } from '../types/tools';
import {
  TOKENS_PER_BLOCK,
  TOKENS_PER_MESSAGE,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTokens,
  estimateToolsTokens,
  utf8ByteLength,
} from './estimateTokens';

function message(content: ChatMessage['content'], role: ChatMessage['role'] = 'user'): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role,
    status: 'complete',
    content,
    createdAt: 0,
    updatedAt: 0,
  };
}

function toolDefinition(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    timeoutMs: 1000,
    maxResultChars: 100,
    execute: async () => ({ ok: true, content: '', durationMs: 0 }),
  };
}

describe('utf8ByteLength', () => {
  it('cuenta bytes UTF-8 sin APIs de entorno', () => {
    expect(utf8ByteLength('')).toBe(0);
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('ñ')).toBe(2);
    expect(utf8ByteLength('你好')).toBe(6);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('a😀')).toBe(5);
    expect(utf8ByteLength('\uD800')).toBe(3);
  });
});

describe('estimateTokens', () => {
  it('devuelve mínimo 1 para texto vacío', () => {
    expect(estimateTokens('')).toBe(1);
  });

  it('estima ASCII como ceil(bytes/4)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('estima UTF-8 multicode', () => {
    expect(estimateTokens('ñ')).toBe(1);
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('😀')).toBe(1);
    expect(estimateTokens('áéíó')).toBe(2);
  });
});

describe('estimateMessageTokens', () => {
  it('cuenta texto y razonamiento con overhead por mensaje y por bloque', () => {
    expect(estimateMessageTokens(message([{ type: 'text', text: 'abcd' }]))).toBe(
      TOKENS_PER_MESSAGE + TOKENS_PER_BLOCK + 1,
    );
    expect(estimateMessageTokens(message([{ type: 'reasoning', text: 'abcd' }]))).toBe(
      TOKENS_PER_MESSAGE + TOKENS_PER_BLOCK + 1,
    );
  });

  it('cuenta tool-call (nombre + argumentsText) y tool-result (content)', () => {
    expect(
      estimateMessageTokens(
        message([{ type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"query":"abcd"}' } }]),
      ),
    ).toBe(TOKENS_PER_MESSAGE + TOKENS_PER_BLOCK + estimateTokens('web_search') + estimateTokens('{"query":"abcd"}'));

    expect(
      estimateMessageTokens(message([{ type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: { ok: true, content: 'hello world', durationMs: 5 } }])),
    ).toBe(TOKENS_PER_MESSAGE + TOKENS_PER_BLOCK + estimateTokens('hello world'));
  });

  it('suma varios bloques y un mensaje vacío solo cuenta overhead', () => {
    expect(estimateMessageTokens(message([{ type: 'text', text: 'abcd' }, { type: 'text', text: 'abcd' }]))).toBe(
      TOKENS_PER_MESSAGE + 2 * (TOKENS_PER_BLOCK + 1),
    );
    expect(estimateMessageTokens(message([]))).toBe(TOKENS_PER_MESSAGE);
  });

  it('estimateMessagesTokens agrega la lista completa', () => {
    const messages = [message([{ type: 'text', text: 'abcd' }]), message([{ type: 'text', text: 'abcd' }])];
    expect(estimateMessagesTokens(messages)).toBe(2 * estimateMessageTokens(messages[0] as ChatMessage));
  });
});

describe('estimateToolsTokens', () => {
  it('devuelve 0 sin tools', () => {
    expect(estimateToolsTokens([])).toBe(0);
  });

  it('estima el JSON de los schemas / 4', () => {
    const tool = toolDefinition('web_search', 'Search the web');
    const bytes = utf8ByteLength(
      JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }),
    );
    expect(estimateToolsTokens([tool])).toBe(Math.ceil(bytes / 4));
    expect(estimateToolsTokens([tool])).toBeGreaterThan(0);
  });

  it('crece con más tools', () => {
    const one = estimateToolsTokens([toolDefinition('web_search', 'Search the web')]);
    const two = estimateToolsTokens([toolDefinition('web_search', 'Search the web'), toolDefinition('open_url', 'Open a URL')]);
    expect(two).toBeGreaterThan(one);
  });
});
