import { describe, expect, it } from 'vitest';
import { formatLegalLintReport, lintLegalDocument } from './legalLinter';

describe('LegalLinter - Linter Jurídico Forense', () => {
  it('detecta marcadores fácticos no resueltos como error', () => {
    const brief = `
# Demanda por Daños y Perjuicios
## Objeto
Vengo a demandar por la suma de $ [INSERTAR MONTO] contra el demandado DNI XX.XXX.XXX.
## Petitorio
Hacer lugar a la demanda.
`;
    const report = lintLegalDocument(brief, 'claim');
    expect(report.isAdmissible).toBe(false);
    expect(report.checks.hasUnresolvedPlaceholders).toBe(true);
    expect(report.issues.some((i) => i.code === 'unresolved_placeholders')).toBe(true);
    expect(report.missingPlaceholders.length).toBeGreaterThanOrEqual(2);
  });

  it('detecta defecto legal por omisión de hechos u objeto en demanda (art. 330 CPCCN)', () => {
    const brief = `
# Demanda
## Petitorio
Solicito condena con costas.
`;
    const report = lintLegalDocument(brief, 'claim');
    expect(report.isAdmissible).toBe(false);
    expect(report.issues.some((i) => i.code === 'defect_legal_objeto')).toBe(true);
    expect(report.issues.some((i) => i.code === 'defect_legal_hechos')).toBe(true);
    expect(report.issues.some((i) => i.code === 'falta_ofrecimiento_prueba')).toBe(true);
  });

  it('detecta citas a normativa derogada del Código de Vélez Sarsfield', () => {
    const brief = `
# Demanda
## Objeto
Demandar cumplimiento.
## Hechos
El hecho ocurrió el 10 de marzo.
## Derecho
Fundo en el art. 1109 del Código Civil y en el art. 1078 por daño moral.
## Prueba
Ofrezco documental.
## Reserva Caso Federal
Hago reserva art. 14 Ley 48.
## Petitorio
Tener por promovida la demanda.
`;
    const report = lintLegalDocument(brief, 'claim');
    expect(report.checks.hasDerogatedCitations).toBe(true);
    expect(report.derogatedCitations.length).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.code === 'norma_derogada_velez')).toBe(true);
  });

  it('detecta omisión de la Reserva del Caso Federal (Ley 48 art. 14)', () => {
    const brief = `
# Demanda
## Objeto
Demandar reparación.
## Hechos
Ocurrió el siniestro vial.
## Derecho
Fundo en arts. 1757 y 1758 del CCyC.
## Prueba
Ofrezco prueba pericial y documental.
## Petitorio
Condenar al demandado.
`;
    const report = lintLegalDocument(brief, 'claim');
    expect(report.checks.hasFederalReserve).toBe(false);
    expect(report.issues.some((i) => i.code === 'falta_reserva_caso_federal')).toBe(true);
  });

  it('detecta incongruencia cuando se narran daños en los hechos que no se piden en el petitorio', () => {
    const brief = `
# Demanda
## Objeto
Demandar por indemnización.
## Hechos
A consecuencia del choque el actor sufrió grave daño moral y daño psicológico severo.
## Derecho
Arts. 1740 y 1741 CCyC.
## Prueba
Ofrezco prueba médica.
## Reserva de Caso Federal
Reserva art. 14 Ley 48.
## Petitorio
1. Se condene al demandado al pago de daño emergente únicamente.
`;
    const report = lintLegalDocument(brief, 'claim');
    expect(report.issues.some((i) => i.code === 'incongruencia_rubros_petitorio')).toBe(true);
  });

  it('califica escrito completo e impecable con 100 de score', () => {
    const cleanBrief = `
# INICIA DEMANDA POR DAÑOS Y PERJUICIOS
Señor Juez:
Juan Pérez, por derecho propio, con domicilio real en Calle Falsa 123, constituyendo domicilio procesal en Tucumán 1234 y domicilio electrónico CUIT 20-12345678-9, a V.S. me presento y digo:

## I. OBJETO
Que vengo a promover formal demanda de daños y perjuicios contra Aseguradora SA por la suma de $1.000.000 o lo que en más o en menos resulte de la prueba.

## II. HECHOS
El día 10 de enero de 2025, el vehículo del actor circulaba por Av. Santa Fe cuando fue colisionado...

## III. DERECHO
Fundo mi derecho en los arts. 1757, 1758 y concordantes del Código Civil y Comercial de la Nación (CCyC).

## IV. PRUEBA
Ofrezco la siguiente prueba: Documental, Testimonial, Informativa y Pericial Mecánica y Médica.

## V. RESERVA DEL CASO FEDERAL
Para el hipotético e improbable caso de que se vulneren garantías constitucionales (arts. 17 y 18 CN), hago expresa reserva del Caso Federal conforme al art. 14 de la Ley 48 para ocurrir ante la Corte Suprema de Justicia de la Nación.

## VI. PETITORIO
Por todo lo expuesto, a V.S. solicito:
1. Me tenga por presentado, por parte y por constituido el domicilio procesal y electrónico.
2. Se corra traslado de la demanda.
3. Se tenga por ofrecida la prueba.
4. Oportunamente se haga lugar a la demanda con costas.
`;
    const report = lintLegalDocument(cleanBrief, 'claim');
    expect(report.isAdmissible).toBe(true);
    expect(report.score).toBe(100);
    expect(report.checks.hasFederalReserve).toBe(true);
    expect(report.checks.hasPetition).toBe(true);
    expect(report.checks.hasFacts).toBe(true);
    expect(report.checks.hasEvidence).toBe(true);
    expect(report.missingPlaceholders).toHaveLength(0);

    const formatted = formatLegalLintReport(report);
    expect(formatted).toContain('AUDITORÍA FORENSE IMPECABLE');
  });
});
