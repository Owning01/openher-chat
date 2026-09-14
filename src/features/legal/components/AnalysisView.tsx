import type { ReactNode } from 'react';

import type {
  AnalysisCitation,
  AnalysisItem,
  CaseAnalysis,
  JudgePostureItem,
} from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { Badge, Button, Spinner } from '@/shared/ui';

export type AnalysisViewStatus = 'idle' | 'loading' | 'error';

export interface AnalysisViewProps {
  analysis: CaseAnalysis | null;
  status?: AnalysisViewStatus;
  error?: string | null;
  onRetry?: () => void;
}

/** Personas en orden canónico; deriva del `raw` persistido en el análisis. */
const PERSONAS: readonly (keyof CaseAnalysis['raw'])[] = ['defense', 'attack', 'judge', 'risk'];

/** Personas con salida cruda no vacía; base del aviso "N de 4 personas". */
function countPresentPersonas(analysis: CaseAnalysis): number {
  return PERSONAS.filter((persona) => analysis.raw[persona].trim().length > 0).length;
}

/** Vista de lectura del análisis adversarial: 4 personas separadas + preguntas + síntesis. */
export function AnalysisView({ analysis, status = 'idle', error = null, onRetry }: AnalysisViewProps) {
  const t = useT();

  if (status === 'loading') {
    return (
      <div data-testid="analysis-view" className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        <div data-testid="analysis-loading" className="flex items-center gap-2 py-2">
          <Spinner label={t('legalAnalysis.running')} />
          <p className="text-xs text-muted">{t('legalAnalysis.running')}</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div data-testid="analysis-view" className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        <p data-testid="analysis-error" role="alert" className="text-xs text-danger">
          {error ?? t('legalAnalysis.loadError')}
        </p>
        {onRetry === undefined ? null : (
          <div>
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              {t('legalAnalysis.retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (analysis === null) {
    return (
      <div data-testid="analysis-view" className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        <p data-testid="analysis-empty" className="text-sm font-medium text-text">
          {t('legalAnalysis.emptyTitle')}
        </p>
        <p className="text-xs text-muted">{t('legalAnalysis.emptyDescription')}</p>
      </div>
    );
  }

  return (
    <div data-testid="analysis-view" className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
      <p data-testid="analysis-counters" className="shrink-0 text-xs text-muted">
        {t('legalAnalysis.counters', {
          verified: analysis.citations.verified,
          unverified: analysis.citations.unverified,
        })}
      </p>
      {analysis.incomplete ? (
        <p data-testid="analysis-incomplete" className="shrink-0 text-xs font-medium text-warning">
          {t('legalAnalysis.incompleteWarning', { done: countPresentPersonas(analysis) })}
        </p>
      ) : null}

      <Section testId="analysis-section-defense" title={t('legalAnalysis.defenseTitle')}>
        <ItemList
          items={analysis.defenses}
          emptyText={t('legalAnalysis.noItems')}
          renderItem={(item) => <AnalysisItemView item={item} />}
        />
      </Section>

      <Section testId="analysis-section-attack" title={t('legalAnalysis.attackTitle')}>
        <p
          data-testid="analysis-attack-simulation"
          className="rounded-md border border-warning bg-warning-soft px-2 py-1 text-xs font-medium text-warning"
        >
          {t('legalAnalysis.attackSimulation')}
        </p>
        <p className="text-xs text-muted">{t('legalAnalysis.attackSimulationHint')}</p>
        <ItemList
          items={analysis.attacks}
          emptyText={t('legalAnalysis.noItems')}
          renderItem={(item) => <AnalysisItemView item={item} />}
        />
      </Section>

      <Section testId="analysis-section-judge" title={t('legalAnalysis.judgeTitle')}>
        {analysis.judgePosture.length === 0 ? (
          <p className="text-xs text-muted">{t('legalAnalysis.noItems')}</p>
        ) : (
          <ul className="space-y-2">
            {analysis.judgePosture.map((item) => (
              <li
                key={item.id}
                data-testid={`analysis-item-${item.id}`}
                className="min-w-0 rounded-md border border-border p-2"
              >
                <JudgePostureView item={item} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section testId="analysis-section-risk" title={t('legalAnalysis.riskTitle')}>
        <ItemList
          items={analysis.risks}
          emptyText={t('legalAnalysis.noItems')}
          renderItem={(item) => <AnalysisItemView item={item} />}
        />
      </Section>

      <Section testId="analysis-section-questions" title={t('legalAnalysis.questionsTitle')}>
        <ItemList
          items={analysis.openQuestions}
          emptyText={t('legalAnalysis.noItems')}
          renderItem={(item) => <AnalysisItemView item={item} />}
        />
      </Section>

      <Section testId="analysis-section-synthesis" title={t('legalAnalysis.synthesisTitle')}>
        {analysis.synthesis.trim().length === 0 ? (
          <p className="text-xs text-muted">{t('legalAnalysis.noSynthesis')}</p>
        ) : (
          <p className="min-w-0 text-sm break-words whitespace-pre-wrap text-text">
            {analysis.synthesis}
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="min-w-0 shrink-0 space-y-2">
      <h5 className="text-xs font-semibold text-muted uppercase">{title}</h5>
      {children}
    </section>
  );
}

function ItemList({
  items,
  emptyText,
  renderItem,
}: {
  items: readonly AnalysisItem[];
  emptyText: string;
  renderItem: (item: AnalysisItem) => ReactNode;
}) {
  if (items.length === 0) return <p className="text-xs text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          data-testid={`analysis-item-${item.id}`}
          className="min-w-0 rounded-md border border-border p-2"
        >
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

function AnalysisItemView({ item }: { item: AnalysisItem }) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm break-words text-text">{item.statement}</p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t('legalAnalysis.confidence', { value: Math.round(item.confidence * 100) })}</span>
        <span>{t('legalAnalysis.strength', { value: strengthLabel(t, item.strength) })}</span>
      </p>
      <BasisList basis={item.basis} />
    </div>
  );
}

function JudgePostureView({ item }: { item: JudgePostureItem }) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm break-words text-text">{item.thesis}</p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{t('legalAnalysis.confidence', { value: Math.round(item.confidence * 100) })}</span>
        <span>{t('legalAnalysis.leaning', { value: leaningLabel(t, item.leaning) })}</span>
      </p>
      <BasisList basis={item.basis} />
    </div>
  );
}

function BasisList({ basis }: { basis: readonly AnalysisCitation[] }) {
  const t = useT();
  if (basis.length === 0) return <p className="text-xs text-muted">{t('legalAnalysis.noBasis')}</p>;
  return (
    <ul className="space-y-1">
      {basis.map((citation, position) => (
        <li
          key={`${citation.raw}-${position}`}
          className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs"
        >
          <span className="min-w-0 break-words text-text">{citation.raw}</span>
          <Badge variant={citation.status === 'verified' ? 'success' : 'warning'}>
            {citation.status === 'verified'
              ? t('legalAnalysis.verifiedBadge')
              : t('legalAnalysis.unverifiedBadge')}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function strengthLabel(t: Translate, strength: AnalysisItem['strength']): string {
  if (strength === 'high') return t('legalAnalysis.strengthHigh');
  if (strength === 'low') return t('legalAnalysis.strengthLow');
  return t('legalAnalysis.strengthMedium');
}

function leaningLabel(t: Translate, leaning: JudgePostureItem['leaning']): string {
  if (leaning === 'favorable') return t('legalAnalysis.leaningFavorable');
  if (leaning === 'unfavorable') return t('legalAnalysis.leaningUnfavorable');
  return t('legalAnalysis.leaningUnclear');
}
