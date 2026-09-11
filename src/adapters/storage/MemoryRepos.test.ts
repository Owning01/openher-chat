import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/domain/settings/defaults';
import { MemoryConversationRepository, MemoryKeyVault, MemorySettingsRepository } from '@/test/fakes/MemoryRepos';
import { describeConversationRepositoryContract } from './conversationContract';

describeConversationRepositoryContract('MemoryConversationRepository', () => {
  let nowValue = 0;
  let idCounter = 0;
  const repo = new MemoryConversationRepository({
    newId: () => `conv-${(idCounter += 1)}`,
    now: () => nowValue,
  });
  return {
    repo,
    setNow: (value: number) => {
      nowValue = value;
    },
    reset: async () => {
      repo.clear();
    },
  };
});

describe('MemorySettingsRepository', () => {
  it('arranca con defaults y aísla las copias entregadas', async () => {
    const now = 1_700_000_000_000;
    const repo = new MemorySettingsRepository({ now: () => now });
    expect(await repo.load()).toEqual(createDefaultSettings(now));

    const loaded = await repo.load();
    loaded.locale = 'en';
    loaded.chat.temperature = 1.5;
    const stored = await repo.load();
    expect(stored.locale).toBe('es');
    expect(stored.chat.temperature).toBe(0.7);
  });

  it('save reemplaza el estado y load devuelve una copia', async () => {
    const now = 1_700_000_000_000;
    const repo = new MemorySettingsRepository({ now: () => now });
    const custom = createDefaultSettings(now + 1);
    custom.locale = 'en';
    await repo.save(custom);
    const loaded = await repo.load();
    expect(loaded).toEqual(custom);
    loaded.theme = 'light';
    expect((await repo.load()).theme).toBe('system');
  });

  it('acepta settings iniciales sin aliasar el objeto original', async () => {
    const initial = createDefaultSettings(42);
    initial.locale = 'en';
    const repo = new MemorySettingsRepository({ initial });
    initial.locale = 'es';
    expect((await repo.load()).locale).toBe('en');
  });
});

describe('MemoryKeyVault', () => {
  it('get/set/has/remove por ref', async () => {
    const vault = new MemoryKeyVault();
    expect(await vault.has('provider:groq')).toBe(false);
    expect(await vault.get('provider:groq')).toBeNull();
    await vault.set('provider:groq', 'sk-1');
    expect(await vault.has('provider:groq')).toBe(true);
    expect(await vault.get('provider:groq')).toBe('sk-1');
    await vault.remove('provider:groq');
    expect(await vault.has('provider:groq')).toBe(false);
    expect(await vault.get('provider:groq')).toBeNull();
  });

  it('clear vacía todos los secretos', async () => {
    const vault = new MemoryKeyVault();
    await vault.set('provider:groq', 'sk-1');
    await vault.set('search:brave', 'bs-1');
    vault.clear();
    expect(await vault.has('provider:groq')).toBe(false);
    expect(await vault.has('search:brave')).toBe(false);
  });
});

describe('clear de fakes', () => {
  it('MemoryConversationRepository.clear vacía conversaciones y mensajes', async () => {
    const repo = new MemoryConversationRepository();
    const conversation = await repo.create({ title: 'A' });
    await repo.appendMessage({
      id: 'm1',
      conversationId: conversation.id,
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'hola' }],
      createdAt: 1,
      updatedAt: 1,
    });
    repo.clear();
    expect(await repo.list()).toEqual([]);
    expect(await repo.listMessages(conversation.id)).toEqual([]);
  });

  it('MemorySettingsRepository.clear restaura los defaults', async () => {
    const repo = new MemorySettingsRepository({ now: () => 7 });
    const custom = createDefaultSettings(8);
    custom.locale = 'en';
    await repo.save(custom);
    repo.clear();
    expect(await repo.load()).toEqual(createDefaultSettings(7));
  });
});
