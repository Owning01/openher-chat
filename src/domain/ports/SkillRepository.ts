import type { Skill, SkillDraft } from '../types/skill';

/**
 * Puerto de las skills guardadas en el dispositivo. `save` es upsert por `id`
 * (sin `id` crea); `list` las devuelve ordenadas por nombre para que el system
 * prompt sea estable entre turnos (misma lista ⇒ mismo prefijo cacheable).
 */
export interface SkillRepository {
  list(): Promise<Skill[]>;
  save(draft: SkillDraft): Promise<Skill>;
  remove(id: string): Promise<void>;
}
