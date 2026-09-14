import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';

import {
  ADVERSARIAL_PERSPECTIVE_ORDER,
  planAdversarialCalls,
  parseAnalysisResponse,
  synthesizeAnalysis,
} from '@/domain/legal/adversarial';
import type { AdversarialCallDescriptor } from '@/domain/legal/adversarial';
import type { LegalCaseRepository } from '@/domain/ports/LegalCaseRepository';
import type {
  AdversarialPerspective,
  AnalysisItem,
  CaseAnalysis,
  JudgePostureItem,
  LegalAnalysisBudget,
  LegalIndex,
} from '@/domain/types/legal';
import { newId as defaultNewId } from '@/shared/utils/ids';

/** Ciclo de vida del análisis en curso (mismo vocabulario que `ChatRunStatus`). */
export type AnalysisRunStatus = 'idle' | 'running' | 'stopping';

/**
 * Ejecuta UNA llamada adversarial y devuelve el texto crudo del modelo.
 * La provee la capa de composición/UI (nunca el store): debe respetar `signal`
 * y rechazar con un error de nombre `AbortError` al abortarse.
 */
export type ExecuteAdversarialCall = (
  descriptor: AdversarialCallDescriptor,
  signal: AbortSignal,
) => Promise<string>;

export interface AnalysisStoreDeps {
  cases: LegalCaseRepository;
  executeCall: ExecuteAdversarialCall;
  newId?: () => string;
  now?: () => number;
}

export interface RunAnalysisInput {
  caseId: string;
  brief: string;
  systemPrompt: string;
  budgets: LegalAnalysisBudget;
  index: LegalIndex;
  providerId: string;
  modelId: string;
  packs?: { id: string; version: string }[];
  /** Personas a ejecutar; por defecto las 4 en orden canónico. */
  personas?: readonly AdversarialPerspective[];
}

export interface AnalysisState {
  analyses: CaseAnalysis[];
  activeCaseId: string | null;
  runStatus: AnalysisRunStatus;
  error: string | null;
  lastAnalysis: CaseAnalysis | null;
  list: (caseId: string) => Promise<void>;
  /**
   * Corre el análisis adversarial: planea, ejecuta las personas en lotes de
   * `maxParallel` y luego la síntesis. Un segundo run concurrente se rechaza
   * con `null` sin afectar al run en curso. El abort (`stop()`) resuelve `null`
   * sin persistir. Nunca lanza.
   */
  runAnalysis: (input: RunAnalysisInput) => Promise<CaseAnalysis | null>;
  /** Aborta todas las llamadas en curso; el run resuelve `null` y libera el turno. */
  stop: () => void;
  dismissError: () => void;
}

export type AnalysisStore = UseBoundStore<StoreApi<AnalysisState>>;

/** Marca de error recuperable: sin cuota para persistir, pero el análisis sigue en memoria. */
export const ANALYSIS_QUOTA_ERROR = 'quota-exceeded';

type ParsedItems = readonly (AnalysisItem | JudgePostureItem)[];

interface PersonaOutcome {
  raw: Partial<Record<AdversarialPerspective, string>>;
  failed: AdversarialPerspective[];
}

/**
 * Store del análisis adversarial con ejecución inyectada.
 * Sin red ni imports de adapters/providers: todo el IO con el modelo entra por `executeCall`.
 */
