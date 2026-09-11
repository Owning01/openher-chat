import { IndexedDbConversations } from './IndexedDbConversations';
import { describeConversationRepositoryContract } from './conversationContract';
import type { ConversationRepositoryHarness } from './conversationContract';
import { getDb } from './idb';

describeConversationRepositoryContract('IndexedDbConversations', async () => {
  let nowValue = 0;
  let idCounter = 0;
  const repo = new IndexedDbConversations({
    newId: () => `conv-${(idCounter += 1)}`,
    now: () => nowValue,
  });
  const db = await getDb();
  const harness: ConversationRepositoryHarness = {
    repo,
    setNow: (value: number) => {
      nowValue = value;
    },
    reset: async () => {
      await db.clear('conversations');
      await db.clear('messages');
    },
  };
  return harness;
});
