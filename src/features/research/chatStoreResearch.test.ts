import { describe, expect, it, vi } from 'vitest';

import type { AppSettings } from '@/domain/types/settings';
import type { ProviderConfig } from '@/domain/types/provider';
import type { ToolDefinition, ToolRegistry } from '@/domain/types/tools';
import { createChatStore } from '@/features/chat/state/chatStore';
import type { ChatHarness } from '@/features/chat/state/__fixtures__/chatTestHarness';
import {
  createChatHarness,
  createProviderConfig,
  deferred,
  okTool,
  scriptFor,
} from '@/features/chat/state/__fixtures__/chatTestHarness';

/** Store sobre el arnés, con un `createTools` espiado en `AppServices` (sin override de deps). */
function createResearchStore(
  h: ChatHarness,
  createTools?: (settings: AppSettings) => ToolRegistry,
  providers?: ProviderConfig[],
) {
  let sequence = 0;
  return createChatStore({
    services: createTools === undefined ? h.services : { ...h.services, createTools },
    conversations: h.repo,
    providers: { load: async () => providers ?? [createProviderConfig()] },
    clock: h.now,
    newId: () => `research-${(sequence += 1)}`,
  });
}

async function startResearchConversation(h: ChatHarness, enabled: boolean): Promise<string> {
  const conversation = await h.repo.create({ title: '' });
  if (enabled) await h.repo.update(conversation.id, { researchMode: true });
  return conversation.id;
}

