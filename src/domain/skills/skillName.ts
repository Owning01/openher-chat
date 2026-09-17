import type { Skill } from '../types/skill';

/** Nombre canónico para comparar y validar: minúsculas, espacios y `_` → `-`. */
export function normalizeSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-');
}

/** Busca por nombre sin distinguir mayúsculas/espacios (`Mi Skill` = `mi-skill`). */
export function findSkillByName(skills: readonly Skill[], name: string): Skill | null {
  const target = normalizeSkillName(name);
  if (target === '') return null;
  return skills.find((skill) => normalizeSkillName(skill.name) === target) ?? null;
}

/**
 * Rechaza nombres repetidos al crear/editar: dos skills con el mismo nombre
 * canónico confunden al modelo (¿cuál cargar?) y el tool resolvería sólo una.
 * `editingId` excluye la propia skill al renombrarla.
 */
export function isSkillNameTaken(
  skills: readonly Skill[],
  name: string,
  editingId?: string,
): boolean {
  const target = normalizeSkillName(name);
  if (target === '') return false;
  return skills.some((skill) => skill.id !== editingId && normalizeSkillName(skill.name) === target);
}
