import { describe, expect, it } from 'vitest';

import { buildLegalRolePrompt, LEGAL_ROLE_ORDER } from './prompt';

describe('buildLegalRolePrompt', () => {
  it('define el orden canónico redactor → atacante → juez → sintesis', () => {
    expect([...LEGAL_ROLE_ORDER]).toEqual(['redactor', 'atacante', 'juez', 'sintesis']);
  });

  it('cada rol tiene sus propias reglas y no pisa las de otro', () => {
    const redactor = buildLegalRolePrompt('redactor');
    const atacante = buildLegalRolePrompt('atacante');
    const juez = buildLegalRolePrompt('juez');
    const sintesis = buildLegalRolePrompt('sintesis');

    expect(redactor).toContain('drafting counsel');
    expect(redactor).toContain('Do not anticipate the opposing counsel');
    expect(atacante).toContain('opposing counsel');
    expect(atacante).toContain('red-team simulation');
    expect(atacante).toContain('Never defend the drafter');
    expect(atacante).toContain('no preamble');
    expect(juez).toContain('final arbiter');
    expect(juez).toContain('like a debate judge');
    expect(juez).toContain('Never draft new pleadings');
    expect(juez).toContain('Verdict: side A x% / side B y%');
    expect(juez).toContain('never close the answer without it');
    expect(sintesis).toContain('synthesis counsel');
    expect(sintesis).toContain('final polished legal document');
    expect(sintesis).toContain('Iterate on request');

    expect(new Set([redactor, atacante, juez, sintesis]).size).toBe(4);
  });

  it('es byte-estable: mismos inputs dan el mismo string', () => {
    expect(buildLegalRolePrompt('juez')).toBe(buildLegalRolePrompt('juez'));
    expect(buildLegalRolePrompt('sintesis')).toBe(buildLegalRolePrompt('sintesis'));
  });
});
