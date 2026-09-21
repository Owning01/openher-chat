/**
 * Linter Jurídico Forense (OpenHer Chat):
 * Sensor procesal de alta velocidad ("Keep Quality Left") para escritos judiciales.
 * Evalúa vicios de forma, causales de excepción previa de defecto legal (art. 347 inc. 5 CPCCN),
 * vigencia normativa (CCyC vs. Código de Vélez derogado), reserva del caso federal (art. 14 Ley 48),
 * ofrecimiento oportuno de prueba (art. 333 CPCCN), congruencia petitoria y acordadas CSJN.
 */

import type { DocumentKind } from '../types/legal';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  rule: string;
  message: string;
  remedy: string;
}

export interface LegalLintReport {
  isAdmissible: boolean;
  score: number; // 0 a 100
  summary: string;
  issues: LintIssue[];
  metrics: {
    wordCount: number;
    charCount: number;
    estimatedPages: number;
  };
  checks: {
    hasFederalReserve: boolean;
    hasPetition: boolean;
    hasFacts: boolean;
    hasLaw: boolean;
    hasEvidence: boolean;
    hasParties: boolean;
    hasElectronicDomicile: boolean;
    hasDerogatedCitations: boolean;
    hasUnresolvedPlaceholders: boolean;
  };
  derogatedCitations: string[];
  missingPlaceholders: string[];
}

export const WORDS_PER_JUDICIAL_PAGE = 350;

/**
 * Ejecuta el linter forense completo sobre un texto en Markdown de un escrito judicial.
 */
