import { describe, expect, it } from 'vitest';

import { buildAttackerSeed, buildFinalSeed, buildJudgeSeed } from './circuit';

describe('buildAttackerSeed', () => {
  it('incluye el escrito delimitado y la instrucción mínima', () => {
    const seed = buildAttackerSeed('# Demanda\n\nTexto.');
    expect(seed).toContain('## Escrito a revisar');
    expect(seed).toContain('# Demanda');
    expect(seed).toContain('Texto.');
  });

  it('marca el faltante en vez de dejarlo vacío', () => {
    expect(buildAttackerSeed('   ')).toContain('[COMPLETAR: escrito pendiente]');
  });
});

describe('buildJudgeSeed', () => {
  it('incluye escrito y ataque en secciones separadas y ordenadas', () => {
    const seed = buildJudgeSeed('DOC', 'ATAQUE');
    const docIndex = seed.indexOf('## Escrito');
    const attackIndex = seed.indexOf('## Ataque de la contraparte');
    expect(docIndex).toBeGreaterThanOrEqual(0);
    expect(attackIndex).toBeGreaterThan(docIndex);
    expect(seed).toContain('DOC');
    expect(seed).toContain('ATAQUE');
  });

  it('marca cada faltante por separado', () => {
    const seed = buildJudgeSeed('', '');
    expect(seed).toContain('[COMPLETAR: escrito pendiente]');
    expect(seed).toContain('[COMPLETAR: ataque pendiente]');
  });
});

describe('buildFinalSeed', () => {
  it('incluye escrito, ataque y veredicto en secciones ordenadas', () => {
    const seed = buildFinalSeed('DOC', 'ATAQUE', 'VEREDICTO');
    const docIndex = seed.indexOf('## Parte 1');
    const attackIndex = seed.indexOf('## Parte 2');
    const verdictIndex = seed.indexOf('## Parte 3');
    expect(docIndex).toBeGreaterThanOrEqual(0);
    expect(attackIndex).toBeGreaterThan(docIndex);
    expect(verdictIndex).toBeGreaterThan(attackIndex);
    expect(seed).toContain('DOC');
    expect(seed).toContain('ATAQUE');
    expect(seed).toContain('VEREDICTO');
  });

  it('marca cada faltante por separado', () => {
    const seed = buildFinalSeed('', '', '');
    expect(seed).toContain('[COMPLETAR: escrito pendiente]');
    expect(seed).toContain('[COMPLETAR: ataque pendiente]');
    expect(seed).toContain('[COMPLETAR: veredicto pendiente]');
  });
});
