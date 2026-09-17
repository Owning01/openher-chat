import { describe, expect, it } from 'vitest';

import type { Skill } from '../types/skill';

import { findSkillByName, isSkillNameTaken, normalizeSkillName } from './skillName';

function skill(id: string, name: string): Skill {
  return { id, name, description: '', body: '', createdAt: 1, updatedAt: 1 };
}

describe('normalizeSkillName', () => {
  it('unifica mayúsculas, espacios y guiones bajos', () => {
    expect(normalizeSkillName('  Mi Skill  ')).toBe('mi-skill');
    expect(normalizeSkillName('informe_laboral')).toBe('informe-laboral');
    expect(normalizeSkillName('a---b')).toBe('a-b');
    expect(normalizeSkillName('   ')).toBe('');
  });
});

describe('findSkillByName', () => {
  const skills = [skill('1', 'Informe Laboral'), skill('2', 'legal-brief')];

  it('encuentra sin distinguir mayúsculas ni separadores', () => {
    expect(findSkillByName(skills, 'informe laboral')?.id).toBe('1');
    expect(findSkillByName(skills, 'INFORME_LABORAL')?.id).toBe('1');
    expect(findSkillByName(skills, 'Legal-Brief')?.id).toBe('2');
  });

  it('devuelve null cuando no existe o el nombre está vacío', () => {
    expect(findSkillByName(skills, 'otra')).toBeNull();
    expect(findSkillByName(skills, '   ')).toBeNull();
  });
});

describe('isSkillNameTaken', () => {
  const skills = [skill('1', 'Informe Laboral')];

  it('detecta repetidos ignorando el propio id al editar', () => {
    expect(isSkillNameTaken(skills, 'informe-laboral')).toBe(true);
    expect(isSkillNameTaken(skills, 'Informe Laboral', '1')).toBe(false);
    expect(isSkillNameTaken(skills, 'otra')).toBe(false);
    expect(isSkillNameTaken(skills, '  ')).toBe(false);
  });
});
