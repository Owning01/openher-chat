import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/services';
import { ChatPage } from '@/features/chat/ChatPage';
import {
  ConversationsStoreProvider,
  createConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { setLocale } from '@/i18n';

import { createChatHarness } from '@/features/chat/state/__fixtures__/chatTestHarness';

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
  render(
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={createConversationsStore(services.conversations)}>
        <ChatPage />
      </ConversationsStoreProvider>
    </ServicesProvider>,
  );
}

describe('ChatPage - modo investigación', () => {
  it('monta el panel en una conversación de investigación y el toggle persiste en el repo', async () => {
    const harness = createChatHarness();
    const conversation = await harness.repo.create({ title: 'Investigación' });
    await harness.repo.update(conversation.id, { researchMode: true });
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    expect(await screen.findByTestId('research-panel')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Investigación' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    await waitFor(async () => {
      expect((await harness.repo.get(conversation.id))?.researchMode).toBe(false);
    });
    await waitFor(() => expect(screen.queryByTestId('research-panel')).not.toBeInTheDocument());
  });

  it('deshabilita el toggle y explica el motivo cuando settings.tools no lo permite', async () => {
    const harness = createChatHarness();
    const settings = await harness.settings.load();
    await harness.settings.save({ ...settings, tools: { ...settings.tools, webSearchEnabled: false } });
    renderChatPage(harness.services);

    const toggle = await screen.findByRole('switch', { name: 'Investigación' });
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(screen.getByText('La búsqueda web está desactivada en Ajustes.')).toBeInTheDocument();
    expect(screen.queryByTestId('research-panel')).not.toBeInTheDocument();
  });

  it('muestra el aviso de configuración solo con el toggle de investigación activo', async () => {
    const harness = createChatHarness();
    const settings = await harness.settings.load();
    await harness.settings.save({ ...settings, search: { ...settings.search, mode: 'brave' } });
    const conversation = await harness.repo.create({ title: 'Investigación' });
    await harness.repo.update(conversation.id, { researchMode: true });
    window.location.hash = `#/chat/${conversation.id}`;
    renderChatPage(harness.services);

    const composer = await screen.findByTestId('chat-composer');
    expect(await within(composer).findByText(/Brave está seleccionado/)).toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: 'Investigación' });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);

    await waitFor(() => expect(within(composer).queryByText(/Brave está seleccionado/)).not.toBeInTheDocument());
    expect(screen.queryByTestId('research-panel')).not.toBeInTheDocument();
  });
});
