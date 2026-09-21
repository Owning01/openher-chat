import { describe, expect, it } from 'vitest';
import {
  ObservationRegistry,
  createObservationPack,
  formatObservationSummary,
  readObservationSection,
  segmentIntoSections,
} from './observationPack';

describe('SoL-Pi — ObservationPack', () => {
  const sampleMarkdown = `
# Sentencia Judicial - Cámara Civil y Comercial

## Vistos y Considerando
En la Ciudad de Buenos Aires a los 12 días del mes de mayo de 2025, se reúnen los señores jueces...

## Hechos Probados
Ha quedado acreditado mediante la pericia contable de fs. 142 que el actor abonó la suma de $1.500.000...
Asimismo, la declaración testimonial del testigo Gómez corroboró el horario del siniestro...

## Doctrina y Fundamentos de Derecho
Conforme al artículo 1716 del Código Civil y Comercial de la Nación, el deber de reparar nace del incumplimiento de una obligación...
La jurisprudencia de la CSJN en autos "Halabi" fijó pautas claras al respecto...

## Parte Dispositiva / Fallo
1. Hacer lugar a la demanda interpuesta.
2. Condenar a la demandada al pago de $3.200.000 con más intereses y costas de conformidad con el art. 68 del CPCCN.
`;

  it('segmenta texto Markdown por encabezados de forma estructurada', () => {
    const sections = segmentIntoSections(sampleMarkdown);
    expect(sections.length).toBe(4);
    expect(sections[0]?.heading).toBe('Vistos y Considerando');
    expect(sections[1]?.heading).toBe('Hechos Probados');
    expect(sections[2]?.heading).toBe('Doctrina y Fundamentos de Derecho');
    expect(sections[3]?.heading).toBe('Parte Dispositiva / Fallo');
  });

  it('crea un ObservationPack con id y resumen ejecutivo de alta densidad', () => {
    const pack = createObservationPack({
      title: 'Fallo Cámara Civil - Incumplimiento Contractual',
      fullContent: sampleMarkdown,
      sourceUrl: 'https://jurisprudencia.pjn.gov.ar/fallo/12345',
    });

    expect(pack.id).toMatch(/^obs_/);
    expect(pack.title).toContain('Fallo Cámara');
    expect(pack.sections.length).toBe(4);
    expect(pack.totalChars).toBe(sampleMarkdown.length);
    expect(pack.executiveExcerpt).toContain('Vistos y Considerando');
    expect(pack.executiveExcerpt).toContain('Parte Dispositiva');
  });

  it('formatea el resumen estructurado para el agent loop', () => {
    const pack = createObservationPack({
      title: 'Documento Test',
      fullContent: sampleMarkdown,
    });

    const summary = formatObservationSummary(pack);
    expect(summary).toContain(`[OBSERVATION_PACK id="${pack.id}"]`);
    expect(summary).toContain('Índice de secciones disponibles:');
    expect(summary).toContain('read_observation');
  });

  it('permite leer una sección específica bajo demanda con readObservationSection', () => {
    const registry = new ObservationRegistry();
    const pack = createObservationPack({
      id: 'obs_test_fallo',
      title: 'Fallo Test',
      fullContent: sampleMarkdown,
    });
    registry.set(pack);

    // Leer sección "sec-4" (Parte Dispositiva / Fallo)
    const result = readObservationSection('obs_test_fallo', 'sec-4', 0, 1000, registry);
    expect(result.found).toBe(true);
    expect(result.sectionHeading).toBe('Parte Dispositiva / Fallo');
    expect(result.text).toContain('Hacer lugar a la demanda interpuesta');
    expect(result.text).toContain('$3.200.000');
  });

  it('maneja errores graciosamente cuando el handle o la sección no existen', () => {
    const registry = new ObservationRegistry();
    const notFound = readObservationSection('obs_inexistente', 'sec-1', 0, 100, registry);
    expect(notFound.found).toBe(false);
    expect(notFound.error).toContain('No se encontró la observación');

    const pack = createObservationPack({
      id: 'obs_existente',
      title: 'Doc',
      fullContent: '# Hola\nMundo',
    });
    registry.set(pack);

    const sectionNotFound = readObservationSection('obs_existente', 'sec-999', 0, 100, registry);
    expect(sectionNotFound.found).toBe(false);
    expect(sectionNotFound.error).toContain('no existe');
  });
});