export function createAnalysisStore(deps: AnalysisStoreDeps): AnalysisStore {
  const repo = deps.cases;
  const executeCall = deps.executeCall;
  const generateId = deps.newId ?? ((): string => defaultNewId('analysis'));
  const clock = deps.now ?? ((): number => Date.now());

  // Token anti-carrera: un solo run a la vez; un reclamo obsoleto no escribe estado.
  let generation = 0;
  let controllers: AbortController[] = [];
  let wallClock: ReturnType<typeof setTimeout> | null = null;

  return create<AnalysisState>((set, get) => {
    const isCurrent = (token: number): boolean => token === generation;
    const isRunning = (token: number): boolean => token === generation && get().runStatus === 'running';

    function track(controller: AbortController): void {
      controllers.push(controller);
    }

    function abortAll(): void {
      const pending = controllers;
      controllers = [];
      for (const controller of pending) {
        try {
          controller.abort();
        } catch {
          // El abort nunca debe tumbar el store.
        }
      }
    }

    function clearWallClock(): void {
      if (wallClock !== null) {
        clearTimeout(wallClock);
        wallClock = null;
      }
    }

    /** Salida por abort: limpia timers/controladores y libera el turno sin persistir. */
    function abortRun(token: number): null {
      clearWallClock();
      controllers = [];
      if (isCurrent(token)) set({ runStatus: 'idle', error: null });
      return null;
    }

    /** Reclama el turno de forma síncrona: un segundo run concurrente recibe `null`. */
    function claimRun(): number | null {
      if (get().runStatus !== 'idle') return null;
      generation += 1;
      const token = generation;
      set({ runStatus: 'running', error: null });
      return token;
    }

    /**
     * Ejecuta las personas en lotes de `maxParallel`, cada una con su propio
     * `AbortController`. Devuelve `null` si el run se abortó; si una persona
     * falla sin abort, queda en `failed` y el análisis degrada a N personas.
     */
    async function runPersonaBatches(
      calls: readonly AdversarialCallDescriptor[],
      token: number,
      maxParallel: number,
    ): Promise<PersonaOutcome | null> {
      const raw: Partial<Record<AdversarialPerspective, string>> = {};
      const failed: AdversarialPerspective[] = [];
      const parallel = Number.isFinite(maxParallel) && maxParallel > 0 ? Math.floor(maxParallel) : 1;
      for (let start = 0; start < calls.length; start += parallel) {
        if (!isRunning(token)) return null;
        const batch = calls.slice(start, start + parallel);
        const pending = batch.map((descriptor) => {
          const controller = new AbortController();
          track(controller);
          return { descriptor, controller, promise: executeCall(descriptor, controller.signal) };
        });
        const settled = await Promise.allSettled(pending.map((entry) => entry.promise));
        for (let index = 0; index < settled.length; index += 1) {
          const entry = settled[index];
          const item = pending[index];
          if (entry === undefined || item === undefined) continue;
          if (!isRunning(token)) return null;
          if (entry.status === 'fulfilled') {
            if (isPerspective(item.descriptor.perspective)) raw[item.descriptor.perspective] = entry.value;
          } else {
            if (item.controller.signal.aborted || isAbortError(entry.reason)) return null;
            if (isPerspective(item.descriptor.perspective)) failed.push(item.descriptor.perspective);
          }
        }
      }
      return { raw, failed };
    }

    return {
      analyses: [],
      activeCaseId: null,
      runStatus: 'idle',
      error: null,
      lastAnalysis: null,

      async list(caseId) {
        set({ error: null });
        try {
          const items = await repo.listAnalyses(caseId);
          set({ analyses: [...items], activeCaseId: caseId });
        } catch (error) {
          set({ error: toErrorMessage(error) });
        }
      },

      async runAnalysis(input) {
        const token = claimRun();
        if (token === null) return null;
        set({ activeCaseId: input.caseId });
        const analysisId = generateId();
        const createdAt = clock();
        const personas = input.personas ?? [...ADVERSARIAL_PERSPECTIVE_ORDER];

        const wallMs = input.budgets.maxWallClockMs;
        if (Number.isFinite(wallMs) && wallMs > 0) {
          wallClock = setTimeout(() => {
            if (isCurrent(token)) {
              set({ runStatus: 'stopping' });
              abortAll();
            }
          }, Math.floor(wallMs));
        }

        try {
          const plan = planAdversarialCalls({
            personas,
            brief: input.brief,
            budgets: input.budgets,
            systemPrompt: input.systemPrompt,
            sessionId: input.caseId,
            model: input.modelId,
          });

          const outcome = await runPersonaBatches(
            plan.calls.filter((call) => !call.isSynthesis),
            token,
            plan.maxParallel,
          );
          if (outcome === null || !isRunning(token)) return abortRun(token);

          const items: Record<AdversarialPerspective, ParsedItems> = {
            defense: [],
            attack: [],
            judge: [],
            risk: [],
          };
          for (const persona of ADVERSARIAL_PERSPECTIVE_ORDER) {
            const text = outcome.raw[persona];
            if (typeof text !== 'string') continue;
            try {
              items[persona] = parseAnalysisResponse(persona, text, input.index);
            } catch {
              // El parser por contrato no lanza; si lo hiciera, esa persona degrada.
              items[persona] = [];
              if (!outcome.failed.includes(persona)) outcome.failed.push(persona);
            }
          }

          // La síntesis se re-planea con las salidas reales (el plan inicial no las tenía).
          const withOutputs = planAdversarialCalls({
            personas,
            brief: input.brief,
            budgets: input.budgets,
            systemPrompt: input.systemPrompt,
            sessionId: input.caseId,
            model: input.modelId,
            outputs: completeRawRecord(outcome.raw),
          });
          const synthesisCall = withOutputs.calls.find((call) => call.isSynthesis);
          let synthesis: string;
          let synthesisFailed = false;
          if (synthesisCall === undefined) {
            synthesisFailed = true;
            synthesis = withOutputs.degradation ?? 'Síntesis omitida por presupuesto.';
          } else {
            const controller = new AbortController();
            track(controller);
            try {
              synthesis = await executeCall(synthesisCall, controller.signal);
            } catch (cause) {
              if (controller.signal.aborted || !isRunning(token) || isAbortError(cause)) {
                return abortRun(token);
              }
              synthesisFailed = true;
              synthesis = 'Síntesis no disponible por un fallo de ejecución.';
            }
          }
          if (!isRunning(token)) return abortRun(token);

          const incomplete =
            plan.omittedPersonas.length > 0 || outcome.failed.length > 0 || synthesisFailed;
          if (incomplete) synthesis = appendDegradationNote(synthesis, plan, outcome.failed, synthesisFailed);

          const analysis = synthesizeAnalysis({
            id: analysisId,
            caseId: input.caseId,
            createdAt,
            providerId: input.providerId,
            modelId: input.modelId,
            packs: input.packs ?? [],
            raw: completeRawRecord(outcome.raw),
            items,
            synthesis,
            incomplete,
          });
          if (!isRunning(token)) return abortRun(token);

          try {
            await repo.appendAnalysis(analysis);
          } catch (cause) {
            // Persistencia best-effort: el análisis queda en memoria con error recuperable.
            if (!isCurrent(token)) return null;
            clearWallClock();
            controllers = [];
            const quota = isQuotaExceededError(cause);
            set((state) => ({
              analyses: [...state.analyses.filter((entry) => entry.id !== analysis.id), analysis],
              lastAnalysis: analysis,
              error: quota ? ANALYSIS_QUOTA_ERROR : toErrorMessage(cause),
              runStatus: 'idle',
            }));
            return analysis;
          }
          if (!isCurrent(token)) return null;
          clearWallClock();
          controllers = [];
          set((state) => ({
            analyses: [...state.analyses.filter((entry) => entry.id !== analysis.id), analysis],
            lastAnalysis: analysis,
            error: null,
            runStatus: 'idle',
          }));
          return analysis;
        } catch (cause) {
          if (!isCurrent(token)) return null;
          clearWallClock();
          controllers = [];
          set({ runStatus: 'idle', error: toErrorMessage(cause) });
          return null;
        }
      },

      stop() {
        if (get().runStatus === 'idle') return;
        if (controllers.length === 0) {
          // Reclamo en curso antes de abrir llamadas: invalida el token y libera el turno.
          generation += 1;
          clearWallClock();
          set({ runStatus: 'idle', error: null });
          return;
        }
        set({ runStatus: 'stopping' });
        abortAll();
      },

      dismissError: () => set({ error: null }),
    };
  });
}

