import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createServices, ServicesProvider } from '@/app/services';
import { setLocale, t } from '@/i18n';
import { MemoryConversationRepository, MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';

import { ConversationsPanel } from './ConversationsPanel';
import { ConversationsStoreProvider, createConversationsStore } from './state/conversationsStore';

afterEach(() => {
  cleanup();
  setLocale('es');
  window.location.hash = '';
});

function renderPanel() {
  let seq = 0;
  let clock = 1000;
  const repo = new MemoryConversationRepository({ now: () => clock, newId: () => `c${++seq}` });
  const services = createServices({
    conversations: repo,
    settings: new MemorySettingsRepository(),
    keys: new MemoryKeyVault(),
  });
  const store = createConversationsStore(services.conversations);
  render(
    <ServicesProvider services={services}>
      <ConversationsStoreProvider store={store}>
        <ConversationsPanel />
      </ConversationsStoreProvider>
    </ServicesProvider>,
  );
  return {
    repo,
    store,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('ConversationsPanel', () => {
  it('lista, filtra por título y crea una conversación navegando a su ruta', async () => {
    const { repo, store, advance } = renderPanel();
    await repo.create({ title: 'Primera charla' });
    advance(10);
    await repo.create({ title: 'Segunda charla' });
    await store.getState().load();

    expect(await screen.findByText('Segunda charla')).toBeInTheDocument();
    expect(screen.getByText('Primera charla')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: t('conversations.searchLabel') }), {
      target: { value: 'segunda' },
    });
    await waitFor(() => {
      expect(screen.queryByText('Primera charla')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Segunda charla')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: t('conversations.searchLabel') }), {
      target: { value: 'zzz' },
    });
    await waitFor(() => {
      expect(screen.queryByText('Segunda charla')).not.toBeInTheDocument();
    });
    expect(screen.getByText(t('conversations.noResultsTitle'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t('conversations.clearSearch') }));
    await screen.findByText('Primera charla');

    advance(10);
    fireEvent.click(screen.getByRole('button', { name: t('conversations.new') }));

    await waitFor(() => {
      expect(store.getState().items).toHaveLength(3);
    });
    const created = store.getState().items[0];
    expect(created).toBeDefined();
    expect(window.location.hash).toBe(`#/chat/${created?.id}`);
  });

  it('renombra una conversación desde el diálogo', async () => {
    const { repo, store } = renderPanel();
    await repo.create({ title: 'Título viejo' });
    await store.getState().load();

    fireEvent.click(await screen.findByRole('button', { name: t('conversations.rename') }));
    const dialog = await screen.findByRole('dialog', { name: t('conversations.renameTitle') });
    const input = within(dialog).getByRole('textbox', { name: t('conversations.renameLabel') });
    fireEvent.change(input, { target: { value: 'Título nuevo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.save') }));

    await waitFor(() => {
      expect(screen.getByText('Título nuevo')).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await repo.list())[0]?.title).toBe('Título nuevo');
  });

  it('elimina una conversación tras confirmar', async () => {
    const { repo, store } = renderPanel();
    await repo.create({ title: 'Descartable' });
    await store.getState().load();

    fireEvent.click(await screen.findByRole('button', { name: t('conversations.delete') }));
    const dialog = await screen.findByRole('dialog', { name: t('conversations.deleteTitle') });
    expect(within(dialog).getByText(t('common.confirmDelete', { name: 'Descartable' }))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: t('conversations.delete') }));

    await waitFor(() => {
      expect(store.getState().items).toHaveLength(0);
    });
    expect(await repo.list()).toHaveLength(0);
    expect(screen.getByText(t('conversations.emptyTitle'))).toBeInTheDocument();
  });
});
