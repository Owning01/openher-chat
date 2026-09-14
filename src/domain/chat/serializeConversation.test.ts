import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/chat';
import type { Conversation } from '../types/conversation';
import {
  conversationToArchive,
  conversationToJson,
  conversationToMarkdown,
  parseConversationArchive,
} from './serializeConversation';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: 'Polémica Amodei',
    createdAt: 1,
    updatedAt: 2,
    providerId: 'opencode-go',
    modelId: 'deepseek-v4-flash',
    systemPromptOverride: null,
    researchMode: true,
    messageCount: 2,
    lastMessagePreview: 'hola',
    status: 'active',
    ...overrides,
  };
}

function userMessage(): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: '¿Qué pasó hoy?' }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function assistantMessage(): ChatMessage {
  return {
    id: 'm2',
    conversationId: 'c1',
    role: 'assistant',
    status: 'complete',
    content: [
      { type: 'text', text: 'Amodei pidió frenar.' },
      { type: 'reasoning', text: 'Pienso…' },
      { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"query":"Amodei"}' } },
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'web_search',
        result: {
          ok: true,
          content: 'resultado',
          sources: [{ url: 'https://ex.com/a', title: 'Ex', accessedAt: 3 }],
          durationMs: 5,
        },
      },
    ],
    createdAt: 2,
    updatedAt: 2,
  };
}

describe('conversationToMarkdown', () => {
  it('incluye título, roles, texto y fuentes', () => {
    const md = conversationToMarkdown(conversation(), [userMessage(), assistantMessage()]);
    expect(md).toContain('# Polémica Amodei');
    expect(md).toContain('## User');
    expect(md).toContain('¿Qué pasó hoy?');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Amodei pidió frenar.');
    expect(md).toContain('> Reasoning:');
    expect(md).toContain('web_search');
    expect(md).toContain('[Ex](https://ex.com/a)');
  });
});

describe('conversationToJson / parseConversationArchive', () => {
  it('hace round-trip de la conversación y sus mensajes', () => {
    const json = conversationToJson(conversation(), [userMessage(), assistantMessage()], 999);
    const parsed = parseConversationArchive(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.conversation.title).toBe('Polémica Amodei');
    expect(parsed?.conversation.researchMode).toBe(true);
    expect(parsed?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(parsed?.messages[1]?.content.map((block) => block.type)).toEqual([
      'text',
      'reasoning',
      'tool-call',
      'tool-result',
    ]);
  });

  it('devuelve null ante JSON inválido o sin mensajes válidos', () => {
    expect(parseConversationArchive('no-json')).toBeNull();
    expect(parseConversationArchive('{"version":1}')).toBeNull();
    expect(parseConversationArchive('{"conversation":{},"messages":[{"role":"user","content":[]}]}')).toBeNull();
  });

  it('conversationToArchive no comparte referencias con los mensajes', () => {
    const messages = [userMessage()];
    const archive = conversationToArchive(conversation(), messages, 1);
    archive.messages[0]!.content[0] = { type: 'text', text: 'mutado' };
    expect(messages[0]?.content[0]).toEqual({ type: 'text', text: '¿Qué pasó hoy?' });
  });
});