export function lintLegalDocument(
  markdown: string,
  kind?: DocumentKind | null,
): LegalLintReport {
  const text = markdown.trim();
  const lower = text.toLowerCase();

  const words = text === '' ? [] : text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const charCount = text.length;
  const estimatedPages = Math.max(1, Math.round((wordCount / WORDS_PER_JUDICIAL_PAGE) * 10) / 10);

  const issues: LintIssue[] = [];

  // =========================================================================
  // REGLA 1: Marcadores pendientes y huecos fácticos (Unresolved Placeholders)
  // =========================================================================
  const missingPlaceholders: string[] = [];
  const placeholderPatterns = [
    /\[COMPLETAR:[^\]]*\]/gi,
    /\[INSERTAR:[^\]]*\]/gi,
    /\[INSERTAR[^\]]*\]/gi,
    /\[VERIFICAR:[^\]]*\]/gi,
    /(?:DNI|CUIT|CUIL)\s*(?:N[°º]|número)?\s*(?:XX\.XXX\.XXX|\.\.\.|__+)/gi,
    /\$\s*\[[^\]]+\]|\$\s*(?:XX\.XXX|__+)/gi,
    /domiciliad[oa]\s+en\s+(?:la\s+calle\s+)?\[[^\]]*\]/gi,
  ];

  for (const pattern of placeholderPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (!missingPlaceholders.includes(match[0])) {
        missingPlaceholders.push(match[0]);
      }
    }
  }

  const hasUnresolvedPlaceholders = missingPlaceholders.length > 0;
  if (hasUnresolvedPlaceholders) {
    issues.push({
      severity: 'error',
      code: 'unresolved_placeholders',
      rule: 'Completitud Fáctica Ineludible',
      message: `Se detectaron ${missingPlaceholders.length} marcadores provisionales o datos pendientes sin completar en el escrito.`,
      remedy: 'Reemplazar corchetes y datos temporales ([COMPLETAR], DNI XX, $ [MONTO]) por los datos definitivos del caso antes de su presentación.',
    });
  }

  // =========================================================================
  // REGLA 2: Requisitos de la Demanda / Defecto Legal (Arts. 40, 330 y 347 inc. 5 CPCCN)
  // =========================================================================
  const isInitiatingBrief = kind === 'claim' || kind === 'counterclaim' || (!kind && (lower.includes('promueve demanda') || lower.includes('inicia demanda')));
  const isAnsweringBrief = kind === 'answer' || (!kind && lower.includes('contesta demanda'));

  const hasPetition =
    lower.includes('petitorio') ||
    lower.includes('solicito') ||
    lower.includes('petición') ||
    lower.includes('a v.s. pido') ||
    lower.includes('a v.e. pido');

  const hasFacts =
    lower.includes('hechos') ||
    lower.includes('relato') ||
    lower.includes('antecedentes') ||
    lower.includes('primer agravio') ||
    lower.includes('segundo agravio');

  const hasLaw =
    lower.includes('derecho') ||
    lower.includes('fundamento') ||
    lower.includes('doctrina y jurisprudencia') ||
    lower.includes('normativa aplicable');

  const hasObject =
    lower.includes('objeto') ||
    lower.includes('vengo a demandar') ||
    lower.includes('promuevo formal demanda') ||
    lower.includes('pretensión');

  const hasParties =
    lower.includes('por derecho propio') ||
    lower.includes('en representación') ||
    lower.includes('en nombre y representación') ||
    lower.includes('apoderado') ||
    lower.includes('patrocinio letrado') ||
    lower.includes('demandado') ||
    lower.includes('demandada');

  const hasElectronicDomicile =
    lower.includes('domicilio electrónico') ||
    lower.includes('cuit') ||
    lower.includes('cuil') ||
    lower.includes('casillero virtual') ||
    lower.includes('portal de notificaciones') ||
    lower.includes('zona de notificación');

  if (isInitiatingBrief) {
    if (!hasObject) {
      issues.push({
        severity: 'error',
        code: 'defect_legal_objeto',
        rule: 'Art. 330 inc. 3 CPCCN',
        message: 'Falta individualización clara y precisa de la cosa demandada u objeto litigioso.',
        remedy: 'Incorporar el capítulo "I. OBJETO" precisando qué se demanda y el monto pretendido o fórmula de rigor.',
      });
    }

    if (!hasFacts) {
      issues.push({
        severity: 'error',
        code: 'defect_legal_hechos',
        rule: 'Art. 330 inc. 4 CPCCN',
        message: 'Omisión de la relación circunstanciada de los hechos en que se funda la pretensión.',
        remedy: 'Añadir el capítulo "HECHOS" relatando minuciosamente tiempo, modo y lugar del evento.',
      });
    }

    if (!hasElectronicDomicile) {
      issues.push({
        severity: 'warning',
        code: 'defect_legal_domicilio_electronico',
        rule: 'Art. 40 CPCCN y Acordadas CSJN',
        message: 'No se detectó constitución expresa de domicilio electrónico / CUIT del letrado.',
        remedy: 'Indicar domicilio procesal físico y domicilio electrónico constituido en el encabezado.',
      });
    }

    if (!hasLaw) {
      issues.push({
        severity: 'warning',
        code: 'defect_legal_derecho',
        rule: 'Art. 330 inc. 5 CPCCN',
        message: 'No se identificó acápite de derecho y fundamentación jurídica expresa.',
        remedy: 'Incorporar el capítulo "DERECHO" citando los artículos y leyes aplicables al reclamo.',
      });
    }
  }

  if (!hasPetition) {
    issues.push({
      severity: 'error',
      code: 'defect_legal_petitorio',
      rule: 'Art. 330 inc. 6 CPCCN',
      message: 'Falta petitorio en términos claros, precisos y positivos.',
      remedy: 'Incorporar el acápite final "PETITORIO" enumerando los pronunciamientos requeridos a V.S.',
    });
  }

  // =========================================================================
  // REGLA 3: Citas de Normativa Derogada (Código de Vélez Sarsfield Ley 340)
  // =========================================================================
  const derogatedCitations: string[] = [];
  const derogatedPatterns: Array<{ regex: RegExp; citation: string; validAlternative: string }> = [
    {
      regex: /\bCódigo\s+Civil\b(?!\s*y\s*Comercial)(?!\s*de\s*la\s*Nación)/gi,
      citation: 'Código Civil (Ley 340)',
      validAlternative: 'Código Civil y Comercial de la Nación (Ley 26.994, vigente desde 2015)',
    },
    {
      regex: /art(?:ículo|\.)?\s*1109\b(?!\s*ccyc|\s*cccn)/gi,
      citation: 'Art. 1109 Código Civil de Vélez (responsabilidad culposa)',
      validAlternative: 'Art. 1757 / 1758 del CCyC (factor objetivo / riesgo de la cosa)',
    },
    {
      regex: /art(?:ículo|\.)?\s*1078\b(?!\s*ccyc|\s*cccn)/gi,
      citation: 'Art. 1078 Código Civil de Vélez (daño moral)',
      validAlternative: 'Art. 1741 del CCyC (consecuencias no patrimoniales)',
    },
    {
      regex: /art(?:ículo|\.)?\s*1113\b(?!\s*ccyc|\s*cccn)/gi,
      citation: 'Art. 1113 Código Civil de Vélez (daño por el vicio o riesgo)',
      validAlternative: 'Art. 1757 y 1758 del CCyC (responsabilidad del dueño y guardián)',
    },
    {
      regex: /art(?:ículo|\.)?\s*505\b(?!\s*ccyc|\s*cccn)/gi,
      citation: 'Art. 505 Código Civil de Vélez (efectos de las obligaciones)',
      validAlternative: 'Art. 730 del CCyC',
    },
    {
      regex: /art(?:ículo|\.)?\s*1198\b(?!\s*ccyc|\s*cccn)/gi,
      citation: 'Art. 1198 Código Civil de Vélez (buena fe contractual)',
      validAlternative: 'Art. 961 del CCyC',
    },
    {
      regex: /\bley\s*17\.?711\b/gi,
      citation: 'Ley 17.711 (reforma de 1968 al Código derogado)',
      validAlternative: 'Código Civil y Comercial de la Nación',
    },
  ];

  for (const { regex, citation, validAlternative } of derogatedPatterns) {
    if (regex.test(text)) {
      derogatedCitations.push(citation);
      issues.push({
        severity: 'warning',
        code: 'norma_derogada_velez',
        rule: 'Vigencia Normativa CCyC (Ley 26.994)',
        message: `Se detectó cita a normativa derogada en 2015: "${citation}".`,
        remedy: `Sustituir por la norma aplicable del CCyC: ${validAlternative}.`,
      });
    }
  }
  const hasDerogatedCitations = derogatedCitations.length > 0;

  // =========================================================================
  // REGLA 4: Reserva del Caso Federal (Art. 14 Ley 48)
  // =========================================================================
  const hasFederalReserve =
    lower.includes('caso federal') ||
    lower.includes('ley 48') ||
    lower.includes('art. 14') ||
    lower.includes('artículo 14 de la ley 48') ||
    lower.includes('cuestión federal');

  if (!hasFederalReserve && (isInitiatingBrief || isAnsweringBrief || kind === 'appeal')) {
    issues.push({
      severity: 'warning',
      code: 'falta_reserva_caso_federal',
      rule: 'Ley 48 art. 14; Acordadas CSJN',
      message: 'Ausencia de la Reserva del Caso Federal en el escrito.',
      remedy: 'Introducir el acápite "RESERVA DEL CASO FEDERAL" invocando agravio constitucional (arts. 17 y 18 CN y art. 14 Ley 48) para no precluir el Recurso Extraordinario Federal.',
    });
  }

  // =========================================================================
  // REGLA 5: Ofrecimiento Oportuno de Prueba (Art. 333 CPCCN)
  // =========================================================================
  const hasEvidence =
    lower.includes('prueba') ||
    lower.includes('ofrezco prueba') ||
    lower.includes('documental') ||
    lower.includes('prueba pericial') ||
    lower.includes('prueba informativa') ||
    lower.includes('prueba testimonial');

  if (isInitiatingBrief && !hasEvidence) {
    issues.push({
      severity: 'error',
      code: 'falta_ofrecimiento_prueba',
      rule: 'Art. 333 CPCCN (Preclusión Probatoria)',
      message: 'Omisión del capítulo de ofrecimiento de prueba. La documental no acompañada con la demanda precluye.',
      remedy: 'Incorporar el acápite "PRUEBA" detallando Documental, Pericial (con puntos de pericia), Informativa y Testimonial.',
    });
  }

  // =========================================================================
  // REGLA 6: Congruencia Fáctica y Petitoria (Art. 163 inc. 6 CPCCN)
  // =========================================================================
  const damageCategories = [
    { label: 'daño moral / extrapatrimonial', terms: ['daño moral', 'consecuencias no patrimoniales', 'daño extrapatrimonial'] },
    { label: 'incapacidad sobreviniente', terms: ['incapacidad física', 'incapacidad sobreviniente', 'secuela incapacitante'] },
    { label: 'lucro cesante', terms: ['lucro cesante', 'pérdida de ingresos', 'ganancias frustradas'] },
    { label: 'daño psicológico', terms: ['daño psicológico', 'tratamiento psicológico', 'psiquiatría'] },
  ];

  if (hasFacts && hasPetition) {
    const petitionIndex = lower.indexOf('petitorio');
    const petitionText = petitionIndex >= 0 ? lower.slice(petitionIndex) : lower;
    const factsText = petitionIndex >= 0 ? lower.slice(0, petitionIndex) : lower;

    for (const cat of damageCategories) {
      const mentionedInFacts = cat.terms.some((t) => factsText.includes(t));
      const mentionedInPetition = cat.terms.some((t) => petitionText.includes(t));
      if (mentionedInFacts && !mentionedInPetition) {
        issues.push({
          severity: 'info',
          code: 'incongruencia_rubros_petitorio',
          rule: 'Principio de Congruencia (Art. 163 inc. 6 CPCCN)',
          message: `El relato fáctico menciona "${cat.label}" pero dicho rubro no está peticionado explícitamente en el petitorio final.`,
          remedy: `Revisar los puntos del petitorio para asegurar que "${cat.label}" quede peticionado y cuantificado expresamente.`,
        });
      }
    }
  }

  // =========================================================================
  // REGLA 7: Métricas Forenses y Acordadas CSJN
  // =========================================================================
  if (kind === 'appeal' && estimatedPages > 40) {
    issues.push({
      severity: 'warning',
      code: 'limite_fojas_acordada_csjn',
      rule: 'Acordada CSJN 4/2007 Art. 1',
      message: `El recurso proyecta ~${estimatedPages} fojas, excediendo el límite de 40 páginas reglamentarias de la CSJN.`,
      remedy: 'Sintetizar agravios para cumplir con el máximo de 40 carátulas reglamentadas.',
    });
  }

  // Cálculo de Score y Admisibilidad
  const hasErrors = issues.some((i) => i.severity === 'error');
  const hasWarnings = issues.some((i) => i.severity === 'warning');

  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 25;
    else if (issue.severity === 'warning') score -= 10;
    else if (issue.severity === 'info') score -= 5;
  }
  score = Math.max(0, Math.min(100, score));

  const isAdmissible = !hasErrors;
  let summary = 'Escrito judicial procesalmente admisible.';
  if (hasErrors) {
    summary = 'Escrito con defectos procesales graves que impiden su presentación válida.';
  } else if (hasWarnings) {
    summary = 'Escrito admisible con observaciones de técnica forense a considerar.';
  }

  return {
    isAdmissible,
    score,
    summary,
    issues,
    metrics: {
      wordCount,
      charCount,
      estimatedPages,
    },
    checks: {
      hasFederalReserve,
      hasPetition,
      hasFacts,
      hasLaw,
      hasEvidence,
      hasParties,
      hasElectronicDomicile,
      hasDerogatedCitations,
      hasUnresolvedPlaceholders,
    },
    derogatedCitations,
    missingPlaceholders,
  };
}

