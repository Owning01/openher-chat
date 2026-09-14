import { describe, expect, it } from 'vitest';
import type { LegalCase, LegalTemplate } from '../types/legal';
import {
  DOCUMENT_SOURCE_DISCLAIMER,
  DOCUMENT_WATERMARK,
  MISSING_DATA_PREFIX,
  buildDocumentDraft,
  documentToMarkdown,
  renderTemplate,
} from './document';
import { getLegalTemplate, listTemplates, templateChecklist } from './templates/index';

const NOW = 1_700_000_000_000;

const CASE: LegalCase = {
  id: 'case-1',
  title: 'Pérez c/ Gómez',
  status: 'active',
  jurisdiction: 'national',
  court: 'Juzgado Civil N° 1',
  matter: 'civil',
  clientRole: 'plaintiff',
  parties: [
    { id: 'p1', name: 'Ana Pérez', role: 'plaintiff', address: 'Calle Falsa 123' },
    { id: 'p2', name: 'Luis Gómez', role: 'defendant', address: 'Avenida Siempre Viva 742' },
  ],
  facts: [{ id: 'f1', statement: 'Incumplimiento del contrato de compraventa', date: '2026-01-10', certainty: 'certain' }],
  keyDates: [{ id: 'd1', label: 'Firma del contrato', date: '2025-12-01' }],
  createdAt: 1,
  updatedAt: 1,
};

const MINIMAL_CASE: LegalCase = {
  id: 'case-min',
  title: '',
  status: 'active',
  jurisdiction: 'caba',
  court: '',
  matter: 'civil-commercial',
  clientRole: 'defendant',
  parties: [],
  facts: [],
  keyDates: [],
  createdAt: 1,
  updatedAt: 1,
};

function requireTemplate(id: string): LegalTemplate {
  const template = getLegalTemplate(id);
  if (template === null) throw new Error(`plantilla no registrada: ${id}`);
  return template;
}

describe('renderTemplate', () => {
  it('resuelve partes, hechos y fechas del caso', () => {
    const markdown = renderTemplate(requireTemplate('ar-claim-cpccn'), { case: CASE });
    expect(markdown).toContain('Ana Pérez');
    expect(markdown).toContain('Luis Gómez');
    expect(markdown).toContain('Incumplimiento del contrato de compraventa');
    expect(markdown).toContain('Firma del contrato: 2025-12-01');
    expect(markdown).toContain('## Hechos');
  });

  it('no lanza con un caso mínimo y marca explícitamente los datos faltantes', () => {
    const markdown = renderTemplate(requireTemplate('ar-claim-cpccn'), { case: MINIMAL_CASE });
    expect(markdown).toContain(MISSING_DATA_PREFIX);
    expect(markdown).toContain('## Partes');
    expect(markdown).toContain('nombre y domicilio del demandado');
  });

  it('marca los datos adicionales ausentes como faltantes', () => {
    const markdown = renderTemplate(requireTemplate('ar-demand-letter'), { case: CASE });
    expect(markdown).toContain('## Intimación');
    expect(markdown).toContain(MISSING_DATA_PREFIX);
  });
});

describe('checklist de plantillas', () => {
  it('la demanda refleja el art. 330 del CPCCN con los seis incisos y el monto', () => {
    const checklist = templateChecklist('ar-claim-cpccn');
    expect(checklist.length).toBeGreaterThanOrEqual(7);
    for (const item of checklist) {
      expect(item.normRef).toBe('CPCCN-330');
      expect(item.packProvisions).toContain('CPCCN-330');
    }
    const labels = checklist.map((item) => item.label).join(' | ').toLowerCase();
    for (const keyword of ['demandante', 'demandado', 'cosa', 'hechos', 'derecho', 'petición', 'monto']) {
      expect(labels).toContain(keyword);
    }
  });

  it('la contestación cubre los arts. 355/356 y las excepciones previas 346/347', () => {
    const checklist = templateChecklist('ar-answer-cpccn');
    const normRefs = checklist.map((item) => item.normRef);
    expect(normRefs).toContain('CPCCN-356');
    expect(normRefs).toContain('CPCCN-355');
    expect(normRefs).toContain('CPCCN-346');
    const labels = checklist.map((item) => item.label).join(' | ').toLowerCase();
    expect(labels).toContain('reconocer o negar');
    expect(labels).toContain('autenticidad');
    expect(labels).toContain('excepciones previas');
  });

  it('registra plantillas por id y por tipo', () => {
    expect(getLegalTemplate('ar-claim-cpccn')).not.toBeNull();
    expect(getLegalTemplate('inexistente')).toBeNull();
    expect(templateChecklist('inexistente')).toEqual([]);
    expect(listTemplates('claim')).toHaveLength(1);
    expect(listTemplates('answer')[0]?.kind).toBe('answer');
    expect(listTemplates().length).toBeGreaterThanOrEqual(3);
  });
});

describe('documentToMarkdown', () => {
  it('impone watermark y disclaimer en todo borrador', () => {
    const document = buildDocumentDraft({ id: 'doc-1', case: CASE, template: requireTemplate('ar-claim-cpccn'), now: NOW });
    expect(document.status).toBe('draft');
    const markdown = documentToMarkdown(document);
    expect(markdown).toContain(DOCUMENT_WATERMARK);
    expect(markdown).toContain(DOCUMENT_SOURCE_DISCLAIMER);
    expect(markdown).toContain('# Demanda civil');
    expect(markdown).toContain('Ana Pérez');
  });

  it('no permite quitar el watermark de un borrador aunque la opción sea false', () => {
    const document = buildDocumentDraft({ id: 'doc-2', case: CASE, template: requireTemplate('ar-claim-cpccn'), now: NOW });
    const markdown = documentToMarkdown(document, { watermark: false });
    expect(markdown).toContain(DOCUMENT_WATERMARK);
    expect(markdown).toContain(DOCUMENT_SOURCE_DISCLAIMER);
  });

  it('respeta el title explícito del borrador', () => {
    const document = buildDocumentDraft({
      id: 'doc-3',
      case: CASE,
      template: requireTemplate('ar-answer-cpccn'),
      now: NOW,
      title: 'Contestación — Pérez c/ Gómez',
    });
    expect(document.title).toBe('Contestación — Pérez c/ Gómez');
    expect(document.kind).toBe('answer');
    expect(document.templateId).toBe('ar-answer-cpccn');
    expect(documentToMarkdown(document, { watermark: true })).toContain(DOCUMENT_WATERMARK);
  });
});
