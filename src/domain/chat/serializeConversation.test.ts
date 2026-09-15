import { describe, expect, it } from 'vitest';

import { buildLegalIndex } from '../legal/retrieval';
import type { LegalPack } from '../types/legal';
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

  it('anota las imágenes sin volcar el dataUrl', () => {
    const withImage = userMessage();
    withImage.content.push({
      type: 'image',
      imageId: 'img_1',
      name: 'foto.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,AAA',
    });
    const md = conversationToMarkdown(conversation(), [withImage]);
    expect(md).toContain('[imagen adjunta: foto.png]');
    expect(md).not.toContain('base64,AAA');
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

  it('hace round-trip del vínculo legal y lo omite en modo general', () => {
    const legal = conversationToArchive(conversation({ legalCaseId: 'case-1' }), [userMessage()], 7);
    expect(legal.conversation.legalCaseId).toBe('case-1');
    expect(parseConversationArchive(JSON.stringify(legal))?.conversation.legalCaseId).toBe('case-1');

    const general = conversationToArchive(conversation(), [userMessage()], 7);
    expect(general.conversation).not.toHaveProperty('legalCaseId');
    expect(parseConversationArchive(JSON.stringify(general))?.conversation.legalCaseId).toBeUndefined();
  });

  it('hace round-trip del rol del circuito y rechaza roles inválidos', () => {
    const circuit = conversationToArchive(
      conversation({ legalCaseId: 'case-1', legalRole: 'juez' }),
      [userMessage()],
      7,
    );
    expect(circuit.conversation.legalRole).toBe('juez');
    expect(parseConversationArchive(JSON.stringify(circuit))?.conversation.legalRole).toBe('juez');

    const sintesis = conversationToArchive(
      conversation({ legalCaseId: 'case-1', legalRole: 'sintesis' }),
      [userMessage()],
      7,
    );
    expect(parseConversationArchive(JSON.stringify(sintesis))?.conversation.legalRole).toBe('sintesis');

    const noRole = conversationToArchive(conversation({ legalCaseId: 'case-1' }), [userMessage()], 7);
    expect(noRole.conversation).not.toHaveProperty('legalRole');

    const hostile = JSON.parse(JSON.stringify(circuit)) as { conversation: { legalRole: unknown } };
    hostile.conversation.legalRole = 'fiscal';
    expect(parseConversationArchive(JSON.stringify(hostile))?.conversation.legalRole).toBeUndefined();
  });

  it('hace round-trip de bloques image y rechaza dataUrls inválidos', () => {
    const withImage = userMessage();
    withImage.content.push({
      type: 'image',
      imageId: 'img_1',
      name: 'foto.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,AAA',
    });
    const json = conversationToJson(conversation(), [withImage], 11);
    const parsed = parseConversationArchive(json);
    expect(parsed?.messages[0]?.content.map((block) => block.type)).toEqual(['text', 'image']);

    const tampered = JSON.parse(json) as { messages: { content: { dataUrl: unknown }[] }[] };
    tampered.messages[0]!.content[1]!.dataUrl = 'no-es-data-url';
    expect(parseConversationArchive(JSON.stringify(tampered))?.messages[0]?.content.map((b) => b.type)).toEqual([
      'text',
    ]);
  });
});

const LEGAL_PACK: LegalPack = {
  schema: 'openher.legal.pack/1',
  id: 'test-pack',
  title: 'Pack de prueba',
  version: '1.0.0',
  publishedAt: '2026-01-01',
  jurisdiction: 'national',
  matter: 'civil',
  license: { name: 'prueba', url: 'https://example.com/licencia', attribution: 'prueba' },
  sources: [],
  norms: [{ id: 'CCyC', short: 'CCyC', long: 'Código Civil y Comercial de la Nación', jurisdiction: 'national' }],
  provisions: [
    {
      id: 'CCyC-2560',
      normId: 'CCyC',
      article: '2560',
      text: 'El plazo genérico de prescripción es de cinco años.',
      jurisdiction: 'national',
      sourceUrl: 'https://example.com/ccyc-2560',
      sourceDate: '2026-01-01',
      textHash: 'hash',
      verificationMethod: 'manual',
      tags: [],
      verified: true,
    },
  ],
  hash: 'hash',
};

function legalAssistant(text: string): ChatMessage {
  return {
    id: 'm9',
    conversationId: 'c1',
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: 2,
    updatedAt: 2,
  };
}

describe('conversationToMarkdown legal', () => {
  it('incluye watermark, disclaimer y modo legal sin alterar el turno general', () => {
    const general = conversationToMarkdown(conversation({ researchMode: false }), [userMessage()]);
    expect(general).not.toContain('ANÁLISIS INTERNO');
    expect(general).not.toContain('Boletín Oficial');

    const legal = conversationToMarkdown(conversation({ researchMode: false, legalCaseId: 'case-1' }), [
      userMessage(),
    ]);
    expect(legal).toContain('ANÁLISIS INTERNO');
    expect(legal).toContain('Boletín Oficial');
    expect(legal).toContain('Legal mode: on');
  });

  it('con índice verifica lo existente y marca lo ausente', () => {
    const index = buildLegalIndex([LEGAL_PACK]);
    const convo = conversation({ researchMode: false, legalCaseId: 'case-1' });

    const verified = conversationToMarkdown(convo, [legalAssistant('Según CCyC art. 2560 corresponde.')], {
      index,
    });
    expect(verified).not.toContain('2560 [VERIFICAR]');

    const missing = conversationToMarkdown(convo, [legalAssistant('Según CCyC art. 9999 corresponde.')], {
      index,
    });
    expect(missing).toContain('9999 [VERIFICAR]');
  });

  it('sin índice marca conservadoramente y documenta el límite', () => {
    const convo = conversation({ researchMode: false, legalCaseId: 'case-1' });
    const md = conversationToMarkdown(convo, [legalAssistant('Según CCyC art. 2560 corresponde.')]);
    expect(md).toContain('[VERIFICAR]');
    expect(md).toContain('no están confirmadas');
  });
});
