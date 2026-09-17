import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationsStoreProvider,
  createConversationsStore,
} from '@/features/conversations/state/conversationsStore';
import { setLocale } from '@/i18n';
import {
  MemoryConversationRepository,
  MemoryKeyVault,
  MemoryLegalCaseRepository,
  MemorySettingsRepository,
} from '@/test/fakes/MemoryRepos';

import { AppShell } from './layout/AppShell';
import { AppRoutes, chatHref, LazyRoute, lazyWithRetry, legalHref, parseRoute } from './routing';
import { createServices, ServicesProvider } from './services';
import type { CreateServicesOverrides } from './services';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  setLocale('es');
  sessionStorage.clear();
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

  it('resuelve #/login como entrada pública', () => {
    expect(parseRoute('#/login')).toEqual({ name: 'login', conversationId: null });
    expect(parseRoute('#/login/')).toEqual({ name: 'login', conversationId: null });
  });

  it('decodifica ids y tolera escapes inválidos', () => {
    expect(parseRoute('#/chat/a%20b')).toEqual({ name: 'chat', conversationId: 'a b' });
    expect(parseRoute('#/chat/%E0%A4%A')).toEqual({ name: 'chat', conversationId: '%E0%A4%A' });
  });

  it('resuelve la ruta legal con y sin ids', () => {
    expect(parseRoute('#/legal')).toEqual({ name: 'legal', caseId: null, conversationId: null });
    expect(parseRoute('#/legal/')).toEqual({ name: 'legal', caseId: null, conversationId: null });
    expect(parseRoute('#/legal/case-1')).toEqual({ name: 'legal', caseId: 'case-1', conversationId: null });
    expect(parseRoute('#/legal/case%201')).toEqual({ name: 'legal', caseId: 'case 1', conversationId: null });
    expect(parseRoute('#/legal/case-1/conv-2')).toEqual({
      name: 'legal',
      caseId: 'case-1',
      conversationId: 'conv-2',
    });
    expect(parseRoute('#/legal?conversationId=conv-2')).toEqual({
      name: 'legal',
      caseId: null,
      conversationId: 'conv-2',
    });
    expect(parseRoute('#/legal/case-1?conversationId=conv-2')).toEqual({
      name: 'legal',
      caseId: 'case-1',
      conversationId: 'conv-2',
    });
  });

  it('el hash desconocido sigue cayendo a #/chat', () => {
    expect(parseRoute('#/otra')).toEqual({ name: 'chat', conversationId: null });
    expect(parseRoute('#/legal-extra')).toEqual({ name: 'chat', conversationId: null });
  });
});

