import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationRepository } from '@/domain/ports/ConversationRepository';
import type { ChatMessage, MessageStatus } from '@/domain/types/chat';

export interface ConversationRepositoryHarness {
  readonly repo: ConversationRepository;
  setNow(value: number): void;
  reset(): Promise<void>;
}

export type ConversationRepositoryHarnessFactory = () => ConversationRepositoryHarness | Promise<ConversationRepositoryHarness>;

/** Suite compartida entre `IndexedDbConversations` y el fake en memoria para garantizar paridad. */
export function describeConversationRepositoryContract(
  name: string,
  createHarness: ConversationRepositoryHarnessFactory,
): void {
  describe(name, () => {
    let harness: ConversationRepositoryHarness;

    beforeEach(async () => {
      harness = await createHarness();
      await harness.reset();
    });

    it('create devuelve una conversación válida con defaults', async () => {
      harness.setNow(1000);
      const created = await harness.repo.create({ title: 'Primera', providerId: 'groq', modelId: 'llama' });
      expect(created.id.length).toBeGreaterThan(0);
      expect(created).toEqual({
        id: created.id,
        title: 'Primera',
        createdAt: 1000,
        updatedAt: 1000,
        providerId: 'groq',
        modelId: 'llama',
        systemPromptOverride: null,
        researchMode: false,
        messageCount: 0,
        lastMessagePreview: '',
        status: 'active',
      });
      expect(await harness.repo.get(created.id)).toEqual(created);
    });

    it('create sin input deja nulls y título vacío', async () => {
      const created = await harness.repo.create();
      expect(created.providerId).toBeNull();
      expect(created.modelId).toBeNull();
      expect(created.title).toBe('');
    });

    it('get devuelve null para un id inexistente', async () => {
      expect(await harness.repo.get('nope')).toBeNull();
    });

    it('list ordena por updatedAt descendente', async () => {
      harness.setNow(100);
      const first = await harness.repo.create({ title: 'A' });
      harness.setNow(200);
      const second = await harness.repo.create({ title: 'B' });
      harness.setNow(300);
      const third = await harness.repo.create({ title: 'C' });
      harness.setNow(400);
      await harness.repo.update(first.id, { title: 'A2' });
      const list = await harness.repo.list();
      expect(list.map((conversation) => conversation.id)).toEqual([first.id, third.id, second.id]);
    });

    it('update fusiona el patch y bumpea updatedAt sin tocar createdAt', async () => {
      harness.setNow(100);
      const created = await harness.repo.create({ title: 'A' });
      harness.setNow(500);
      const updated = await harness.repo.update(created.id, { title: 'B', researchMode: true });
      expect(updated.title).toBe('B');
      expect(updated.researchMode).toBe(true);
      expect(updated.createdAt).toBe(100);
      expect(updated.updatedAt).toBe(500);
      expect(await harness.repo.get(created.id)).toEqual(updated);
    });

    it('update lanza si la conversación no existe', async () => {
      await expect(harness.repo.update('nope', { title: 'X' })).rejects.toThrow();
    });

    it('remove elimina la conversación y sus mensajes (cascada)', async () => {
      const a = await harness.repo.create({ title: 'A' });
      const b = await harness.repo.create({ title: 'B' });
      await harness.repo.appendMessage(makeMessage('a1', a.id, 1));
      await harness.repo.appendMessage(makeMessage('a2', a.id, 2));
      await harness.repo.appendMessage(makeMessage('b1', b.id, 3));
      await harness.repo.remove(a.id);
      expect(await harness.repo.get(a.id)).toBeNull();
      expect(await harness.repo.listMessages(a.id)).toEqual([]);
      expect((await harness.repo.listMessages(b.id)).map((message) => message.id)).toEqual(['b1']);
    });

    it('listMessages ordena por createdAt ascendente y filtra por conversación', async () => {
      const a = await harness.repo.create({ title: 'A' });
      const b = await harness.repo.create({ title: 'B' });
      await harness.repo.appendMessage(makeMessage('a2', a.id, 20));
      await harness.repo.appendMessage(makeMessage('a1', a.id, 10));
      await harness.repo.appendMessage(makeMessage('b1', b.id, 5));
      expect((await harness.repo.listMessages(a.id)).map((message) => message.id)).toEqual(['a1', 'a2']);
      expect((await harness.repo.listMessages(b.id)).map((message) => message.id)).toEqual(['b1']);
    });

    it('listMessages desempata por id cuando createdAt coincide', async () => {
      const a = await harness.repo.create({ title: 'A' });
      await harness.repo.appendMessage(makeMessage('m2', a.id, 10));
      await harness.repo.appendMessage(makeMessage('m3', a.id, 10));
      await harness.repo.appendMessage(makeMessage('m1', a.id, 10));
      expect((await harness.repo.listMessages(a.id)).map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('appendMessage solo escribe el mensaje sin tocar la conversación', async () => {
      harness.setNow(100);
      const conversation = await harness.repo.create({ title: 'A' });
      await harness.repo.appendMessage(makeMessage('m1', conversation.id, 1));
      const reloaded = await harness.repo.get(conversation.id);
      expect(reloaded?.messageCount).toBe(0);
      expect(reloaded?.updatedAt).toBe(100);
      expect(await harness.repo.listMessages(conversation.id)).toHaveLength(1);
    });

    it('updateMessage fusiona el patch', async () => {
      const conversation = await harness.repo.create({ title: 'A' });
      await harness.repo.appendMessage(makeMessage('m1', conversation.id, 1, 'streaming'));
      await harness.repo.updateMessage('m1', { status: 'complete', finishReason: 'complete', updatedAt: 99 });
      const [message] = await harness.repo.listMessages(conversation.id);
      expect(message?.status).toBe('complete');
      expect(message?.finishReason).toBe('complete');
      expect(message?.updatedAt).toBe(99);
      expect(message?.content).toEqual([{ type: 'text', text: 'texto de m1' }]);
    });

    it('deleteMessagesFrom borra el mensaje indicado y los posteriores de esa conversación', async () => {
      const a = await harness.repo.create({ title: 'A' });
      const b = await harness.repo.create({ title: 'B' });
      await harness.repo.appendMessage(makeMessage('a1', a.id, 1));
      await harness.repo.appendMessage(makeMessage('a2', a.id, 2));
      await harness.repo.appendMessage(makeMessage('a3', a.id, 3));
      await harness.repo.appendMessage(makeMessage('b1', b.id, 2));
      await harness.repo.deleteMessagesFrom(a.id, 'a2');
      expect((await harness.repo.listMessages(a.id)).map((message) => message.id)).toEqual(['a1']);
      expect((await harness.repo.listMessages(b.id)).map((message) => message.id)).toEqual(['b1']);
    });

    it('deleteMessagesFrom es no-op con un mensaje desconocido o de otra conversación', async () => {
      const a = await harness.repo.create({ title: 'A' });
      const b = await harness.repo.create({ title: 'B' });
      await harness.repo.appendMessage(makeMessage('b1', b.id, 1));
      await harness.repo.deleteMessagesFrom(a.id, 'b1');
      await harness.repo.deleteMessagesFrom(a.id, 'missing');
      expect((await harness.repo.listMessages(b.id)).map((message) => message.id)).toEqual(['b1']);
    });

    it('deleteMessagesFrom con createdAt empatado respeta el orden (createdAt, id)', async () => {
      const a = await harness.repo.create({ title: 'A' });
      const b = await harness.repo.create({ title: 'B' });
      await harness.repo.appendMessage(makeMessage('a1', a.id, 5));
      await harness.repo.appendMessage(makeMessage('a2', a.id, 10));
      await harness.repo.appendMessage(makeMessage('a3', a.id, 10));
      await harness.repo.appendMessage(makeMessage('a4', a.id, 10));
      await harness.repo.appendMessage(makeMessage('b2', b.id, 10));
      await harness.repo.deleteMessagesFrom(a.id, 'a3');
      expect((await harness.repo.listMessages(a.id)).map((message) => message.id)).toEqual(['a1', 'a2']);
      expect((await harness.repo.listMessages(b.id)).map((message) => message.id)).toEqual(['b2']);
    });

    it('recoverInterrupted pasa streaming a aborted, conserva el texto y devuelve ids únicos', async () => {
      const a = await harness.repo.create({ title: 'A' });
      const b = await harness.repo.create({ title: 'B' });
      await harness.repo.appendMessage(makeMessage('a1', a.id, 1, 'streaming'));
      await harness.repo.appendMessage(makeMessage('a2', a.id, 2, 'complete'));
      await harness.repo.appendMessage(makeMessage('b1', b.id, 3, 'streaming'));
      const affected = await harness.repo.recoverInterrupted();
      expect([...affected].sort()).toEqual([a.id, b.id].sort());
      const a1 = (await harness.repo.listMessages(a.id)).find((message) => message.id === 'a1');
      expect(a1?.status).toBe('aborted');
      expect(a1?.finishReason).toBe('aborted');
      expect(a1?.content).toEqual([{ type: 'text', text: 'texto de a1' }]);
      const a2 = (await harness.repo.listMessages(a.id)).find((message) => message.id === 'a2');
      expect(a2?.status).toBe('complete');
      expect(a2?.finishReason).toBeUndefined();
      expect(await harness.repo.recoverInterrupted()).toEqual([]);
    });
  });
}

function makeMessage(
  id: string,
  conversationId: string,
  createdAt: number,
  status: MessageStatus = 'complete',
): ChatMessage {
  return {
    id,
    conversationId,
    role: 'assistant',
    status,
    content: [{ type: 'text', text: `texto de ${id}` }],
    createdAt,
    updatedAt: createdAt,
  };
}
