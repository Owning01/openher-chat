import { describe, expect, it } from 'vitest';
import type {
  AdversarialPerspective,
  AnalysisCitation,
  AnalysisItem,
  JudgePostureItem,
  LegalAnalysisBudget,
  LegalPack,
  LegalProvision,
} from '../types/legal';
import {
  ADVERSARIAL_PERSONAS,
  ADVERSARIAL_PERSPECTIVE_ORDER,
  SYNTHESIS_ROLE,
  parseAnalysisResponse,
  planAdversarialCalls,
  synthesizeAnalysis,
} from './adversarial';
import type { AdversarialCallDescriptor, AdversarialCallPlan } from './adversarial';
import { verifyCitations } from './citation';
import { buildLegalSystemPrompt } from './prompt';
import { buildLegalIndex } from './retrieval';

// ---------------------------------------------------------------------------
// Fixture de índice léxico con una provisión real del pack mínimo.
// ---------------------------------------------------------------------------

const PROVISION_2560: LegalProvision = {
  id: 'CCyC-2560',
  normId: 'CCyC',
  article: '2560',
  title: 'Prescripción liberatoria',
  text: 'ARTÍCULO 2560.- El plazo de la prescripción liberatoria se cuenta desde que la obligación es exigible.',
  jurisdiction: 'national',
  sourceUrl: 'https://servicios.infoleg.gob.ar/',
  sourceDate: '2026-01-05',
  textHash: 'hash-2560',
  verificationMethod: 'manual',
  tags: ['prescripcion', 'obligaciones'],
  verified: true,
};

const PACK: LegalPack = {
  schema: 'openher.legal.pack/1',
  id: 'ar-ccyc-core',
  title: 'CCyC núcleo',
  version: '1.0.0',
  publishedAt: '2026-01-05',
  jurisdiction: 'national',
  matter: 'civil-commercial',
  license: {
    name: 'InfoLEG',
    url: 'https://servicios.infoleg.gob.ar/',
    attribution: 'InfoLEG',
  },
  sources: [{ url: 'https://servicios.infoleg.gob.ar/', retrievedAt: '2026-01-05' }],
  norms: [
    {
      id: 'CCyC',
      short: 'CCyC',
      long: 'Código Civil y Comercial de la Nación',
      jurisdiction: 'national',
    },
  ],
  provisions: [PROVISION_2560],
  hash: 'hash-pack',
};

const INDEX = buildLegalIndex([PACK]);

const SYSTEM = buildLegalSystemPrompt({
  locale: 'es',
  perspectives: [...ADVERSARIAL_PERSPECTIVE_ORDER],
  today: '2026-09-14T10:00:00Z',
});

const BRIEF =
  'CASE FILE — REFERENCE DATA ONLY.\n<expediente>\n- hecho: incumplimiento del contrato\n</expediente>\nEND OF CASE FILE DATA.';

const BUDGETS: LegalAnalysisBudget = {
  maxCalls: 5,
  maxTotalTokens: 100_000,
  maxWallClockMs: 120_000,
  maxParallel: 4,
  maxOutputTokensPerPersona: 1024,
};

function callFor(
  plan: AdversarialCallPlan,
  perspective: AdversarialCallDescriptor['perspective'],
): AdversarialCallDescriptor {
  const call = plan.calls.find((entry) => entry.perspective === perspective);
  if (call === undefined) throw new Error(`sin llamada planificada: ${perspective}`);
  return call;
}

function analysisItems(value: AnalysisItem[] | JudgePostureItem[]): AnalysisItem[] {
  return value.filter((item): item is AnalysisItem => 'statement' in item);
}

function judgeItems(value: AnalysisItem[] | JudgePostureItem[]): JudgePostureItem[] {
  return value.filter((item): item is JudgePostureItem => 'thesis' in item);
}

// ---------------------------------------------------------------------------
// planAdversarialCalls
// ---------------------------------------------------------------------------

