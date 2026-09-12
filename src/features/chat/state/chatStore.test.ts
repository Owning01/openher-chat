import { describe, expect, it, vi } from 'vitest';

import type { ChatHarness } from './__fixtures__/chatTestHarness';
import {
  assistantOf,
  createChatHarness,
  deferred,
  okTool,
  providerFailure,
  scriptFor,
  waitForAbort,
} from './__fixtures__/chatTestHarness';

async function startConversation(h: ChatHarness, options: { researchMode?: boolean } = {}): Promise<string> {
  const conversation = await h.repo.create({ title: '' });
  if (options.researchMode === true) await h.repo.update(conversation.id, { researchMode: true });
  await h.store.getState().load(conversation.id);
  return conversation.id;
}

describe('chatStore - send y streaming', () => {
  it('persiste el user al instante, refleja deltas y sella complete con usage', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);

    const gate = deferred();
    h.provider.scripts.push({
      events: [
        { type: 'start' },
        { type: 'text-delta', delta: 'Hola' },
        { type: 'text-delta', delta: ' mundo' },
        { type: 'usage', usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 } },
        { type: 'stop', reason: 'end_turn' },
      ],
      onEvent: async (_event, index) => {
        if (index === 2) await gate.promise;
      },
    });

    const run = h.store.getState().send('hola');

    await vi.waitFor(() => {
      expect(assistantOf(h.store).content).toEqual([{ type: 'text', text: 'Hola' }]);
    });
    expect(h.store.getState().runStatus).toBe('running');
    const persistedDuringRun = await h.repo.listMessages(conversationId);
    expect(persistedDuringRun.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(persistedDuringRun[0]?.status).toBe('complete');
    expect(persistedDuringRun[1]?.status).toBe('streaming');

    gate.resolve();
    await run;

    const assistant = assistantOf(h.store);
    expect(assistant.status).toBe('complete');
    expect(assistant.finishReason).toBe('complete');
    expect(assistant.content).toEqual([{ type: 'text', text: 'Hola mundo' }]);
    expect(assistant.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
    expect(h.store.getState().runStatus).toBe('idle');
    expect(h.store.getState().lastError).toBeNull();

    const request = h.provider.requests[0];
    expect(request?.modelId).toBe('model-1');
    expect(request?.system).toContain('Current date and time (UTC)');
    expect(request?.system).toContain('You are a helpful assistant.');
    expect(request?.messages).toEqual([
      { role: 'system', content: request?.system },
      { role: 'user', content: 'hola' },
    ]);
    expect(h.adapterConfigs[0]?.id).toBe('provider-1');

    const persisted = (await h.repo.listMessages(conversationId)).find((message) => message.role === 'assistant');
    expect(persisted?.status).toBe('complete');
    expect(persisted?.finishReason).toBe('complete');
    expect(persisted?.content).toEqual([{ type: 'text', text: 'Hola mundo' }]);
  });

  it('stop a mitad conserva el parcial y persiste aborted', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push({
      events: [
        { type: 'start' },
        { type: 'text-delta', delta: 'parcial' },
        { type: 'stop', reason: 'aborted' },
      ],
      onEvent: async (_event, index, signal) => {
        if (index === 2) await waitForAbort(signal);
      },
    });

    const run = h.store.getState().send('hola');
    await vi.waitFor(() => {
      expect(assistantOf(h.store).content).toEqual([{ type: 'text', text: 'parcial' }]);
    });

    h.store.getState().stop();
    expect(h.store.getState().runStatus).toBe('stopping');
    await run;

    expect(h.store.getState().runStatus).toBe('idle');
    expect(h.store.getState().lastError).toBeNull();
    const assistant = assistantOf(h.store);
    expect(assistant.status).toBe('aborted');
    expect(assistant.finishReason).toBe('aborted');
    expect(assistant.content).toEqual([{ type: 'text', text: 'parcial' }]);

    const persisted = (await h.repo.listMessages(conversationId)).find((message) => message.role === 'assistant');
    expect(persisted?.status).toBe('aborted');
    expect(persisted?.finishReason).toBe('aborted');
    expect(persisted?.content).toEqual([{ type: 'text', text: 'parcial' }]);
  });

  it('mapea 429 a error retryable en lastError y en el mensaje', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push({
      events: [],
      throwBefore: providerFailure('rate_limit', { retryable: true, status: 429 }),
    });

    await h.store.getState().send('hola');

    expect(h.store.getState().runStatus).toBe('idle');
    expect(h.store.getState().lastError).toEqual({
      code: 'rate_limit',
      message: 'fake rate_limit',
      retryable: true,
    });
    const assistant = assistantOf(h.store);
    expect(assistant.status).toBe('error');
    expect(assistant.finishReason).toBe('error');
    expect(assistant.error).toEqual(h.store.getState().lastError);

    const persisted = (await h.repo.listMessages(conversationId)).find((message) => message.role === 'assistant');
    expect(persisted?.status).toBe('error');
    expect(persisted?.finishReason).toBe('error');
    expect(persisted?.error?.code).toBe('rate_limit');
  });

  it('mantiene los checkpoints de streaming throttleados a >= 1s', async () => {
    const h = createChatHarness();
    await startConversation(h);
    h.provider.scripts.push({
      events: [
        { type: 'start' },
        { type: 'text-delta', delta: 'a' },
        { type: 'text-delta', delta: 'b' },
        { type: 'text-delta', delta: 'c' },
        { type: 'text-delta', delta: 'd' },
        { type: 'stop', reason: 'end_turn' },
      ],
      onEvent: () => {
        h.advance(300);
      },
    });

    await h.store.getState().send('hola');

    const streaming = h.repo.updates.filter((update) => update.patch.status === 'streaming');
    expect(streaming).toHaveLength(1);
    expect(streaming[0]?.patch.content).toEqual([{ type: 'text', text: 'abc' }]);
    const final = h.repo.updates.at(-1);
    expect(final?.patch.status).toBe('complete');
    expect(final?.patch.finishReason).toBe('complete');
  });

  it('bloquea un segundo send mientras hay un run activo', async () => {
    const h = createChatHarness();
    await startConversation(h);
    const gate = deferred();
    h.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'uno' }, { type: 'stop', reason: 'end_turn' }],
      onEvent: async (_event, index) => {
        if (index === 1) await gate.promise;
      },
    });
    h.provider.scripts.push(scriptFor('dos'));

    const first = h.store.getState().send('primero');
    await vi.waitFor(() => {
      expect(h.provider.requests).toHaveLength(1);
      expect(h.store.getState().runStatus).toBe('running');
    });

    await h.store.getState().send('segundo');
    expect(h.provider.requests).toHaveLength(1);
    expect(h.store.getState().messages.filter((message) => message.role === 'user')).toHaveLength(1);

    gate.resolve();
    await first;
    await h.store.getState().send('segundo');

    expect(h.provider.requests).toHaveLength(2);
    expect(h.store.getState().messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(h.store.getState().runStatus).toBe('idle');
  });

  it('reclama el turno en el mismo tick: doble send = 1 request, 1 user, 1 conversación y 1 assistant', async () => {
    const h = createChatHarness();
    h.provider.scripts.push(scriptFor('uno'));
    h.provider.scripts.push(scriptFor('dos'));

    const first = h.store.getState().send('primero');
    const second = h.store.getState().send('segundo');
    await Promise.all([first, second]);

    expect(h.provider.requests).toHaveLength(1);
    expect(h.provider.requests[0]?.messages.at(-1)).toEqual({ role: 'user', content: 'primero' });

    const users = h.store.getState().messages.filter((message) => message.role === 'user');
    const assistants = h.store.getState().messages.filter((message) => message.role === 'assistant');
    expect(users).toHaveLength(1);
    expect(assistants).toHaveLength(1);

    const conversations = await h.repo.list();
    expect(conversations).toHaveLength(1);
    const persisted = await h.repo.listMessages(conversations[0]?.id ?? '');
    expect(persisted.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(h.store.getState().runStatus).toBe('idle');
  });

  it('deriva el título de los primeros 48 chars del primer user', async () => {
    const h = createChatHarness();
    h.provider.scripts.push(scriptFor('ok'));
    const longText = 'x'.repeat(60);

    await h.store.getState().send(longText);

    const conversationId = h.store.getState().conversationId;
    expect(conversationId).not.toBeNull();
    if (conversationId === null) return;
    const conversation = await h.repo.get(conversationId);
    expect(conversation?.title).toBe(longText.slice(0, 48));
    expect(conversation?.title).toHaveLength(48);
  });

  it('sin proveedor no crea assistant y reporta error de configuracion', async () => {
    const h = createChatHarness({ providers: [] });
    const conversationId = await startConversation(h);

    await h.store.getState().send('hola');

    expect(h.store.getState().lastError?.code).toBe('invalid_request');
    expect(h.store.getState().lastError?.retryable).toBe(false);
    expect(h.store.getState().runStatus).toBe('idle');
    const messages = await h.repo.listMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(h.store.getState().messages).toHaveLength(1);
  });
});