describe('chatStore - wiring del modo investigación', () => {
  it('inyecta el registry de services y las tools al modelo solo con researchMode', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = true;
    h.tools.add(okTool('web_search', 'resultados'));
    const createTools = vi.fn((_settings: AppSettings) => h.tools);
    const store = createResearchStore(h, createTools);
    const conversationId = await startResearchConversation(h, true);

    await store.getState().load(conversationId);
    expect(store.getState().researchMode).toBe(true);

    h.provider.scripts.push(scriptFor('listo'));
    await store.getState().send('busca');

    expect(createTools).toHaveBeenCalledTimes(1);
    expect(createTools.mock.calls[0]?.[0]?.tools.webSearchEnabled).toBe(true);
    expect(h.provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['web_search']);
    expect(h.provider.requests[0]?.system).toContain('Research mode is enabled');
  });

  it('sin researchMode no crea registry ni envía tools al modelo', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = true;
    const createTools = vi.fn(() => h.tools);
    const store = createResearchStore(h, createTools);
    const conversationId = await startResearchConversation(h, false);

    await store.getState().load(conversationId);
    h.provider.scripts.push(scriptFor('hola'));
    await store.getState().send('hola');

    expect(createTools).not.toHaveBeenCalled();
    expect(h.provider.requests[0]?.tools).toBeUndefined();
    expect(h.provider.requests[0]?.system).not.toContain('Research mode is enabled');
  });

  it('con la búsqueda web deshabilitada en settings la investigación no se activa', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = true;
    const settings = await h.settings.load();
    await h.settings.save({ ...settings, tools: { ...settings.tools, webSearchEnabled: false } });
    const createTools = vi.fn(() => h.tools);
    const store = createResearchStore(h, createTools);
    const conversationId = await startResearchConversation(h, true);

    await store.getState().load(conversationId);
    h.provider.scripts.push(scriptFor('hola'));
    await store.getState().send('hola');

    expect(createTools).not.toHaveBeenCalled();
    expect(h.provider.requests[0]?.tools).toBeUndefined();
  });

  it('sin tool calling no envía tools ni anuncia research en el prompt', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = false;
    h.tools.add(okTool('web_search', 'resultados'));
    const createTools = vi.fn(() => h.tools);
    const store = createResearchStore(h, createTools, [
      createProviderConfig({
        models: [{ id: 'model-1', label: 'Model 1', source: 'manual', supportsTools: false }],
      }),
    ]);
    const conversationId = await startResearchConversation(h, true);

    await store.getState().load(conversationId);
    h.provider.scripts.push(scriptFor('hola'));
    await store.getState().send('hola');

    expect(createTools).not.toHaveBeenCalled();
    expect(h.provider.requests[0]?.tools).toBeUndefined();
    expect(h.provider.requests[0]?.system).not.toContain('Research mode is enabled');
  });

  it('oculta las tools si el adapter reporta toolCalling en false aunque el modelo lo soporte', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = false;
    const createTools = vi.fn(() => h.tools);
    const store = createResearchStore(h, createTools);
    const conversationId = await startResearchConversation(h, true);

    await store.getState().load(conversationId);
    h.provider.scripts.push(scriptFor('hola'));
    await store.getState().send('hola');

    expect(createTools).not.toHaveBeenCalled();
    expect(h.provider.requests[0]?.tools).toBeUndefined();
    expect(h.provider.requests[0]?.system).not.toContain('Research mode is enabled');
  });

  it('persiste el toggle en la conversación y en el pending del primer envío', async () => {
    const h = createChatHarness();
    const store = createResearchStore(h);
    const conversationId = await startResearchConversation(h, false);

    await store.getState().load(conversationId);
    await store.getState().setResearchMode(true);

    expect(store.getState().researchMode).toBe(true);
    expect((await h.repo.get(conversationId))?.researchMode).toBe(true);

    await store.getState().setResearchMode(false);
    expect((await h.repo.get(conversationId))?.researchMode).toBe(false);

    const fresh = createResearchStore(h);
    await fresh.getState().setResearchMode(true);
    expect(fresh.getState().researchMode).toBe(true);

    h.provider.scripts.push(scriptFor('hola'));
    await fresh.getState().send('hola');

    const createdId = fresh.getState().conversationId;
    expect(createdId).not.toBeNull();
    expect((await h.repo.get(createdId ?? ''))?.researchMode).toBe(true);
  });

  it('no activa ni persiste el toggle si la búsqueda web está deshabilitada', async () => {
    const h = createChatHarness();
    const settings = await h.settings.load();
    await h.settings.save({ ...settings, tools: { ...settings.tools, webSearchEnabled: false } });
    const store = createResearchStore(h);
    const conversationId = await startResearchConversation(h, false);

    await store.getState().load(conversationId);
    await store.getState().setResearchMode(true);

    expect(store.getState().researchMode).toBe(false);
    expect((await h.repo.get(conversationId))?.researchMode).toBe(false);
  });

  it('stop cancela el loop a mitad de una tool en curso y conserva el abort', async () => {
    const h = createChatHarness();
    h.provider.toolCalling = true;
    const started = deferred();
    let toolAborted = false;

    const waitingTool: ToolDefinition = {
      name: 'web_search',
      description: 'Waits until the run is aborted.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      timeoutMs: 60_000,
      maxResultChars: 4000,
      execute: (_args, context) => {
        started.resolve();
        return new Promise((resolve) => {
          const finish = (): void => {
            toolAborted = true;
            resolve({ ok: false, content: 'aborted', error: { code: 'timeout', message: 'aborted' }, durationMs: 0 });
          };
          if (context.signal.aborted) {
            finish();
            return;
          }
          context.signal.addEventListener('abort', finish, { once: true });
        });
      },
    };
    h.tools.add(waitingTool);

    const store = createResearchStore(h, () => h.tools);
    const conversationId = await startResearchConversation(h, true);
    await store.getState().load(conversationId);

    h.provider.scripts.push({
      events: [
        { type: 'tool-call', toolCall: { id: 'call-1', name: 'web_search', argumentsText: '{"query":"x"}' } },
        { type: 'stop', reason: 'tool_use' },
      ],
    });

    const run = store.getState().send('busca');
    await started.promise;
    expect(store.getState().runStatus).toBe('running');

    store.getState().stop();
    await run;

    expect(toolAborted).toBe(true);
    expect(store.getState().runStatus).toBe('idle');
    const assistant = store.getState().messages.find((message) => message.role === 'assistant');
    expect(assistant?.status).toBe('aborted');
    expect(assistant?.finishReason).toBe('aborted');
    const persisted = (await h.repo.listMessages(conversationId)).find((message) => message.role === 'assistant');
    expect(persisted?.status).toBe('aborted');
  });

  it('un toggle rápido true→false conserva la última acción (carrera del await)', async () => {
    const h = createChatHarness();
    const store = createResearchStore(h);
    const conversationId = await startResearchConversation(h, false);
    await store.getState().load(conversationId);

    const enabling = store.getState().setResearchMode(true);
    const disabling = store.getState().setResearchMode(false);
    await Promise.all([enabling, disabling]);

    expect(store.getState().researchMode).toBe(false);
    expect((await h.repo.get(conversationId))?.researchMode).toBe(false);
  });
});
