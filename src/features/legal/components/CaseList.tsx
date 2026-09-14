import { Scale } from 'lucide-react';

import type { LegalCase } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import { Button, EmptyState, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import type { CaseStoreStatus } from '../state/caseStore';

export interface CaseListProps {
  cases: readonly LegalCase[];
  selectedId: string | null;
  status: CaseStoreStatus;
  error: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

/** Lista de expedientes con estados de vacío, carga y error, y selección por botón. */
export function CaseList({ cases, selectedId, status, error, onSelect, onRetry }: CaseListProps) {
  const t = useT();

  if (status === 'loading' && cases.length === 0) {
    return (
      <div data-testid="case-list-loading" className="grid flex-1 place-items-center p-6">
        <Spinner label={t('legalCases.loading')} />
      </div>
    );
  }

  if (status === 'error' && cases.length === 0) {
    return (
      <div data-testid="case-list-error" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" className="text-sm text-danger">
          {error ?? t('legalCases.loadError')}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t('legalCases.retry')}
        </Button>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div data-testid="case-list-empty" className="flex flex-1 flex-col justify-center">
        <EmptyState
          icon={<Scale aria-hidden="true" className="size-6" />}
          title={t('legalCases.emptyTitle')}
          description={t('legalCases.emptyDescription')}
        />
      </div>
    );
  }

  return (
    <ul data-testid="case-list" aria-label={t('legalCases.listLabel')} className="flex flex-col gap-2 p-3">
      {cases.map((legalCase) => {
        const selected = legalCase.id === selectedId;
        return (
          <li key={legalCase.id}>
            <button
              type="button"
              data-testid={`case-item-${legalCase.id}`}
              aria-current={selected || undefined}
              onClick={() => onSelect(legalCase.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-surface hover:bg-surface-subtle',
              )}
            >
              <span className="truncate text-sm font-medium text-text">{legalCase.title}</span>
              <span className="truncate text-xs text-muted">
                {legalCase.court} ·{' '}
                {legalCase.status === 'archived' ? t('legalCases.statusArchived') : t('legalCases.statusActive')}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