describe('chatStore - runAgent con tools', () => {
  it('refleja tool-calls y pasos en vivo desde AgentEvent', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = true;
    h.tools.add(okTool('web_search', 'resultados'));
    const conversationId = await startConversation(h, { researchMode: true });

    h.provider.scripts.push(
      {
        events: [
          { type: 'tool-call', toolCall: { id: 'call-1', name: 'web_search', argumentsText: '{"query":"x"}' } },
          { type: 'stop', reason: 'tool_use' },
        ],
      },
      {
        events: [{ type: 'text-delta', delta: 'listo' }, { type: 'stop', reason: 'end_turn' }],
      },
    );

    await h.store.getState().send('busca');

    const steps = h.store.getState().liveSteps;
    expect(steps).toHaveLength(2);
    expect(steps[0]?.status).toBe('complete');
    expect(steps[0]?.toolCalls.map((toolCall) => toolCall.name)).toEqual(['web_search']);
    expect(steps[0]?.toolResults).toHaveLength(1);
    expect(steps[1]?.text).toBe('listo');

    const assistant = assistantOf(h.store);
    expect(assistant.status).toBe('complete');
    expect(assistant.content.map((block) => block.type)).toEqual(['tool-call', 'tool-result', 'text']);

    const persisted = (await h.repo.listMessages(conversationId)).find((message) => message.role === 'assistant');
    expect(persisted?.content.map((block) => block.type)).toEqual(['tool-call', 'tool-result', 'text']);
  });
});

