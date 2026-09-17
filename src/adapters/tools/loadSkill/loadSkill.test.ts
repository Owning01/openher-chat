import { describe, expect, it } from 'vitest';

import type { ToolExecutionContext } from '@/domain/types/tools';
import type { Skill } from '@/domain/types/skill';

import { createLoadSkillTool, LOAD_SKILL_TOOL_NAME } from './index';

const CONTEXT: ToolExecutionContext = { signal: new AbortController().signal, conversationId: 'conv-1' };

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill_1',
    name: 'Informe Laboral',
    description: 'Redacta informes laborales',
    body: '# Pasos\n\n1. Revisar el expediente.',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('load_skill', () => {
  it('devuelve el cuerpo completo de la skill pedida, sin importar el formato del nombre', async () => {
    const tool = createLoadSkillTool({ skills: [skill()] });

    const result = await tool.execute({ name: 'informe laboral' }, CONTEXT);

    expect(tool.name).toBe(LOAD_SKILL_TOOL_NAME);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('1. Revisar el expediente.');
    expect(result.provider).toBe('skills');
    expect(tool.parameters.required).toEqual(['name']);
  });

  it('falla con invalid_args y lista las disponibles cuando el nombre no existe', async () => {
    const tool = createLoadSkillTool({ skills: [skill(), skill({ id: 's2', name: 'otra' })] });

    const result = await tool.execute({ name: 'no-existe' }, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_args');
    expect(result.content).toContain('Unknown skill "no-existe"');
    expect(result.content).toContain('Informe Laboral');
    expect(result.content).toContain('otra');
  });

  it('rechaza argumentos vacíos sin tocar las skills', async () => {
    const tool = createLoadSkillTool({ skills: [skill()] });

    const result = await tool.execute({}, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_args');
    expect(result.content).toContain('"name" argument is required');
  });

  it('avisa cuando la skill no tiene contenido y recorta los cuerpos enormes', async () => {
    const empty = createLoadSkillTool({ skills: [skill({ body: '   ' })] });
    const emptyResult = await empty.execute({ name: 'Informe Laboral' }, CONTEXT);
    expect(emptyResult.ok).toBe(true);
    expect(emptyResult.content).toContain('has no content');

    const huge = createLoadSkillTool({ skills: [skill({ body: 'x'.repeat(20_000) })] });
    const hugeResult = await huge.execute({ name: 'Informe Laboral' }, CONTEXT);
    expect(hugeResult.ok).toBe(true);
    expect(hugeResult.content.length).toBeLessThanOrEqual(huge.maxResultChars + 20);
    expect(hugeResult.content.endsWith('[…recortado]')).toBe(true);
  });
});
