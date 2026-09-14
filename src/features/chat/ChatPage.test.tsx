import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/services';
import {
  ConversationsStoreProvider,
  createConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { PROVIDERS_STORAGE_KEY } from '@/features/settings/state/providerStorage';
import { setLocale } from '@/i18n';

import { ChatPage } from './ChatPage';
import { assistantMessage, userMessage } from './components/__fixtures__/messages';
import {
  createChatHarness,
  createProviderConfig,
  deferred,
  scriptFor,
  waitForAbort,
} from './state/__fixtures__/chatTestHarness';

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  localStorage.clear();
  setLocale('es');
});

function renderChatPage(services: AppServices) {
  const conversations = createConversationsStore(services.conversations);
  render(
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={conversations}>
        <ChatPage />
      </ConversationsStoreProvider>
    </ServicesProvider>,
  );
  return { conversations };
}

describe('ChatPage', () => {
  it('muestra el estado vacío con sugerencias y el composer', async () => {
    const harness = createChatHarness();
    renderChatPage(harness.services);

    const empty = await screen.findByTestId('chat-empty');
    expect(within(empty).getAllByRole('button')).toHaveLength(4);
    expect(screen.getByTestId('chat-composer')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-streaming-indicator')).not.toBeInTheDocument();
  });

  it('carga la conversación del router con título, mensajes y modelo', async () => {
    const harness = createChatHarness();
    const conversation = await harness.repo.create({ title: 'Mi chat' });
    await harness.repo.appendMessage(
      userMessage('m1', 'hola', { conversationId: conversation.id, createdAt: 1 }),
    );
    await harness.repo.appendMessage(
      assistantMessage('m2', [{ type: 'text', text: 'respuesta' }], {
        conversationId: conversation.id,
        modelId: 'model-1',
        createdAt: 2,
      }),
    );
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    expect(await screen.findByText('Mi chat')).toBeInTheDocument();
    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(await screen.findByText('respuesta')).toBeInTheDocument();
    expect(screen.getByText('model-1')).toBeInTheDocument();
  });

  it('envía desde el composer y sincroniza la URL con la conversación creada', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    harness.provider.scripts.push(scriptFor('respuesta del modelo'));
    renderChatPage(harness.services);

    const textarea = await screen.findByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'buenas' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(await screen.findByText('respuesta del modelo')).toBeInTheDocument();
    expect(within(screen.getByTestId('chat-message-list')).getByText('buenas')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/.+/));
    expect(harness.adapterConfigs.map((config) => config.id)).toContain('provider-1');
  });

  it('un doble click en una sugerencia corre un único turno y refresca el historial', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    harness.provider.scripts.push(scriptFor('respuesta única'));
    const { conversations } = renderChatPage(harness.services);

    const empty = await screen.findByTestId('chat-empty');
    const suggestion = within(empty).getAllByRole('button')[0];
    if (suggestion === undefined) throw new Error('missing suggestion');
    fireEvent.click(suggestion);
    fireEvent.click(suggestion);

    expect(await screen.findByText('respuesta única')).toBeInTheDocument();
    // El auto-título añade una llamada lateral (`toolChoice: none`); el turno es único.
    const turnRequests = harness.provider.requests.filter((request) => request.toolChoice !== 'none');
    expect(turnRequests).toHaveLength(1);
    expect(turnRequests[0]?.messages.at(-1)?.content).toBe(suggestion.textContent);

    const conversationsInRepo = await harness.repo.list();
    expect(conversationsInRepo).toHaveLength(1);
    const persisted = await harness.repo.listMessages(conversationsInRepo[0]?.id ?? '');
    expect(persisted.map((message) => message.role)).toEqual(['user', 'assistant']);

    await waitFor(() => {
      expect(conversations.getState().items.map((item) => item.id)).toEqual([conversationsInRepo[0]?.id]);
    });
  });

  it('aborta el run en vuelo al desmontar la página', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    harness.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'parcial' }, { type: 'stop', reason: 'aborted' }],
      onEvent: async (_event, index, signal) => {
        if (index === 1) await waitForAbort(signal);
      },
    });
    renderChatPage(harness.services);

    const textarea = await screen.findByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'hola' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(await screen.findByText('parcial')).toBeInTheDocument();

    cleanup();

    await waitFor(async () => {
      const [conversation] = await harness.repo.list();
      const messages = conversation === undefined ? [] : await harness.repo.listMessages(conversation.id);
      expect(messages.at(-1)?.status).toBe('aborted');
    });
  });

  it('refleja preview y messageCount en la lista durante el turno, sin recargar', async () => {
    const harness = createChatHarness();
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([createProviderConfig()]));
    const gate = deferred();
    harness.provider.scripts.push({
      events: [{ type: 'text-delta', delta: 'respuesta' }, { type: 'stop', reason: 'end_turn' }],
      onEvent: async (_event, index) => {
        if (index === 0) await gate.promise;
      },
    });
    const { conversations } = renderChatPage(harness.services);

    const textarea = await screen.findByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'buenas' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      const [item] = conversations.getState().items;
      expect(item?.lastMessagePreview).toBe('buenas');
      expect(item?.messageCount).toBe(1);
    });

    gate.resolve();
    expect(await screen.findByText('respuesta')).toBeInTheDocument();
  });

  it('cambia el modelo desde el chat y lo persiste en la conversación', async () => {
    const harness = createChatHarness();
    localStorage.setItem(
      PROVIDERS_STORAGE_KEY,
      JSON.stringify([
        createProviderConfig({
          models: [
            { id: 'model-1', label: 'Model 1', source: 'manual' },
            { id: 'model-2', label: 'Model 2', source: 'manual' },
          ],
          defaultModelId: 'model-1',
        }),
      ]),
    );
    const conversation = await harness.repo.create({ title: 'Mi chat' });
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    const select = await screen.findByRole('combobox', { name: 'Modelo' });
    expect(select).toHaveValue('0');
    fireEvent.change(select, { target: { value: '1' } });

    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.modelId).toBe('model-2');
    });
  });
});
