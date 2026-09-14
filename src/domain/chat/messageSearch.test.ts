import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/chat';
import { messagePlainText, searchMessages, snippetAround } from './messageSearch';

function message(overrides: Partial<ChatMessage> & { id: string; text: string }): ChatMessage {
  const { id, text, ...rest } = overrides;
  return {
    id,
    conversationId: 'c1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: 1,
    updatedAt: 1,
    ...rest,
  };
}

describe('messagePlainText', () => {
  it('concatena solo los bloques de texto', () => {
    const value: ChatMessage = {
      id: 'm1',
      conversationId: 'c1',
      role: 'assistant',
      status: 'complete',
      content: [
        { type: 'text', text: 'hola' },
        { type: 'reasoning', text: 'oculto' },
        { type: 'text', text: 'mundo' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(messagePlainText(value)).toBe('hola\nmundo');
  });
});

describe('searchMessages', () => {
  it('encuentra coincidencias sin distinguir mayúsculas y ordena por fecha descendente', () => {
    const hits = searchMessages(
      [
        message({ id: 'a', text: 'La polémica de Amodei', createdAt: 1 }),
        message({ id: 'b', text: 'Otra cosa', createdAt: 5 }),
        message({ id: 'c', text: 'AMODEI respondió', createdAt: 9 }),
      ],
      'amodei',
      10,
    );
    expect(hits.map((hit) => hit.messageId)).toEqual(['c', 'a']);
  });

  it('ignora query vacía y respeta el límite', () => {
    const messages = [1, 2, 3].map((n) => message({ id: `m${n}`, text: 'foo', createdAt: n }));
    expect(searchMessages(messages, '   ', 10)).toEqual([]);
    expect(searchMessages(messages, 'foo', 2)).toHaveLength(2);
  });
});

describe('snippetAround', () => {
  it('recorta con elipsis cuando hay contexto a ambos lados', () => {
    const text = `${'x'.repeat(80)} aguja ${'y'.repeat(80)}`;
    const snippet = snippetAround(text, text.indexOf('aguja'), 5);
    expect(snippet).toContain('aguja');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
