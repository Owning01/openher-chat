import { describe, expect, it } from 'vitest';
import type { LegalCase } from '../types/legal';
import {
  auditDocumentCompleteness,
  buildSectionDraftingPrompt,
  parseDocumentSections,
} from './documentAuditor';
import { APPEAL_TEMPLATE } from './templates/appeal';
import { EVIDENCE_TEMPLATE } from './templates/evidence';

const SAMPLE_CASE: LegalCase = {
  id: 'case-test-1',
  title: 'González c/ Aseguradora SA',
  status: 'active',
  jurisdiction: 'national',
  court: 'Juzgado Civil N° 14',
  matter: 'civil',
  clientRole: 'plaintiff',
  parties: [],
  facts: [],
  keyDates: [],
  createdAt: 1000,
  updatedAt: 1000,
};

describe('documentAuditor', () => {
  it('detecta placeholders incompletos y estado incomplete', () => {
    const markdown = `# Demanda\n\n## Objeto\n[COMPLETAR: monto exacto]\n\n## Petitorio\nSolicito que se haga lugar.`;
    const audit = auditDocumentCompleteness(markdown);

    expect(audit.status).toBe('incomplete');
    expect(audit.missingPlaceholders).toContain('[COMPLETAR: monto exacto]');
    expect(audit.hasPetition).toBe(true);
    expect(audit.wordCount).toBeGreaterThan(5);
  });

  it('detecta falta de petitorio', () => {
    const markdown = `# Demanda\n\n## Objeto\nVengo a demandar cumplimiento.`;
    const audit = auditDocumentCompleteness(markdown);

    expect(audit.hasPetition).toBe(false);
    expect(audit.status).toBe('incomplete');
  });

  it('marca warning si hay citas sin verificar o falta reserva de caso federal', () => {
    const markdown = `# Demanda\n\n## Hechos\nSucedió un hecho.\n\n## Derecho\nConforme art. 1109 CCyC [VERIFICAR].\n\n## Petitorio\nSolicito condena.`;
    const audit = auditDocumentCompleteness(markdown);

    expect(audit.unverifiedCitationsCount).toBe(1);
    expect(audit.hasFederalReserve).toBe(false);
    expect(audit.status).toBe('warning');
  });

  it('marca ready cuando el escrito está completo con petitorio y caso federal', () => {
    const markdown = `# Demanda\n\n## Hechos\nRelato de los hechos.\n\n## Caso Federal\nHago expresa Reserva del Caso Federal conforme Ley 48 art. 14.\n\n## Petitorio\nSolicito se condene al demandado.`;
    const audit = auditDocumentCompleteness(markdown);

    expect(audit.status).toBe('ready');
    expect(audit.hasFederalReserve).toBe(true);
    expect(audit.hasPetition).toBe(true);
    expect(audit.missingPlaceholders).toHaveLength(0);
    expect(audit.unverifiedCitationsCount).toBe(0);
  });

  it('descompone correctamente en secciones Markdown', () => {
    const markdown = `# Título Principal\n\nTexto intro.\n\n## Capítulo I: Objeto\nPretensión procesal.\n\n## Capítulo II: Hechos\nRelato pormenorizado.`;
    const sections = parseDocumentSections(markdown);

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.some((s) => s.heading.includes('Objeto'))).toBe(true);
    expect(sections.some((s) => s.heading.includes('Hechos'))).toBe(true);
  });

  it('genera prompt de redacción anti-pereza por capítulo', () => {
    const prompt = buildSectionDraftingPrompt({
      caseData: SAMPLE_CASE,
      sectionHeading: 'Capítulo IV: Prueba Pericial',
      templateTitle: 'Demanda Ordinaria',
      guidance: 'Fijar puntos de pericia médica y mecánica.',
      existingContent: '- Pericia médica inicial.',
    });

    expect(prompt).toContain('González c/ Aseguradora SA');
    expect(prompt).toContain('Capítulo IV: Prueba Pericial');
    expect(prompt).toContain('ANTI-TRUNCAMIENTO');
    expect(prompt).toContain('Pericia médica inicial.');
  });

  it('las nuevas plantillas de apelación y prueba son válidas', () => {
    expect(APPEAL_TEMPLATE.id).toBe('ar-appeal-cpccn');
    expect(APPEAL_TEMPLATE.kind).toBe('appeal');
    expect(APPEAL_TEMPLATE.sections.length).toBeGreaterThan(4);

    expect(EVIDENCE_TEMPLATE.id).toBe('ar-evidence-cpccn');
    expect(EVIDENCE_TEMPLATE.kind).toBe('evidence');
    expect(EVIDENCE_TEMPLATE.sections.some((s) => s.id === 'expert')).toBe(true);
  });
});