/** Las páginas reales (chat/settings/onboarding) requieren `useServices` y el store de conversaciones. */
function renderWithServices(ui: ReactElement, overrides: CreateServicesOverrides = {}) {
  const services = createServices({
    conversations: new MemoryConversationRepository(),
    settings: new MemorySettingsRepository(),
    keys: new MemoryKeyVault(),
    ...overrides,
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

    // La página entra por `React.lazy`: con la suite en paralelo la carga del
    // chunk supera el timeout por defecto de `findBy` (1s) en máquinas lentas.
    expect(await screen.findByTestId('onboarding-wizard', undefined, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('sin hash monta la página de chat sin id', async () => {
    renderWithServices(<AppRoutes />);

    expect(await screen.findByTestId('chat-page')).toHaveAttribute('data-conversation-id', '');
  });

  it('#/legal monta la página de expedientes', async () => {
    window.location.hash = '#/legal';
    renderWithServices(<AppRoutes />, { legalCases: new MemoryLegalCaseRepository() });

    expect(await screen.findByTestId('legal-page')).toBeInTheDocument();
  });

  it('#/legal/:caseId monta la página de expedientes con el detalle', async () => {
    const legalCases = new MemoryLegalCaseRepository();
    const created = await legalCases.create({
      title: 'Caso ruteado',
      jurisdiction: 'national',
      court: '',
      matter: 'civil',
      clientRole: 'plaintiff',
    });
    window.location.hash = `#/legal/${created.id}`;
    renderWithServices(<AppRoutes />, { legalCases });

    expect(await screen.findByTestId('legal-page')).toBeInTheDocument();
    // `waitFor` re-consulta: el chunk diferido puede montar y volver a
    // renderizar (el nodo hallado por `findBy` queda desprendido).
    await waitFor(() => expect(screen.getByTestId('legal-detail')).toBeInTheDocument(), {
      timeout: 10_000,
    });
  });
});

/**
 * Regresión: con una conversación abierta, el efecto de sincronización de URL
 * del chat devolvía el hash a `#/chat/:id` al entrar a Ajustes y la sección
 * nunca se abría (bug reportado desde v1.0.0).
 */
describe('AppRoutes - navegación del shell', () => {
  it('con una conversación abierta, Ajustes se abre y no vuelve al chat', async () => {
    const services = createServices({
      conversations: new MemoryConversationRepository(),
      settings: new MemorySettingsRepository(),
      keys: new MemoryKeyVault(),
    });
    const conversation = await services.conversations.create({ title: 'Charla' });
    const conversations = createConversationsStore(services.conversations);
    window.location.hash = `#/chat/${conversation.id}`;

    render(
      <ServicesProvider services={services}>
        <ConversationsStoreProvider store={conversations}>
          <AppShell>
            <AppRoutes />
          </AppShell>
        </ConversationsStoreProvider>
      </ServicesProvider>,
    );

    expect(await screen.findByTestId('chat-page')).toHaveAttribute(
      'data-conversation-id',
      conversation.id,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    expect(screen.queryByTestId('chat-page')).not.toBeInTheDocument();
  });
});

describe('chatHref', () => {
  it('construye rutas de chat y codifica el id', () => {
    expect(chatHref()).toBe('#/chat');
    expect(chatHref(null)).toBe('#/chat');
    expect(chatHref('id 1')).toBe('#/chat/id%201');
  });
});

describe('lazyWithRetry', () => {
  it('una carga exitosa limpia el flag de reintento y no recarga', async () => {
    sessionStorage.setItem('openher.chunk-retry.test-ok', '1');
    const reload = vi.fn();
    const Lazy = lazyWithRetry(
      'test-ok',
      async () => ({ default: () => <div>contenido ok</div> }),
      reload,
    );

    render(
      <Suspense fallback={<span>cargando</span>}>
        <Lazy />
      </Suspense>,
    );

    expect(await screen.findByText('contenido ok')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('openher.chunk-retry.test-ok')).toBeNull();
  });

  it('el primer fallo de chunk recarga una vez y deja el fallback visible', async () => {
    sessionStorage.removeItem('openher.chunk-retry.test-fail');
    const reload = vi.fn();
    const Lazy = lazyWithRetry(
      'test-fail',
      async () => {
        throw new Error('chunk 404');
      },
      reload,
    );

    render(
      <Suspense fallback={<span>cargando</span>}>
        <Lazy />
      </Suspense>,
    );

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('openher.chunk-retry.test-fail')).toBe('1');
    expect(screen.getByText('cargando')).toBeInTheDocument();
  });

  it('con el reintento ya usado el borde muestra el error en vez del spinner eterno', async () => {
    sessionStorage.setItem('openher.chunk-retry.test-error', '1');
    const reload = vi.fn();
    const Lazy = lazyWithRetry(
      'test-error',
      async () => {
        throw new Error('chunk 404');
      },
      reload,
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <LazyRoute label="Ajustes">
        <Lazy />
      </LazyRoute>,
    );

    expect(await screen.findByTestId('route-error')).toBeInTheDocument();
    expect(screen.getByText('No se pudo abrir esta sección')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('legalHref', () => {
  it('construye rutas legales con y sin ids', () => {
    expect(legalHref()).toBe('#/legal');
    expect(legalHref(null)).toBe('#/legal');
    expect(legalHref('case 1')).toBe('#/legal/case%201');
    expect(legalHref('case-1', 'conv-2')).toBe('#/legal/case-1/conv-2');
    expect(legalHref(null, 'conv-2')).toBe('#/legal?conversationId=conv-2');
  });
});
