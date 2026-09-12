import { useState } from 'react';

import type { ToolResult } from '@/domain/types/chat';
import { SourcesList } from '@/features/research/SourcesList';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { ChevronDown, CircleAlert, CircleCheck, Globe, LoaderCircle } from '@/shared/icons';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

export interface ToolCallCardProps {
  name: string;
  result?: ToolResult;
}

type ToolState = 'running' | 'done' | 'error';

const STATE_ICONS = { running: LoaderCircle, done: CircleCheck, error: CircleAlert } as const;
const STATE_VARIANTS = { running: 'neutral', done: 'success', error: 'danger' } as const;

export function ToolCallCard({ name, result }: ToolCallCardProps) {
  const t = useT();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const state: ToolState = result === undefined ? 'running' : result.ok ? 'done' : 'error';
  const StateIcon = STATE_ICONS[state];
  const stateLabel =
    state === 'running' ? t('chat.toolRunning') : state === 'done' ? t('chat.toolDone') : t('chat.toolError');
  const duration = result === undefined ? null : formatDuration(result.durationMs, t);
  const sources = result?.sources ?? [];
  const hasSources = sources.length > 0;

  return (
    <div
      data-block="tool"
      aria-label={t('chat.toolLabel', { name })}
      title={result?.error?.message}
      className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <Globe aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono font-medium text-text">{name}</span>
        {duration !== null ? <span className="shrink-0 text-muted">{duration}</span> : null}
        <Badge variant={STATE_VARIANTS[state]} className="gap-1">
          <StateIcon aria-hidden="true" className={cn('size-3', state === 'running' && 'animate-spin')} />
          {stateLabel}
        </Badge>
        {hasSources ? (
          <button
            type="button"
            aria-expanded={sourcesOpen}
            aria-label={t('research.toggleSources')}
            onClick={() => setSourcesOpen((value) => !value)}
            className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3.5 transition-transform', sourcesOpen && 'rotate-180')}
            />
          </button>
        ) : null}
      </div>
      {hasSources && sourcesOpen ? (
        <SourcesList sources={sources} className="mt-2 border-t border-border-subtle pt-2" />
      ) : null}
    </div>
  );
}

function formatDuration(durationMs: number, t: Translate): string {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safe < 1000) return t('chat.toolDurationMs', { ms: Math.round(safe) });
  return t('chat.toolDurationSeconds', { seconds: (safe / 1000).toFixed(1) });
}
