import type { SkillRepository } from '@/domain/ports/SkillRepository';
import type { Skill, SkillDraft } from '@/domain/types/skill';
import { newId } from '@/shared/utils/ids';
import { SKILLS_STORE, UPDATED_AT_INDEX, getDb } from './idb';

export interface SkillStorageDeps {
  now: () => number;
  newId: () => string;
  ownerId?: string | null;
}

const DEFAULT_DEPS: Pick<SkillStorageDeps, 'now' | 'newId'> = {
  now: () => Date.now(),
  newId: () => newId('skill'),
};

/**
 * Skills guardadas en IndexedDB v3 (partición del owner como el resto de los
 * repos). `list` ordena por nombre para que el system prompt sea idéntico entre
 * turnos mientras no cambie la colección.
 */
export class IndexedDbSkills implements SkillRepository {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly ownerId: string | null;

  constructor(deps: Partial<SkillStorageDeps> = {}) {
    this.now = deps.now ?? DEFAULT_DEPS.now;
    this.newId = deps.newId ?? DEFAULT_DEPS.newId;
    this.ownerId = deps.ownerId ?? null;
  }

  async list(): Promise<Skill[]> {
    const db = await getDb(this.ownerId);
    const stored = await db.getAllFromIndex(SKILLS_STORE, UPDATED_AT_INDEX);
    return stored
      .map(cloneSkill)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /** Upsert por `id`: crea si no viene, edita si viene y conserva `createdAt`. */
  async save(draft: SkillDraft): Promise<Skill> {
    const db = await getDb(this.ownerId);
    const existing = draft.id === undefined ? undefined : await db.get(SKILLS_STORE, draft.id);
    const now = this.now();
    const skill: Skill = {
      id: draft.id ?? this.newId(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      body: draft.body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.put(SKILLS_STORE, skill);
    return cloneSkill(skill);
  }

  async remove(id: string): Promise<void> {
    const db = await getDb(this.ownerId);
    await db.delete(SKILLS_STORE, id);
  }
}

/** Copia defensiva: lo persistido no comparte referencias con quien lo leyó. */
function cloneSkill(skill: Skill): Skill {
  return { ...skill };
}