describe('planAdversarialCalls', () => {
  it('planifica 4 personas + síntesis con system byte-idéntico y rol al final del user', () => {
    const plan = planAdversarialCalls({
      personas: [...ADVERSARIAL_PERSPECTIVE_ORDER],
      brief: BRIEF,
      budgets: BUDGETS,
      systemPrompt: SYSTEM,
      sessionId: 'case-1',
      model: 'test-model',
      outputs: { attack: 'ATAQUE-SENTINEL' },
    });

    expect(plan.calls).toHaveLength(5);
    expect(plan.includedPersonas).toEqual([...ADVERSARIAL_PERSPECTIVE_ORDER]);
    expect(plan.omittedPersonas).toEqual([]);
    expect(plan.synthesisIncluded).toBe(true);
    expect(plan.degradation).toBeNull();
    expect(plan.maxParallel).toBe(BUDGETS.maxParallel);
    expect(plan.sessionId).toBe('case-1');

    const systems = new Set(plan.calls.map((call) => call.system));
    expect(systems.size).toBe(1);
    expect([...systems][0]).toBe(SYSTEM);

    for (const persona of ADVERSARIAL_PERSONAS) {
      const call = callFor(plan, persona.id);
      expect(call.system).not.toContain(persona.role);
      expect(call.user.endsWith(persona.role)).toBe(true);
      expect(call.user).toContain(BRIEF);
      expect(call.user.indexOf(BRIEF)).toBeLessThan(call.user.indexOf(persona.role));
      expect(call.sessionId).toBe('case-1');
      expect(call.model).toBe('test-model');
      expect(call.maxOutputTokens).toBe(BUDGETS.maxOutputTokensPerPersona);
      expect(call.isSynthesis).toBe(false);
    }

    // Ninguna persona ve la salida de otra; la síntesis sí la recibe.
    expect(callFor(plan, 'defense').user).not.toContain('ATAQUE-SENTINEL');
    expect(callFor(plan, 'judge').user).not.toContain('ATAQUE-SENTINEL');

    const synthesis = callFor(plan, 'synthesis');
    expect(synthesis.isSynthesis).toBe(true);
    expect(synthesis.user).toContain(BRIEF);
    expect(synthesis.user).toContain('ATAQUE-SENTINEL');
    expect(synthesis.user.endsWith(SYNTHESIS_ROLE)).toBe(true);
  });

  it('degrada con maxCalls:2 dejando constancia de las omisiones sin lanzar', () => {
    const plan = planAdversarialCalls({
      personas: [...ADVERSARIAL_PERSPECTIVE_ORDER],
      brief: BRIEF,
      budgets: { ...BUDGETS, maxCalls: 2 },
      systemPrompt: SYSTEM,
      sessionId: 'case-2',
      model: 'test-model',
    });

    expect(plan.calls).toHaveLength(2);
    expect(plan.synthesisIncluded).toBe(true);
    expect(plan.includedPersonas).toEqual(['defense']);
    expect(plan.omittedPersonas.map((entry) => entry.persona)).toEqual(['attack', 'judge', 'risk']);
    for (const omission of plan.omittedPersonas) {
      expect(omission.reason).toBe('max-calls');
    }
    expect(plan.degradation).not.toBeNull();
    expect(plan.degradation).toContain('3 de 4 personas omitidas');
    for (const call of plan.calls) {
      expect(call.maxOutputTokens).toBe(BUDGETS.maxOutputTokensPerPersona);
    }
  });

  it('aplica maxOutputTokensPerPersona y degrada sin lanzar con maxCalls:0', () => {
    const zero = planAdversarialCalls({
      personas: [...ADVERSARIAL_PERSPECTIVE_ORDER],
      brief: BRIEF,
      budgets: { ...BUDGETS, maxCalls: 0, maxOutputTokensPerPersona: 256 },
      systemPrompt: SYSTEM,
      sessionId: 'case-3',
      model: 'test-model',
    });

    expect(zero.calls).toEqual([]);
    expect(zero.omittedPersonas).toHaveLength(4);
    expect(zero.synthesisIncluded).toBe(false);
    expect(zero.degradation).not.toBeNull();

    const single = planAdversarialCalls({
      personas: [...ADVERSARIAL_PERSPECTIVE_ORDER],
      brief: BRIEF,
      budgets: { ...BUDGETS, maxCalls: 1, maxOutputTokensPerPersona: 256 },
      systemPrompt: SYSTEM,
      sessionId: 'case-3',
      model: 'test-model',
    });
    expect(single.calls).toHaveLength(1);
    expect(single.calls[0]?.maxOutputTokens).toBe(256);
    expect(single.synthesisIncluded).toBe(false);
  });

  it('degrada por presupuesto de tokens con motivo token-budget', () => {
    const plan = planAdversarialCalls({
      personas: [...ADVERSARIAL_PERSPECTIVE_ORDER],
      brief: BRIEF,
      budgets: { ...BUDGETS, maxCalls: 5, maxTotalTokens: 2048, maxOutputTokensPerPersona: 1024 },
      systemPrompt: SYSTEM,
      sessionId: 'case-4',
      model: 'test-model',
    });

    expect(plan.calls).toHaveLength(2);
    expect(plan.includedPersonas).toEqual(['defense']);
    expect(plan.omittedPersonas.every((entry) => entry.reason === 'token-budget')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseAnalysisResponse
// ---------------------------------------------------------------------------

describe('parseAnalysisResponse', () => {
  it('parsea JSON puro y completa basis verificando las citas del ítem', () => {
    const raw = JSON.stringify([
      {
        statement: 'La acción prescribe por el plazo legal.',
        basis: ['art. 2560 CCyC'],
        kind: 'attack',
        strength: 'high',
        confidence: 0.8,
        evidenceRefs: ['fact-1'],
      },
    ]);

    const parsed = analysisItems(parseAnalysisResponse('attack', raw, INDEX));
    expect(parsed).toHaveLength(1);
    const item = parsed[0];
    if (item === undefined) throw new Error('sin ítem');
    expect(item.perspective).toBe('attack');
    expect(item.kind).toBe('attack');
    expect(item.strength).toBe('high');
    expect(item.confidence).toBe(0.8);
    expect(item.evidenceRefs).toEqual(['fact-1']);
    expect(item.basis).toHaveLength(1);
    expect(item.basis[0]).toMatchObject({
      normId: 'CCyC',
      article: '2560',
      status: 'verified',
      packId: 'ar-ccyc-core',
      packVersion: '1.0.0',
    });
  });

  it('parsea JSON dentro de un fence ```json', () => {
    const fenced = `\`\`\`json\n${JSON.stringify({
      items: [{ statement: 'Defensa basada en el pago.', basis: ['art. 2560 CCyC'] }],
    })}\n\`\`\``;

    const parsed = analysisItems(parseAnalysisResponse('defense', fenced, INDEX));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.statement).toBe('Defensa basada en el pago.');
    expect(parsed[0]?.strength).toBe('medium');
  });

  it('parsea texto libre en viñetas y aplica defaults razonables', () => {
    const free = '- La pretensión carece de sustento fáctico.\n- El daño no está probado.\n';
    const parsed = analysisItems(parseAnalysisResponse('risk', free, INDEX));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.statement).toBe('La pretensión carece de sustento fáctico.');
    expect(parsed[0]?.perspective).toBe('risk');
    expect(parsed[0]?.kind).toBe('risk');
    expect(parsed[0]?.confidence).toBe(0.5);
    expect(parsed[0]?.basis).toEqual([]);
  });

  it('degrada sin lanzar con basura total y con string vacío', () => {
    expect(() => parseAnalysisResponse('attack', '??? ,,, .', INDEX)).not.toThrow();
    expect(parseAnalysisResponse('attack', '??? ,,, .', INDEX)).toEqual([]);
    expect(parseAnalysisResponse('attack', '', INDEX)).toEqual([]);
    expect(() => parseAnalysisResponse('judge', '{{{{ not json', INDEX)).not.toThrow();
  });

  it('descarta ítems malformados sin tirar el resto del lote', () => {
    const raw = JSON.stringify([
      { strength: 'high' },
      { statement: 'Ítem válido tras el malformado.' },
      { statement: 42 },
    ]);
    const parsed = analysisItems(parseAnalysisResponse('defense', raw, INDEX));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.statement).toBe('Ítem válido tras el malformado.');
  });

  it('parsea la postura del juez como JudgePostureItem con leaning por defecto', () => {
    const raw = JSON.stringify([
      { thesis: 'La prescripción es favorable.', leaning: 'favorable', confidence: 0.9, basis: ['art. 2560 CCyC'] },
      { thesis: 'La notificación es dudosa.' },
    ]);
    const parsed = judgeItems(parseAnalysisResponse('judge', raw, INDEX));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.leaning).toBe('favorable');
    expect(parsed[0]?.basis[0]?.status).toBe('verified');
    expect(parsed[1]?.leaning).toBe('unclear');
    expect(parsed[1]?.confidence).toBe(0.5);
  });

  it('marca verified la cita presente, unverified la inventada y unverified el fallo', () => {
    const raw = JSON.stringify([
      {
        statement: 'Tesis con citas.',
        basis: ['art. 2560 CCyC', 'art. 9999 CCyC', 'fallo CSJN'],
      },
    ]);
    const parsed = analysisItems(parseAnalysisResponse('attack', raw, INDEX));
    const item = parsed[0];
    if (item === undefined) throw new Error('sin ítem');

    const present = item.basis.find((citation) => citation.article === '2560');
    const invented = item.basis.find((citation) => citation.article === '9999');
    const fallo = item.basis.find(
      (citation) => citation.normId === null && citation.raw.toLowerCase().includes('csjn'),
    );

    expect(present?.status).toBe('verified');
    expect(invented?.status).toBe('unverified');
    expect(invented?.packId).toBeNull();
    expect(fallo?.status).toBe('unverified');

    // El motivo `external-kind` lo garantiza el guard subyacente.
    const guard = verifyCitations('fallo CSJN', INDEX);
    expect(guard.verdicts.some((verdict) => verdict.status === 'unverified' && verdict.reason === 'external-kind')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// synthesizeAnalysis
// ---------------------------------------------------------------------------

function citation(
  status: 'verified' | 'unverified',
  normId: string | null,
  article: string | null,
): AnalysisCitation {
  return {
    raw: `${normId ?? ''} ${article ?? ''}`.trim(),
    normId,
    article,
    packId: status === 'verified' ? 'ar-ccyc-core' : null,
    packVersion: status === 'verified' ? '1.0.0' : null,
    status,
    fidelity: 'not-applicable',
  };
}

describe('synthesizeAnalysis', () => {
  const defenseItem: AnalysisItem = {
    id: 'defense-1',
    perspective: 'defense',
    kind: 'defense',
    statement: 'Defensa de prescripción',
    basis: [citation('verified', 'CCyC', '2560')],
    evidenceRefs: ['fact-1'],
    strength: 'high',
    confidence: 0.7,
  };
  const attackItem: AnalysisItem = {
    id: 'attack-1',
    perspective: 'attack',
    kind: 'attack',
    statement: 'Falta de legitimación',
    basis: [citation('unverified', null, null)],
    evidenceRefs: [],
    strength: 'medium',
    confidence: 0.5,
  };
  const attackDuplicate: AnalysisItem = {
    id: 'attack-2',
    perspective: 'attack',
    kind: 'attack',
    statement: 'Falta de legitimación.',
    basis: [citation('verified', 'CCyC', '2560')],
    evidenceRefs: ['fact-1', 'fact-1'],
    strength: 'low',
    confidence: 0.9,
  };
  const questionItem: AnalysisItem = {
    id: 'attack-3',
    perspective: 'attack',
    kind: 'question',
    statement: '¿Se notificó válidamente?',
    basis: [],
    evidenceRefs: [],
    strength: 'low',
    confidence: 0.4,
  };
  const riskItem: AnalysisItem = {
    id: 'risk-1',
    perspective: 'risk',
    kind: 'risk',
    statement: 'Riesgo de costas',
    basis: [],
    evidenceRefs: [],
    strength: 'medium',
    confidence: 0.6,
  };
  const judgeItem: JudgePostureItem = {
    id: 'judge-1',
    thesis: 'Prescripción',
    leaning: 'favorable',
    basis: [citation('verified', 'CCyC', '2560')],
    confidence: 0.8,
  };

  const raw: Record<AdversarialPerspective, string> = {
    defense: 'RAW-DEFENSE',
    attack: 'RAW-ATTACK',
    judge: 'RAW-JUDGE',
    risk: 'RAW-RISK',
  };

  const input = {
    id: 'analysis-1',
    caseId: 'case-1',
    createdAt: 1_700_000_000_000,
    providerId: 'provider-x',
    modelId: 'model-y',
    packs: [{ id: 'ar-ccyc-core', version: '1.0.0' }],
    raw,
    items: {
      defense: [defenseItem],
      attack: [attackItem, attackDuplicate, questionItem],
      judge: [judgeItem],
      risk: [riskItem],
    },
    synthesis: 'Síntesis final consolidada.',
    incomplete: false,
  };

  it('enruta por tipo, deduplica y conserva el raw por perspectiva', () => {
    const analysis = synthesizeAnalysis(input);

    expect(analysis.id).toBe('analysis-1');
    expect(analysis.caseId).toBe('case-1');
    expect(analysis.createdAt).toBe(1_700_000_000_000);
    expect(analysis.providerId).toBe('provider-x');
    expect(analysis.modelId).toBe('model-y');
    expect(analysis.packs).toEqual([{ id: 'ar-ccyc-core', version: '1.0.0' }]);
    expect(analysis.synthesis).toBe('Síntesis final consolidada.');
    expect(analysis.incomplete).toBe(false);
    expect(analysis.raw).toEqual(raw);

    expect(analysis.attacks).toHaveLength(1);
    expect(analysis.defenses).toHaveLength(1);
    expect(analysis.risks).toHaveLength(1);
    expect(analysis.openQuestions).toHaveLength(1);
    expect(analysis.judgePosture).toHaveLength(1);

    // Dedupe determinista: el duplicado se fusiona conservando ambas citas.
    const attack = analysis.attacks[0];
    if (attack === undefined) throw new Error('sin ataque');
    expect(attack.id).toBe('attack-1');
    expect(attack.basis).toHaveLength(2);
    expect(attack.evidenceRefs).toEqual(['fact-1']);
    expect(attack.confidence).toBe(0.9);
  });

  it('cuenta las citas de todos los ítems consolidados', () => {
    const analysis = synthesizeAnalysis(input);
    // attaque fusionado (1 verified + 1 unverified) + defensa (1) + juez (1).
    expect(analysis.citations).toEqual({ verified: 3, unverified: 1 });
  });

  it('es determinista ante la misma entrada', () => {
    expect(synthesizeAnalysis(input)).toEqual(synthesizeAnalysis(input));
  });
});
