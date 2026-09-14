import { useMemo, useState } from 'react';

import { SETTINGS_HREF } from '@/app/routing';
import type { AgentStep } from '@/domain/types/agent';
import type { ChatMessage } from '@/domain/types/chat';
import type { AppSettings } from '@/domain/types/settings';
import { useT } from '@/i18n/useT';
import { PanelRightClose, Search, TriangleAlert } from '@/shared/icons';
import { IconButton } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import { BudgetMeter } from './BudgetMeter';
import { SourcesList } from './SourcesList';
import { StepsTimeline } from './StepsTimeline';
import { researchWarningText } from './messages';
import type { SearchKeyPresence } from './selectors';
import { budgetUsage, researchWarning, sourcesFromMessages } from './selectors';

export interface ResearchPanelProps {
  steps: AgentStep[];
  messages: ChatMessage[];
  settings: AppSettings | null;
  keyPresence: SearchKeyPresence;
  browser: boolean;
  /** Oculta el panel sin apagar el modo investigación. */
  onHide?: () => void;
  className?: string;
}

/** Panel del modo investigación: timeline en vivo, fuentes del turno y consumo del presupuesto. */
export function ResearchPanel({ steps, messages, settings, keyPresence, browser, onHide, className }: ResearchPanelProps) {
  const t = useT();
  const [stepsOpen, setStepsOpen] = useState(true);
  const sources = useMemo(() => sourcesFromMessages(messages), [messages]);
  const usage = settings === null ? null : budgetUsage(steps, settings.agent);
  const warning =
    settings === null ? null : researchWarning({ search: settings.search, proxy: settings.proxy, keys: keyPresence, browser });

  return (
    <aside
      data-testid="research-panel"
      aria-label={t('research.panelTitle')}
      className={cn('flex min-h-0 flex-col gap-2 overflow-y-auto bg-surface-subtle/30 p-3', className)}
    >
      <header className="flex shrink-0 items-center gap-2">
        <Search aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-text">{t('research.panelTitle')}</h2>
        {onHide === undefined ? null : (
          <IconButton
            data-testid="research-panel-hide"
            label={t('research.hidePanel')}
            size="sm"
            icon={<PanelRightClose aria-hidden="true" className="size-4" />}
            onClick={onHide}
            className="-mr-1 shrink-0"
          />
        )}
      </header>

      {warning !== null ? (
        <div role="status" className="flex shrink-0 items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-[11px]">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-warning" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="line-clamp-2 break-words text-text">{researchWarningText(t, warning)}</p>
            <a
              href={SETTINGS_HREF}
              className="inline-flex font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('research.openSettings')}
            </a>
          </div>
        </div>
      ) : null}

      <StepsTimeline
        steps={steps}
        onToggle={setStepsOpen}
        className={cn('flex min-h-0 flex-col', stepsOpen ? 'flex-1' : 'shrink-0')}
        bodyClassName="min-h-12 flex-1 overflow-y-auto"
      />
      <SourcesList
        sources={sources}
        title={t('research.sourcesTitle')}
        className="flex min-h-0 flex-1 flex-col"
        listClassName="min-h-10 flex-1 overflow-y-auto"
      />
      {usage !== null ? <BudgetMeter usage={usage} className="shrink-0" /> : null}
    </aside>
  );
}
