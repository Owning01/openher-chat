import { describe, expect, it } from 'vitest';

import { ADVERSARIAL_PERSONAS } from '@/domain/legal/adversarial';
import type { AdversarialCallDescriptor } from '@/domain/legal/adversarial';
import { buildLegalIndex } from '@/domain/legal/retrieval';
import type { CreateLegalCaseInput, LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type {
  AdversarialPerspective,
  CaseAnalysis,
  LegalAnalysisBudget,
  LegalCase,
  LegalIndex,
  LegalPack,
  LegalProvision,
} from '@/domain/types/legal';
import { MemoryConversationRepository, MemoryLegalCaseRepository } from '@/test/fakes/MemoryRepos';

import { ANALYSIS_QUOTA_ERROR, createAnalysisStore } from './analysisStore';
import type { ExecuteAdversarialCall, RunAnalysisInput } from './analysisStore';
import { createCaseStore } from './caseStore';

// ---------------------------------------------------------------------------
// Fixtures: índice mínimo, presupuestos y respuestas crudas por persona.
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

const INDEX: LegalIndex = buildLegalIndex([PACK]);

const BUDGETS: LegalAnalysisBudget = {
  maxCalls: 5,
  maxTotalTokens: 100_000,
  maxWallClockMs: 120_000,
  maxParallel: 2,
  maxOutputTokensPerPersona: 512,
};

const SYSTEM = 'SYSTEM-LEGAL-SCAFFOLD';
const BRIEF = 'CASE FILE — REFERENCE DATA ONLY.\n<expediente>\n- hecho: incumplimiento del contrato\n</expediente>';

const PERSONA_RAW: Record<AdversarialPerspective, string> = {
  defense: JSON.stringify([
    {
      statement: 'La obligación se extinguió por pago íntegro antes de la demanda.',
      basis: ['art. 2560 CCyC'],
      kind: 'defense',
      strength: 'high',
      confidence: 0.8,
    },
  ]),
  attack: JSON.stringify([
    {
      statement: 'La prescripción invocada no resulta aplicable a este reclamo.',
      basis: ['art. 9999 CCyC'],
      kind: 'attack',
      strength: 'medium',
      confidence: 0.6,
    },
  ]),
  judge: JSON.stringify([
    {
      thesis: 'La prescripción aparece favorable a la defensa.',
      leaning: 'favorable',
      confidence: 0.7,
      basis: ['art. 2560 CCyC'],
    },
  ]),
  risk: JSON.stringify([
    {
      statement: 'Existe riesgo de costas si la defensa de prescripción fracasa.',
      kind: 'risk',
      strength: 'low',
      confidence: 0.4,
    },
  ]),
};

const SYNTHESIS_RAW = 'Síntesis consolidada de las cuatro personas.';

function makeCaseInput(overrides: Partial<CreateLegalCaseInput> = {}): CreateLegalCaseInput {
  return {
    title: 'Caso testigo',
    jurisdiction: 'national',
    court: 'Juzgado 1',
    matter: 'civil',
    clientRole: 'plaintiff',
    ...overrides,
  };
}

function makeInput(overrides: Partial<RunAnalysisInput> = {}): RunAnalysisInput {
  return {
    caseId: 'case-1',
    brief: BRIEF,
    systemPrompt: SYSTEM,
    budgets: { ...BUDGETS },
    index: INDEX,
    providerId: 'provider-test',
    modelId: 'model-test',
    packs: [{ id: 'ar-ccyc-core', version: '1.0.0' }],
    ...overrides,
  };
}

function abortError(): Error {
  const error = new Error('Llamada abortada.');
  error.name = 'AbortError';
  return error;
}

interface CallLog {
  descriptors: AdversarialCallDescriptor[];
  maxActive: number;
}

/** Fake de `executeCall`: respuestas JSON por persona, fallos opcionales y tracking de concurrencia. */
function makeRecordingExecuteCall(
  options: {
    fail?: Partial<Record<AdversarialPerspective | 'synthesis', string>>;
    delayMs?: number;
  } = {},
): { executeCall: ExecuteAdversarialCall; log: CallLog } {
  const log: CallLog = { descriptors: [], maxActive: 0 };
  let active = 0;
  const executeCall: ExecuteAdversarialCall = async (descriptor, signal) => {
    log.descriptors.push(descriptor);
    active += 1;
    log.maxActive = Math.max(log.maxActive, active);
    try {
      const failure = options.fail?.[descriptor.perspective];
      if (typeof failure === 'string') throw new Error(failure);
      const delayMs = options.delayMs ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(abortError());
            },
            { once: true },
          );
        });
      }
      if (signal.aborted) throw abortError();
      const perspective = descriptor.perspective;
      if (perspective === 'synthesis') return SYNTHESIS_RAW;
      return PERSONA_RAW[perspective];
    } finally {
      active -= 1;
    }
  };
  return { executeCall, log };
}