describe('chatStore - regenerar, editar y borrar', () => {
  it('regenerate trunca desde el assistant y reusa el historial previo', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push(scriptFor('uno'));
    await h.store.getState().send('primera');
    h.provider.scripts.push(scriptFor('dos'));
    await h.store.getState().send('segunda');

    const previousVersion = assistantOf(h.store);
    h.provider.scripts.push(scriptFor('tres'));
    await h.store.getState().regenerate(previousVersion.id);

    expect(h.provider.requests).toHaveLength(3);
    expect(h.provider.requests[2]?.messages).toContainEqual({ role: 'assistant', content: 'uno' });
    expect(h.provider.requests[2]?.messages.at(-1)).toEqual({ role: 'user', content: 'segunda' });

    const messages = await h.repo.listMessages(conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[3]?.id).not.toBe(previousVersion.id);
    expect(messages[3]?.content).toEqual([{ type: 'text', text: 'tres' }]);
    expect(h.store.getState().messages).toHaveLength(4);
    expect(h.store.getState().runStatus).toBe('idle');
  });

  it('editUserMessage borra descendientes y reenvía el texto corregido', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push(scriptFor('uno'));
    await h.store.getState().send('primera');
    h.provider.scripts.push(scriptFor('dos'));
    await h.store.getState().send('segunda');

    const firstUser = h.store.getState().messages[0];
    expect(firstUser?.role).toBe('user');
    if (firstUser === undefined) return;

    h.provider.scripts.push(scriptFor('respuesta'));
    await h.store.getState().editUserMessage(firstUser.id, 'corregida');

    expect(h.provider.requests).toHaveLength(3);
    expect(h.provider.requests[2]?.messages.at(-1)).toEqual({ role: 'user', content: 'corregida' });

    const messages = await h.repo.listMessages(conversationId);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toEqual([{ type: 'text', text: 'corregida' }]);
    expect(messages[1]?.content).toEqual([{ type: 'text', text: 'respuesta' }]);
    expect((await h.repo.get(conversationId))?.title).toBe('corregida');
  });

  it('retryLast reintenta el último assistant fallido', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push({
      events: [],
      throwBefore: providerFailure('rate_limit', { retryable: true, status: 429 }),
    });
    await h.store.getState().send('hola');
    expect(assistantOf(h.store).status).toBe('error');

    h.provider.scripts.push(scriptFor('recuperado'));
    await h.store.getState().retryLast();

    expect(h.provider.requests).toHaveLength(2);
    expect(h.provider.requests[1]?.messages.at(-1)).toEqual({ role: 'user', content: 'hola' });
    expect(h.store.getState().lastError).toBeNull();
    const assistant = assistantOf(h.store);
    expect(assistant.status).toBe('complete');
    expect(assistant.finishReason).toBe('complete');

    const messages = await h.repo.listMessages(conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.content).toEqual([{ type: 'text', text: 'recuperado' }]);
  });

  it('deleteMessage elimina el mensaje y sus descendientes', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push(scriptFor('uno'));
    await h.store.getState().send('primera');
    h.provider.scripts.push(scriptFor('dos'));
    await h.store.getState().send('segunda');

    const firstUser = h.store.getState().messages[0];
    if (firstUser === undefined) return;
    await h.store.getState().deleteMessage(firstUser.id);

    expect(h.store.getState().messages).toHaveLength(0);
    expect(await h.repo.listMessages(conversationId)).toHaveLength(0);
  });

  it('sincroniza preview (sin markdown) y messageCount al enviar y borrar, notificando a la lista', async () => {
    const published: Array<{ id: string; messageCount: number; lastMessagePreview: string }> = [];
    const h = createChatHarness({ onConversationUpdated: (conversation) => published.push(conversation) });
    const conversationId = await startConversation(h);
    h.provider.scripts.push({
      events: [{ type: 'text-delta', delta: '**Hola** `mundo`' }, { type: 'stop', reason: 'end_turn' }],
    });

    await h.store.getState().send('pregunta');

    const conversation = await h.repo.get(conversationId);
    expect(conversation?.messageCount).toBe(2);
    expect(conversation?.lastMessagePreview).toBe('Hola mundo');
    expect(published.at(-1)?.id).toBe(conversationId);
    expect(published.at(-1)?.messageCount).toBe(2);
    expect(published.at(-1)?.lastMessagePreview).toBe('Hola mundo');

    const user = h.store.getState().messages[0];
    if (user === undefined) return;
    await h.store.getState().deleteMessage(user.id);

    const emptied = await h.repo.get(conversationId);
    expect(emptied?.messageCount).toBe(0);
    expect(emptied?.lastMessagePreview).toBe('');
  });

  it('refresca el resumen al regenerar y al editar, y acota el preview a 120 code points', async () => {
    const h = createChatHarness();
    const conversationId = await startConversation(h);
    h.provider.scripts.push(scriptFor('uno'));
    await h.store.getState().send('primera');
    h.provider.scripts.push(scriptFor('dos'));
    await h.store.getState().send('segunda');

    const lastAssistant = assistantOf(h.store);
    h.provider.scripts.push(scriptFor('x'.repeat(200)));
    await h.store.getState().regenerate(lastAssistant.id);

    const regenerated = await h.repo.get(conversationId);
    expect(regenerated?.messageCount).toBe(4);
    expect(regenerated?.lastMessagePreview).toHaveLength(120);
    expect(regenerated?.lastMessagePreview.endsWith('…')).toBe(true);

    const firstUser = h.store.getState().messages[0];
    if (firstUser === undefined) return;
    h.provider.scripts.push(scriptFor('cuatro'));
    await h.store.getState().editUserMessage(firstUser.id, 'corregida');

    const edited = await h.repo.get(conversationId);
    expect(edited?.messageCount).toBe(2);
    expect(edited?.lastMessagePreview).toBe('cuatro');
  });
});
