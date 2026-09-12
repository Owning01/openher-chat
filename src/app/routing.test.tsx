import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConversationsStoreProvider,
  createConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { setLocale } from '@/i18n';
import { MemoryConversationRepository, MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { AppRoutes, chatHref, parseRoute } from './routing';
import { createServices, ServicesProvider } from './services';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  setLocale('es');
});

describe('parseRoute', () => {
  it('resuelve chat, chat con id, settings, onboarding y valores desconocidos', () => {
    expect(parseRoute('')).toEqual({ name: 'chat', conversationId: null });
    expect(parseRoute('#/')).toEqual({ name: 'chat', conversationId: null });
    expect(parseRoute('#/chat')).toEqual({ name: 'chat', conversationId: null });
    expect(parseRoute('#/chat/abc')).toEqual({ name: 'chat', conversationId: 'abc' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/onboarding')).toEqual({ name: 'onboarding', conversationId: null });
    expect(parseRoute('#/otra')).toEqual({ name: 'chat', conversationId: null });
  });

  it('decodifica ids y tolera escapes inválidos', () => {
    expect(parseRoute('#/chat/a%20b')).toEqual({ name: 'chat', conversationId: 'a b' });
    expect(parseRoute('#/chat/%E0%A4%A')).toEqual({ name: 'chat', conversationId: '%E0%A4%A' });
  });
});

/** Las páginas reales (chat/settings/onboarding) requieren `useServices` y el store de conversaciones. */
function renderWithServices(ui: ReactElement) {
  const services = createServices({
    conversations: new MemoryConversationRepository(),
    settings: new MemorySettingsRepository(),
    keys: new MemoryKeyVault(),
  });
  const conversations = createConversationsStore(services.conversations);

  return render(
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={conversations}>{ui}</ConversationsStoreProvider>
    </ServicesProvider>,
  );
}

describe('AppRoutes', () => {
  it('#/chat/abc monta la página de chat con el id', async () => {
    window.location.hash = '#/chat/abc';
    renderWithServices(<AppRoutes />);

    expect(await screen.findByTestId('chat-page')).toHaveAttribute('data-conversation-id', 'abc');
  });

  it('#/settings renderiza la página de ajustes', async () => {
    window.location.hash = '#/settings';
    renderWithServices(<AppRoutes />);

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
  });

  it('#/onboarding renderiza el wizard', async () => {
    window.location.hash = '#/onboarding';
    renderWithServices(<AppRoutes />);

    expect(await screen.findByTestId('onboarding-wizard')).toBeInTheDocument();
  });

  it('sin hash monta la página de chat sin id', async () => {
    renderWithServices(<AppRoutes />);

    expect(await screen.findByTestId('chat-page')).toHaveAttribute('data-conversation-id', '');
  });
});

describe('chatHref', () => {
  it('construye rutas de chat y codifica el id', () => {
    expect(chatHref()).toBe('#/chat');
    expect(chatHref(null)).toBe('#/chat');
    expect(chatHref('id 1')).toBe('#/chat/id%201');
  });
});