/** Fake bloqueado hasta liberar el gate; respeta el abort de `stop()`. */
function makeBlockingExecuteCall(gate: Promise<void>): ExecuteAdversarialCall {
  return async (descriptor, signal) => {
    if (signal.aborted) throw abortError();
    await gate;
    if (signal.aborted) throw abortError();
    const perspective = descriptor.perspective;
    if (perspective === 'synthesis') return SYNTHESIS_RAW;
    return PERSONA_RAW[perspective];
  };
}

/** Fake que nunca resuelve salvo por abort; para probar `stop()`. */
function makeHangingExecuteCall(): ExecuteAdversarialCall {
  return (_descriptor, signal) =>
    new Promise<string>((_resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
}

function makeGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

class FailingListCases extends MemoryLegalCaseRepository {
  override async list(): Promise<LegalCase[]> {
    throw new Error('IndexedDB caído');
  }
}

class FailingCreateCases extends MemoryLegalCaseRepository {
  override async create(_input: CreateLegalCaseInput): Promise<LegalCase> {
    throw new Error('persistencia caída');
  }
}

/** Simula la cuota excedida del dispositivo al persistir el análisis. */
class QuotaCases extends MemoryLegalCaseRepository {
  override async appendAnalysis(_analysis: CaseAnalysis): Promise<void> {
    const error = new Error('Cuota de almacenamiento excedida.');
    error.name = 'QuotaExceededError';
    throw error;
  }
}

// ---------------------------------------------------------------------------
// caseStore
// ---------------------------------------------------------------------------

describe('caseStore', () => {
  it('crea, lista, carga, actualiza y elimina sin tumbar la UI', async () => {
    const repo = new MemoryLegalCaseRepository();
    const store = createCaseStore({ cases: repo });

    await store.getState().list();
    expect(store.getState().status).toBe('idle');
    expect(store.getState().cases).toHaveLength(0);

    const created = await store.getState().create(makeCaseInput({ title: 'Demanda por incumplimiento' }));
    expect(created).not.toBeNull();
    if (created === null) throw new Error('sin caso creado');
    expect(created.title).toBe('Demanda por incumplimiento');
    expect(store.getState().selectedId).toBe(created.id);
    expect(store.getState().selected()?.id).toBe(created.id);

    await store.getState().list();
    expect(store.getState().cases.map((item) => item.id)).toEqual([created.id]);

    const loaded = await store.getState().load(created.id);
    expect(loaded?.id).toBe(created.id);

    const updated = await store.getState().update(created.id, { title: 'Demanda actualizada' });
    expect(updated?.title).toBe('Demanda actualizada');
    expect(store.getState().selected()?.title).toBe('Demanda actualizada');

    const removed = await store.getState().remove(created.id);
    expect(removed).toBe(true);
    expect(store.getState().cases).toHaveLength(0);
    expect(store.getState().selectedId).toBeNull();
    expect(await repo.get(created.id)).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it('linkConversation vincula y desvincula vía update({ legalCaseId })', async () => {
    const cases = new MemoryLegalCaseRepository();
    const conversations = new MemoryConversationRepository();
    const store = createCaseStore({ cases, conversations });

    const created = await store.getState().create(makeCaseInput());
    if (created === null) throw new Error('sin caso creado');
    const conversation = await conversations.create({ title: 'Chat del caso' });

    await store.getState().linkConversation(created.id, conversation.id);
    expect((await conversations.get(conversation.id))?.legalCaseId).toBe(created.id);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().error).toBeNull();

    await store.getState().linkConversation(created.id, null);
    expect((await conversations.get(conversation.id))?.legalCaseId).toBeNull();
    expect(store.getState().status).toBe('idle');
  });

  it('linkConversation sin repo de conversaciones sólo selecciona, sin lanzar', async () => {
    const store = createCaseStore({ cases: new MemoryLegalCaseRepository() });
    const created = await store.getState().create(makeCaseInput());
    if (created === null) throw new Error('sin caso creado');

    await store.getState().linkConversation(created.id, 'conv-x');

    expect(store.getState().selectedId).toBe(created.id);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().error).toBeNull();
  });

  it('remove desvincula las conversaciones con ese legalCaseId y deja las demás', async () => {
    const cases = new MemoryLegalCaseRepository();
    const conversations = new MemoryConversationRepository();
    const store = createCaseStore({ cases, conversations });

    const created = await store.getState().create(makeCaseInput());
    if (created === null) throw new Error('sin caso creado');
    const linked = await conversations.create({ title: 'Chat del caso' });
    await conversations.update(linked.id, { legalCaseId: created.id });
    const other = await conversations.create({ title: 'Chat general' });
    // Segundo caso con su propio vínculo: no debe tocarse.
    const second = await store.getState().create(makeCaseInput({ title: 'Otro caso' }));
    if (second === null) throw new Error('sin segundo caso');
    const secondChat = await conversations.create({ title: 'Chat del otro' });
    await conversations.update(secondChat.id, { legalCaseId: second.id });

    const removed = await store.getState().remove(created.id);

    expect(removed).toBe(true);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().error).toBeNull();
    expect((await conversations.get(linked.id))?.legalCaseId).toBeNull();
    expect((await conversations.get(other.id))?.legalCaseId).toBeUndefined();
    expect((await conversations.get(secondChat.id))?.legalCaseId).toBe(second.id);
  });

  it('remove sin repo de conversaciones borra igual (degradación documentada)', async () => {
    const store = createCaseStore({ cases: new MemoryLegalCaseRepository() });
    const created = await store.getState().create(makeCaseInput());
    if (created === null) throw new Error('sin caso creado');

    const removed = await store.getState().remove(created.id);

    expect(removed).toBe(true);
    expect(store.getState().cases).toHaveLength(0);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().error).toBeNull();
  });

  it('expone el error de persistencia sin lanzar', async () => {
    const store = createCaseStore({ cases: new FailingListCases() });

    await store.getState().list();

    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe('IndexedDB caído');
    expect(store.getState().cases).toHaveLength(0);

    const creator = createCaseStore({ cases: new FailingCreateCases() });
    const created = await creator.getState().create(makeCaseInput());

    expect(created).toBeNull();
    expect(creator.getState().status).toBe('error');
    expect(creator.getState().error).toBe('persistencia caída');

    creator.getState().dismissError();
    expect(creator.getState().error).toBeNull();
    expect(creator.getState().status).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// analysisStore
// ---------------------------------------------------------------------------

describe('analysisStore', () => {
  it('produce un CaseAnalysis persistido con raw, contadores y system idéntico', async () => {
    const repo: LegalCaseRepository = new MemoryLegalCaseRepository();
    const { executeCall, log } = makeRecordingExecuteCall({ delayMs: 5 });
    const store = createAnalysisStore({ cases: repo, executeCall });

    const result = await store.getState().runAnalysis(makeInput());

    expect(result).not.toBeNull();
    if (result === null) throw new Error('sin análisis');
    expect(result.caseId).toBe('case-1');
    expect(result.providerId).toBe('provider-test');
    expect(result.modelId).toBe('model-test');
    expect(result.incomplete).toBe(false);
    expect(result.synthesis).toBe(SYNTHESIS_RAW);
    expect(result.raw).toEqual(PERSONA_RAW);
    expect(result.attacks).toHaveLength(1);
    expect(result.defenses).toHaveLength(1);
    expect(result.risks).toHaveLength(1);
    expect(result.judgePosture).toHaveLength(1);
    // Defensa y juez citan el art. 2560 (verificadas); el ataque inventa el 9999.
    expect(result.citations).toEqual({ verified: 2, unverified: 1 });

    expect(store.getState().runStatus).toBe('idle');
    expect(store.getState().error).toBeNull();
    expect(store.getState().lastAnalysis?.id).toBe(result.id);
    expect(await repo.listAnalyses('case-1')).toHaveLength(1);

    // 4 personas + síntesis con system byte-idéntico y rol al final del user.
    const personaCalls = log.descriptors.filter((call) => !call.isSynthesis);
    expect(personaCalls).toHaveLength(4);
    expect(log.descriptors.filter((call) => call.isSynthesis)).toHaveLength(1);
    expect(new Set(log.descriptors.map((call) => call.system)).size).toBe(1);
    for (const descriptor of log.descriptors) expect(descriptor.system).toBe(SYSTEM);
    for (const persona of ADVERSARIAL_PERSONAS) {
      const call = personaCalls.find((entry) => entry.perspective === persona.id);
      expect(call?.user.endsWith(persona.role)).toBe(true);
      expect(call?.user).toContain(BRIEF);
    }
    // El paralelismo respeta `maxParallel` del presupuesto.
    expect(log.maxActive).toBeLessThanOrEqual(BUDGETS.maxParallel);

    // `list()` hidrata el análisis persistido en un store nuevo.
    const reloaded = createAnalysisStore({ cases: repo, executeCall });
    await reloaded.getState().list('case-1');
    expect(reloaded.getState().analyses.map((analysis) => analysis.id)).toEqual([result.id]);
  });

  it('degrada a N personas si una falla, con constancia en el análisis', async () => {
    const repo: LegalCaseRepository = new MemoryLegalCaseRepository();
    const { executeCall } = makeRecordingExecuteCall({ fail: { risk: 'modelo caído' } });
    const store = createAnalysisStore({ cases: repo, executeCall });

    const result = await store.getState().runAnalysis(makeInput());

    expect(result).not.toBeNull();
    if (result === null) throw new Error('sin análisis');
    expect(result.incomplete).toBe(true);
    expect(result.raw.risk).toBe('');
    expect(result.risks).toHaveLength(0);
    expect(result.defenses).toHaveLength(1);
    expect(result.attacks).toHaveLength(1);
    expect(result.synthesis).toContain('Análisis incompleto');
    expect(result.synthesis).toContain('risk');
    // Degradar no es fallar: persiste igual y no marca error.
    expect(await repo.listAnalyses('case-1')).toHaveLength(1);
    expect(store.getState().runStatus).toBe('idle');
    expect(store.getState().error).toBeNull();
  });

  it('stop() aborta el análisis en curso sin persistir', async () => {
    const repo: LegalCaseRepository = new MemoryLegalCaseRepository();
    const store = createAnalysisStore({ cases: repo, executeCall: makeHangingExecuteCall() });

    const running = store.getState().runAnalysis(makeInput());
    expect(store.getState().runStatus).toBe('running');
    store.getState().stop();
    const result = await running;

    expect(result).toBeNull();
    expect(store.getState().runStatus).toBe('idle');
    expect(await repo.listAnalyses('case-1')).toHaveLength(0);
    expect(store.getState().analyses).toHaveLength(0);
  });

  it('un segundo run concurrente se rechaza limpiamente sin afectar al primero', async () => {
    const repo: LegalCaseRepository = new MemoryLegalCaseRepository();
    const { gate, release } = makeGate();
    const store = createAnalysisStore({ cases: repo, executeCall: makeBlockingExecuteCall(gate) });

    const first = store.getState().runAnalysis(makeInput());
    const second = await store.getState().runAnalysis(makeInput());
    expect(second).toBeNull();

    release();
    const result = await first;
    expect(result).not.toBeNull();
    if (result === null) throw new Error('el primer run debió completarse');
    expect(result.incomplete).toBe(false);
    expect(await repo.listAnalyses('case-1')).toHaveLength(1);
    expect(store.getState().runStatus).toBe('idle');
  });

  it('QuotaExceededError al persistir deja error recuperable con el análisis en memoria', async () => {
    const repo: LegalCaseRepository = new QuotaCases();
    const { executeCall } = makeRecordingExecuteCall();
    const store = createAnalysisStore({ cases: repo, executeCall });

    const result = await store.getState().runAnalysis(makeInput());

    expect(result).not.toBeNull();
    if (result === null) throw new Error('sin análisis');
    expect(store.getState().runStatus).toBe('idle');
    expect(store.getState().error).toBe(ANALYSIS_QUOTA_ERROR);
    expect(store.getState().lastAnalysis?.id).toBe(result.id);
    expect(store.getState().analyses.map((analysis) => analysis.id)).toContain(result.id);
    expect(await repo.listAnalyses('case-1')).toHaveLength(0);
  });
});
