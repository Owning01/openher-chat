import { describe, expect, it } from 'vitest';

import { parseSkillMarkdown } from './parseSkillMarkdown';

describe('parseSkillMarkdown', () => {
  it('lee frontmatter con name y description y separa el cuerpo', () => {
    const parsed = parseSkillMarkdown(
      [
        '---',
        'name: informe-laboral',
        'description: Redacta informes laborales',
        '---',
        '',
        '# Informe laboral',
        '',
        'Pasos...',
      ].join('\n'),
    );

    expect(parsed.name).toBe('informe-laboral');
    expect(parsed.description).toBe('Redacta informes laborales');
    expect(parsed.body).toBe('# Informe laboral\n\nPasos...');
  });

  it('sin frontmatter usa el primer título como nombre', () => {
    const parsed = parseSkillMarkdown('# Mi Skill\n\nContenido');
    expect(parsed.name).toBe('Mi Skill');
    expect(parsed.description).toBe('');
    expect(parsed.body).toBe('# Mi Skill\n\nContenido');
  });

  it('tolera comillas, comentarios y frontmatter sin cerrar', () => {
    const quoted = parseSkillMarkdown('---\nname: "con comillas"\n# comentario\ndescription: ok\n---\ncuerpo');
    expect(quoted.name).toBe('con comillas');
    expect(quoted.description).toBe('ok');

    const unclosed = parseSkillMarkdown('---\nname: sin cierre\ncuerpo suelto');
    expect(unclosed.name).toBe('');
    expect(unclosed.body).toBe('---\nname: sin cierre\ncuerpo suelto');
  });

  it('ignora BOM y recorta el cuerpo', () => {
    const parsed = parseSkillMarkdown('\uFEFF---\nname: x\n---\n\n  cuerpo  \n');
    expect(parsed.name).toBe('x');
    expect(parsed.body).toBe('cuerpo');
  });
});