/** Nota explícita de degradación: deja constancia en el `CaseAnalysis` de qué faltó. */
function appendDegradationNote(
  synthesis: string,
  plan: { omittedPersonas: { persona: AdversarialPerspective }[] },
  failed: readonly AdversarialPerspective[],
  synthesisFailed: boolean,
): string {
  const parts: string[] = [];
  if (plan.omittedPersonas.length > 0) {
    parts.push(`omitidas por presupuesto: ${plan.omittedPersonas.map((entry) => entry.persona).join(', ')}`);
  }
  if (failed.length > 0) parts.push(`fallaron en ejecución: ${failed.join(', ')}`);
  if (synthesisFailed) parts.push('síntesis no disponible');
  const detail = parts.length > 0 ? parts.join('; ') : 'degradado a menos de 4 personas';
  return `${synthesis}\n\n[Análisis incompleto: ${detail}.]`;
}

function completeRawRecord(
  raw: Partial<Record<AdversarialPerspective, string>>,
): Record<AdversarialPerspective, string> {
  return {
    defense: typeof raw.defense === 'string' ? raw.defense : '',
    attack: typeof raw.attack === 'string' ? raw.attack : '',
    judge: typeof raw.judge === 'string' ? raw.judge : '',
    risk: typeof raw.risk === 'string' ? raw.risk : '',
  };
}

function isPerspective(value: unknown): value is AdversarialPerspective {
  return (
    typeof value === 'string' &&
    (ADVERSARIAL_PERSPECTIVE_ORDER as readonly string[]).includes(value)
  );
}

function isAbortError(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  return (cause as { name?: unknown }).name === 'AbortError';
}

/** Detecta el fallo de cuota sin depender de `DOMException` (fakes lanzan `Error` con ese `name`). */
function isQuotaExceededError(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const record = cause as { name?: unknown; code?: unknown };
  return record.name === 'QuotaExceededError' || record.code === 'QuotaExceededError' || record.code === 22;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Contexto/hook de React del store de análisis (patrón del store de chat). */
export { AnalysisStoreProvider, useAnalysisStore, useAnalysisStoreApi } from './AnalysisStoreContext';
export type { AnalysisStoreProviderProps } from './AnalysisStoreContext';