/** Formatea el informe del Linter en un diagnóstico legible para el Agente y el Abogado. */
export function formatLegalLintReport(report: LegalLintReport): string {
  const lines: string[] = [];

  const statusBadge = report.isAdmissible
    ? report.issues.length === 0
      ? '✅ AUDITORÍA FORENSE IMPECABLE (100/100)'
      : `⚠️ AUDITORÍA FORENSE ADMISIBLE CON OBSERVACIONES (${report.score}/100)`
    : `❌ AUDITORÍA FORENSE: INADMISIBLE POR DEFECTO FORMAL (${report.score}/100)`;

  lines.push(statusBadge);
  lines.push(`• Volumen: ~${report.metrics.estimatedPages} fojas judiciales (${report.metrics.wordCount} palabras)`);
  lines.push(
    `• Reserva Caso Federal (art. 14 Ley 48): ${report.checks.hasFederalReserve ? 'PRESENTE' : 'AUSENTE (Atención)'}`,
  );
  lines.push(`• Petitorio explícito: ${report.checks.hasPetition ? 'PRESENTE' : 'AUSENTE'}`);
  lines.push(`• Citas normas derogadas: ${report.checks.hasDerogatedCitations ? 'DETECTADAS (Corregir)' : 'NINGUNA'}`);
  lines.push(`• Marcadores pendientes: ${report.missingPlaceholders.length}`);

  if (report.issues.length > 0) {
    lines.push('');
    lines.push('Detalle de Hallazgos del Linter Jurídico:');
    for (const issue of report.issues) {
      const icon = issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      lines.push(`${icon} [${issue.rule}] ${issue.message}`);
      lines.push(`   Solución: ${issue.remedy}`);
    }
  }

  return lines.join('\n');
}
