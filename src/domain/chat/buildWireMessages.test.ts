import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/chat';
import { buildWireMessages, ORPHAN_TOOL_RESULT_CONTENT } from './buildWireMessages';

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

  it('emite assistant con content vacío y repara con placeholder el tool-call sin resultado', () => {
    const wires = buildWireMessages({
      history: [assistantMessage('a1', [{ type: 'tool-call', toolCall: { id: 't1', name: 'open_url', argumentsText: '{}' } }])],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires).toEqual([
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'open_url', argumentsText: '{}' }] },
      { role: 'tool', content: ORPHAN_TOOL_RESULT_CONTENT, toolCallId: 't1', toolName: 'open_url' },
      { role: 'user', content: 'q' },
    ]);
  });

  it('convierte un par assistant(tool-call) + tool-result en mensajes assistant/tool', () => {
    const wires = buildWireMessages({
      history: [
        assistantMessage('a1', [
          { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{"query":"x"}' } },
          { type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT },
        ]),
      ],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'web_search', argumentsText: '{"query":"x"}' }],
      },
      { role: 'tool', content: 'tool output', toolCallId: 't1', toolName: 'web_search' },
      { role: 'user', content: 'q' },
    ]);
  });

  it('descarta un tool-result huérfano sin tool-call precedente', () => {
    const wires = buildWireMessages({
      history: [assistantMessage('a1', [{ type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT }])],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('empareja un tool-result emitido en otro mensaje con su call precedente', () => {
    const wires = buildWireMessages({
      history: [
        assistantMessage('a1', [{ type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{}' } }]),
        userMessage('u1', ['q']),
        assistantMessage('a2', [{ type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT }]),
      ],
      userMessage: userMessage('u2', ['next']),
    });
    expect(wires.map((wire) => wire.role)).toEqual(['assistant', 'user', 'tool', 'user']);
  });

  it('descarta respuestas duplicadas del mismo tool-call', () => {
    const wires = buildWireMessages({
      history: [
        assistantMessage('a1', [
          { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{}' } },
          { type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT },
          { type: 'tool-result', toolCallId: 't1', toolName: 'web_search', result: TOOL_RESULT },
        ]),
      ],
      userMessage: userMessage('u1', ['q']),
    });
    expect(wires.filter((wire) => wire.role === 'tool')).toHaveLength(1);
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

  it('propaga imágenes del usuario al wire y permite mensaje solo con imágenes', () => {    const withImage: ChatMessage = {
      id: 'u1',
      conversationId: 'c1',
      role: 'user',
      status: 'complete',
      content: [
        { type: 'text', text: 'mirá' },
        { type: 'image', imageId: 'img_1', name: 'foto.jpg', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAA' },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const wires = buildWireMessages({ history: [], userMessage: withImage });
    expect(wires).toEqual([
      {
        role: 'user',
        content: 'mirá',
        images: [{ dataUrl: 'data:image/jpeg;base64,AAA', mime: 'image/jpeg', name: 'foto.jpg' }],
      },
    ]);

    const imagesOnly: ChatMessage = {
      ...withImage,
      id: 'u2',
      content: [
        { type: 'text', text: '   ' },
        { type: 'image', imageId: 'img_1', name: 'foto.jpg', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAA' },
      ],
    };
    const wiresOnly = buildWireMessages({ history: [], userMessage: imagesOnly });
    expect(wiresOnly).toHaveLength(1);
    expect(wiresOnly[0]).toMatchObject({ role: 'user', content: '   ' });
  });

  it('con imagesSupported:false degrada a descriptor de texto sin campo images', () => {
    const withImage: ChatMessage = {
      id: 'u1',
      conversationId: 'c1',
      role: 'user',
      status: 'complete',
      content: [
        { type: 'text', text: '' },
        { type: 'image', imageId: 'img_1', name: 'foto.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAA' },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const wires = buildWireMessages({ history: [], userMessage: withImage }, { imagesSupported: false });
    expect(wires).toHaveLength(1);
    expect(wires[0]).not.toHaveProperty('images');
    expect(wires[0]).toMatchObject({
      role: 'user',
      content: '[imagen no soportada por este modelo: foto.png]',
    });
  });
});
