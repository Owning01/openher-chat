import { MemoryLegalCaseRepository, MemoryLegalPackStore } from '@/test/fakes/MemoryRepos';
import { IndexedDbLegalCases } from './IndexedDbLegalCases';
import { IndexedDbLegalPacks } from './IndexedDbLegalPacks';
import {
  ACKNOWLEDGMENTS_STORE,
  GAPS_STORE,
  LEGAL_ANALYSES_STORE,
  LEGAL_CASES_STORE,
  LEGAL_DOCUMENTS_STORE,
  LEGAL_PACKS_STORE,
  getDb,
} from './idb';
import { describeLegalRepositoryContract } from './legalContract';
import type { LegalRepositoryHarness } from './legalContract';

describeLegalRepositoryContract('IndexedDbLegal (casos + packs)', async () => {
  let nowValue = 0;
  let idCounter = 0;
  const cases = new IndexedDbLegalCases({
    newId: () => `case-${(idCounter += 1)}`,
    now: () => nowValue,
  });
  const packs = new IndexedDbLegalPacks({ now: () => nowValue });
  const db = await getDb();
  const harness: LegalRepositoryHarness = {
    cases,
    packs,
    setNow: (value: number) => {
      nowValue = value;
    },
    reset: async () => {
      await db.clear(LEGAL_CASES_STORE);
      await db.clear(LEGAL_DOCUMENTS_STORE);
      await db.clear(LEGAL_ANALYSES_STORE);
      await db.clear(LEGAL_PACKS_STORE);
      await db.clear(ACKNOWLEDGMENTS_STORE);
      await db.clear(GAPS_STORE);
    },
  };
  return harness;
});

describeLegalRepositoryContract('MemoryLegal (casos + packs)', () => {
  let nowValue = 0;
  let idCounter = 0;
  const cases = new MemoryLegalCaseRepository({
    newId: () => `case-${(idCounter += 1)}`,
    now: () => nowValue,
  });
  const packs = new MemoryLegalPackStore({ now: () => nowValue });
  return {
    cases,
    packs,
    setNow: (value: number) => {
      nowValue = value;
    },
    reset: async () => {
      cases.clear();
      packs.clear();
    },
  };
});
