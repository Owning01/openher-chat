import type {
  AnalysisRunStatus,
  ExecuteAdversarialCall,
  RunAnalysisInput,
} from '../state/analysisStore';
import type { CaseAnalysis, LegalAnalysisBudget, LegalIndex } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { Button } from '@/shared/ui';

import { AnalysisView } from './AnalysisView';
import type { AnalysisViewStatus } from './AnalysisView';

export interface AdversarialPanelProps {
  caseId: string;
  brief: string;
  systemPrompt: string;
  budgets: LegalAnalysisBudget;
  index: LegalIndex;
  /**
   * Cableado de composición: el store del padre ya se creó con este
   * `executeCall`; el panel sólo verifica que exista antes de pedir el run.
   * La ejecución real con el modelo vive en el store, nunca en el panel.
   */
  executeCall: ExecuteAdversarialCall;
  providerId: string;
  modelId: string;
  runStatus?: AnalysisRunStatus;
  runError?: string | null;
  lastAnalysis?: CaseAnalysis | null;
  onRunAnalysis?: (input: RunAnalysisInput) => Promise<CaseAnalysis | null>;
  onStop?: () => void;
  onDismissError?: () => void;
}

/**
 * Orquesta el análisis adversarial vía el store inyectado por el padre.
 * No importa providers ni ejecuta el modelo: sólo arma el `RunAnalysisInput`
 * con las props de composición y delega en `onRunAnalysis` / `onStop`.
 */
export function AdversarialPanel(props: AdversarialPanelProps) {
  const t = useT();
  const runStatus: AnalysisRunStatus = props.runStatus ?? 'idle';
  const runError: string | null = props.runError ?? null;
  const lastAnalysis: CaseAnalysis | null = props.lastAnalysis ?? null;
  const running = runStatus === 'running' || runStatus === 'stopping';
  const canAnalyze =
    !running && props.onRunAnalysis !== undefined && props.brief.trim().length > 0;

  const handleAnalyze = (): void => {
    if (props.onRunAnalysis === undefined) return;
    // Guarda de cableado: sin ejecutor inyectado el store no puede correr.
    if (typeof props.executeCall !== 'function') return;
    void props.onRunAnalysis({
      caseId: props.caseId,
      brief: props.brief,
      systemPrompt: props.systemPrompt,
      budgets: props.budgets,
      index: props.index,
      providerId: props.providerId,
      modelId: props.modelId,
    });
  };

  const viewStatus: AnalysisViewStatus =
    runError !== null ? 'error' : running && lastAnalysis === null ? 'loading' : 'idle';

  return (
    <div data-testid="adversarial-panel" className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="adversarial-analyze"
          loading={runStatus === 'running'}
          disabled={!canAnalyze}
          onClick={handleAnalyze}
        >
          {runStatus === 'running' ? t('legalAnalysis.running') : t('legalAnalysis.analyze')}
        </Button>
        {running ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="adversarial-stop"
            onClick={() => props.onStop?.()}
          >
            {runStatus === 'stopping' ? t('legalAnalysis.stopping') : t('legalAnalysis.stop')}
          </Button>
        ) : null}
      </div>

      {runError !== null ? (
        <div data-testid="adversarial-error" role="alert" className="shrink-0 space-y-1">
          <p className="text-xs text-danger">{runError}</p>
          {props.onDismissError === undefined ? null : (
            <Button type="button" size="sm" variant="ghost" onClick={props.onDismissError}>
              {t('legalAnalysis.dismiss')}
            </Button>
          )}
        </div>
      ) : null}

      <AnalysisView
        analysis={lastAnalysis}
        status={viewStatus}
        error={runError}
        onRetry={props.onRunAnalysis === undefined ? undefined : handleAnalyze}
      />
    </div>
  );
}
