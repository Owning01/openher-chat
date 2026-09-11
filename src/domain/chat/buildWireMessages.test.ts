import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/chat';
import { buildWireMessages } from './buildWireMessages';

function userMessage(id: string, texts: string[]): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    role: 'user',
    status: 'complete',
    content: texts.map((text) => ({ type: 'text', text })),
    createdAt: 0,
    updatedAt: 0,
  };
}

function assistantMessage(id: string, content: ChatMessage['content']): ChatMessage {
  return {
    id,
    conversationId: 'c1',
    role: 'assistant',
    status: 'complete',
    content,
    createdAt: 0,
    updatedAt: 0,
  };
}

const TOOL_RESULT = { ok: true, content: 'tool output', durationMs: 10 };

describe('buildWireMessages', () => {
  it('pone system primero, expande el historial y deja el user al final', () => {
    const wires = buildWireMessages({
      system: 'SYS',
      history: [assistantMessage('a1', [{ type: 'text', text: 'hi' }])],
      userMessage: userMessage('u2', ['question']),
    });
    expect(wires).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'question' },
    ]);
  });

  it('omite system ausente o vacío', () => {
    expect(buildWireMessages({ history: [], userMessage: userMessage('u1', ['q']) })).toEqual([{ role: 'user', content: 'q' }]);
    expect(buildWireMessages({ system: '   ', history: [], userMessage: userMessage('u1', ['q']) })).toEqual([
      { role: 'user', content: 'q' },
    ]);
  });

  it('une varios bloques de texto con doble salto de línea', () => {
    expect(buildWireMessages({ history: [], userMessage: userMessage('u1', ['one', 'two']) })).toEqual([
      { role: 'user', content: 'one\n\ntwo' },
    ]);
  });

  it('emite assistant con texto + toolCalls (solo argumentsText)', () => {
    const wires = buildWireMessages({
      history: [
        assistantMessage('a1', [
          { type: 'text', text: 'Searching' },
          { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"query":"x"}', arguments: { query: 'x' } } },
        ]),
      ],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires[0]).toEqual({
      role: 'assistant',
      content: 'Searching',
      toolCalls: [{ id: 't1', name: 'web_search', argumentsText: '{"query":"x"}' }],
    });
  });

  it('emite assistant con content vacío cuando solo hay tool-call', () => {
    const wires = buildWireMessages({
      history: [assistantMessage('a1', [{ type: 'tool-call', toolCall: { id: 't1', name: 'open_url', argumentsText: '{}' } }])],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires[0]).toEqual({ role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'open_url', argumentsText: '{}' }] });
  });

  it('convierte bloques tool-result en mensajes rol tool', () => {
    const wires = buildWireMessages({
      history: [assistantMessage('a1', [{ type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT }])],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires[0]).toEqual({ role: 'tool', content: 'tool output', toolCallId: 't1', toolName: 'web_search' });
  });

  it('expande pasos intercalados a assistant/tool/assistant', () => {
    const wires = buildWireMessages({
      history: [
        assistantMessage('a1', [
          { type: 'text', text: 'step one' },
          { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"query":"x"}' } },
          { type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT },
          { type: 'text', text: 'step two' },
        ]),
      ],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires).toEqual([
      {
        role: 'assistant',
        content: 'step one',
        toolCalls: [{ id: 't1', name: 'web_search', argumentsText: '{"query":"x"}' }],
      },
      { role: 'tool', content: 'tool output', toolCallId: 't1', toolName: 'web_search' },
      { role: 'assistant', content: 'step two' },
      { role: 'user', content: 'q' },
    ]);
  });

  it('omite reasoning del wire', () => {
    const wires = buildWireMessages({
      history: [
        assistantMessage('a1', [
          { type: 'reasoning', text: 'thinking hard' },
          { type: 'text', text: 'answer' },
        ]),
      ],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires).toEqual([
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'q' },
    ]);
    const onlyReasoning = buildWireMessages({
      history: [assistantMessage('a1', [{ type: 'reasoning', text: 'thinking hard' }])],
      userMessage: userMessage('u1', ['q']),
    });
    expect(onlyReasoning).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('conserva el orden del historial y agrega el user al final', () => {
    const wires = buildWireMessages({
      history: [userMessage('u1', ['first']), assistantMessage('a1', [{ type: 'text', text: 'reply' }])],
      userMessage: userMessage('u2', ['second']),
    });
    expect(wires.map((wire) => wire.role)).toEqual(['user', 'assistant', 'user']);
  });
});
