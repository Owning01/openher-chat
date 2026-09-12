import { describe, expect, it } from 'vitest';

import type { Conversation } from '@/domain/types/conversation';
import { MemoryConversationRepository } from '@/test/fakes/MemoryRepos';

import { createConversationsStore, filterConversations, sortConversationsByUpdatedAt } from './conversationsStore';

function makeConversation(id: string, updatedAt: number, createdAt = updatedAt): Conversation {
  return {
    id,
    title: id,
    createdAt,
    updatedAt,
    providerId: null,
    modelId: null,
    systemPromptOverride: null,
    researchMode: false,
    messageCount: 0,
    lastMessagePreview: '',
    status: 'active',
  };
}

function createHarness() {
  let seq = 0;
  let clock = 1000;
  const repo = new MemoryConversationRepository({ now: () => clock, newId: () => `c${++seq}` });
  const store = createConversationsStore(repo);
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { repo, store, advance };
}

class FailingListRepository extends MemoryConversationRepository {
  override async list(): Promise<Conversation[]> {
    throw new Error('IndexedDB caído');
  }
}

class FailingCreateRepository extends MemoryConversationRepository {
  override async create(): Promise<Conversation> {
    throw new Error('cuota agotada');
  }
}

class FailingUpdateRepository extends MemoryConversationRepository {
  override async update(): Promise<Conversation> {
    throw new Error('sin permiso');
  }
}

/** `list()` captura el snapshot antes de liberar el gate: simula un refresh lento. */
class GatedListRepository extends MemoryConversationRepository {
  private releaseGate: () => void = () => undefined;
  private readonly gate: Promise<void>;

  constructor() {
    super();
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
  }

  override async list(): Promise<Conversation[]> {
    const snapshot = await super.list();
    await this.gate;
    return snapshot;
  }

  release(): void {
    this.releaseGate();
  }
}

describe('conversationsStore', () => {
  it('carga y ordena por updatedAt descendente', async () => {
    const { repo, store, advance } = createHarness();
    const first = await repo.create({ title: 'Primera' });
    advance(10);
    const second = await repo.create({ title: 'Segunda' });
    advance(10);
    await repo.update(first.id, { title: 'Primera' });

    await store.getState().load();

    expect(store.getState().status).toBe('ready');
    expect(store.getState().items.map((conversation) => conversation.id)).toEqual([first.id, second.id]);
  });

  it('crea, selecciona, persiste y limpia la búsqueda', async () => {
    const { repo, store } = createHarness();
    await store.getState().load();
    store.getState().setQuery('algo');

    const created = await store.getState().create({ title: 'Nueva' });

    expect(created).not.toBeNull();
    if (created === null) return;
    expect(store.getState().items[0]?.id).toBe(created.id);
    expect(store.getState().activeId).toBe(created.id);
    expect(store.getState().query).toBe('');
    expect(await repo.get(created.id)).toEqual(created);
  });

  it('renombra de forma optimista y persiste el título', async () => {
    const { repo, store, advance } = createHarness();
    const first = await repo.create({ title: 'Vieja' });
    advance(10);
    await repo.create({ title: 'Otra' });
    await store.getState().load();
    advance(10);

    await store.getState().rename(first.id, 'Nueva');

    expect(store.getState().items[0]?.id).toBe(first.id);
    expect(store.getState().items[0]?.title).toBe('Nueva');
    expect((await repo.get(first.id))?.title).toBe('Nueva');
    expect(store.getState().error).toBeNull();
  });

  it('elimina y limpia la selección si era la conversación activa', async () => {
    const { repo, store } = createHarness();
    const created = await repo.create({ title: 'Descartable' });
    await store.getState().load();
    store.getState().select(created.id);

    const removed = await store.getState().remove(created.id);

    expect(removed).toBe(true);
    expect(store.getState().items).toHaveLength(0);
    expect(store.getState().activeId).toBeNull();
    expect(await repo.get(created.id)).toBeNull();
  });

  it('filtra por título sin distinguir mayúsculas ni espacios', async () => {
    const { repo, store } = createHarness();
    await repo.create({ title: 'Informe Mensual' });
    await repo.create({ title: 'Ideas' });
    await store.getState().load();

    store.getState().setQuery('  informe ');
    expect(store.getState().visible().map((conversation) => conversation.title)).toEqual(['Informe Mensual']);
    store.getState().setQuery('zzz');
    expect(store.getState().visible()).toHaveLength(0);
  });

  it('expone el fallo de carga sin crashear', async () => {
    const store = createConversationsStore(new FailingListRepository());

    await store.getState().load();

    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe('IndexedDB caído');
    expect(store.getState().items).toHaveLength(0);
  });

  it('no crea si la persistencia falla', async () => {
    const store = createConversationsStore(new FailingCreateRepository());

    const created = await store.getState().create();

    expect(created).toBeNull();
    expect(store.getState().items).toHaveLength(0);
    expect(store.getState().error).toBe('cuota agotada');
  });

  it('revierte el renombrado si la persistencia falla', async () => {
    const repo = new FailingUpdateRepository({ now: () => 1000, newId: () => 'c1' });
    const store = createConversationsStore(repo);
    const created = await repo.create({ title: 'Original' });
    await store.getState().load();

    await store.getState().rename(created.id, 'Cambiada');

    expect(store.getState().items[0]?.title).toBe('Original');
    expect(store.getState().error).toBe('sin permiso');
  });

  it('un snapshot obsoleto no reinserta una conversación borrada (carrera refresh/delete)', async () => {
    const repo = new GatedListRepository();
    const store = createConversationsStore(repo);
    const created = await repo.create({ title: 'Descartable' });

    const loading = store.getState().load();
    const removed = await store.getState().remove(created.id);
    expect(removed).toBe(true);

    repo.release();
    await loading;

    expect(store.getState().items.some((conversation) => conversation.id === created.id)).toBe(false);
    expect(store.getState().status).toBe('ready');
  });

  it('merge refleja preview y contador sin duplicar ni recargar', async () => {
    const { repo, store } = createHarness();
    const created = await repo.create({ title: 'Chat' });
    await store.getState().load();

    const updated = await repo.update(created.id, { messageCount: 3, lastMessagePreview: 'hola mundo' });
    store.getState().merge(updated);
    expect(store.getState().items[0]?.messageCount).toBe(3);
    expect(store.getState().items[0]?.lastMessagePreview).toBe('hola mundo');

    store.getState().merge(updated);
    expect(store.getState().items).toHaveLength(1);

    const second = await repo.create({ title: 'Otra' });
    store.getState().merge(second);
    expect(store.getState().items.map((conversation) => conversation.id).sort()).toEqual(
      [created.id, second.id].sort(),
    );
  });
});

describe('helpers de conversaciones', () => {
  it('sortConversationsByUpdatedAt ordena descendente con desempate por id', () => {
    const items = [makeConversation('b', 10), makeConversation('a', 10), makeConversation('c', 20)];
    expect(sortConversationsByUpdatedAt(items).map((conversation) => conversation.id)).toEqual(['c', 'a', 'b']);
  });

  it('filterConversations devuelve copia sin query y filtra por título', () => {
    const items = [makeConversation('uno', 1), makeConversation('dos', 2)];
    expect(filterConversations(items, '  ')).toHaveLength(2);
    expect(filterConversations(items, 'DO')).toEqual([items[1]]);
  });
});
