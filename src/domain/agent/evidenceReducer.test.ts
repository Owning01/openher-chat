import { describe, expect, it } from 'vitest';
import { formatEvidenceDigest, reduceToEvidence } from './evidenceReducer';

describe('SoL-Pi — Evidence-Preserving Reducer', () => {
  const sampleCourtOrder = `
Y VISTOS: Considerando:
En la Ciudad de Buenos Aires, a los 15 de marzo de 2024, vienen estos autos a despacho a efectos de resolver.
Que resulta menester poner de resalto que la actora reclama la suma de $4.500.000 en concepto de capital e intereses.
Que a mayor abundamiento cabe destacar que la mora se produjo el 2023-11-10 conforme surge de la carta documento CD982312.
El demandado invocó la excepción de prescripción del art. 2560 del CCyC y art. 347 del CPCCN.
Por lo expuesto, oído el Ministerio Público, RESUELVO:
1. Rechazar la excepción de prescripción opuesta por la demandada.
2. Hacer lugar parcialmente a la demanda y condenar a la demandada a pagar la suma de $3.800.000 con costas al vencido.
Regístrese, notifíquese y oportunamente archívese.
Dígnese V.S. proveer de conformidad, que será justicia.
`;

  it('extrae fechas, montos, citas legales y disposiciones resolutivas', () => {
    const digest = reduceToEvidence(sampleCourtOrder);

    expect(digest.dates).toEqual(expect.arrayContaining(['15 de marzo de 2024', '2023-11-10']));
    expect(digest.amounts).toEqual(expect.arrayContaining(['$4.500.000', '$3.800.000']));
    expect(digest.citations.some((c) => c.toLowerCase().includes('art. 2560 del ccyc'))).toBe(true);
    expect(digest.citations.some((c) => c.toLowerCase().includes('art. 347 del cpccn'))).toBe(true);
    expect(digest.dispositions.length).toBeGreaterThanOrEqual(2);
    expect(digest.dispositions[0]).toContain('Rechazar la excepción');
  });

  it('elimina fórmulas de estilo y frases sacramentales', () => {
    const digest = reduceToEvidence(sampleCourtOrder);

    expect(digest.reducedText).not.toContain('Dígnese V.S. proveer de conformidad');
    expect(digest.reducedText).not.toContain('será justicia');
    expect(digest.reducedText).not.toContain('Regístrese, notifíquese y oportunamente archívese');
    expect(digest.reducedLength).toBeLessThan(digest.originalLength);
    expect(digest.compressionRatio).toBeLessThan(1);
  });

  it('formatea el bloque de evidencia denso', () => {
    const digest = reduceToEvidence(sampleCourtOrder);
    const formatted = formatEvidenceDigest(digest);

    expect(formatted).toContain('[EVIDENCE_DIGEST');
    expect(formatted).toContain('• Fechas clave:');
    expect(formatted).toContain('• Montos:');
    expect(formatted).toContain('• Normas citadas:');
    expect(formatted).toContain('• Puntos resolutivos');
  });

  it('tolera textos vacíos o mínimos sin fallar', () => {
    const empty = reduceToEvidence('');
    expect(empty.originalLength).toBe(0);
    expect(empty.reducedLength).toBe(0);
    expect(empty.dates).toEqual([]);
    expect(empty.amounts).toEqual([]);
  });
});
