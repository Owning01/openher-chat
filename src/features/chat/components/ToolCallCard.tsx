import { useState } from 'react';

import type { ToolResult } from '@/domain/types/chat';
import { SourcesList } from '@/features/research/SourcesList';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import {
  BookOpen,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Code,
  Globe,
  LoaderCircle,
  Scale,
  Sparkles,
} from '@/shared/icons';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

export interface ToolCallCardProps {
  name: string;
  result?: ToolResult;
}

type ToolState = 'running' | 'done' | 'error';

const STATE_ICONS = { running: LoaderCircle, done: CircleCheck, error: CircleAlert } as const;
const STATE_VARIANTS = { running: 'neutral', done: 'success', error: 'danger' } as const;

function pickToolIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('search') || lower.includes('web') || lower.includes('url')) return Globe;
  if (lower.includes('legal') || lower.includes('cite') || lower.includes('article') || lower.includes('case'))
    return Scale;
  if (lower.includes('read') || lower.includes('skill') || lower.includes('doc')) return BookOpen;
  if (lower.includes('code') || lower.includes('run') || lower.includes('diff') || lower.includes('exec')) return Code;
  return Sparkles;
}

export function ToolCallCard({ name, result }: ToolCallCardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const state: ToolState = result === undefined ? 'running' : result.ok ? 'done' : 'error';
  const StateIcon = STATE_ICONS[state];
  const ToolIcon = pickToolIcon(name);
  const stateLabel =
    state === 'running' ? t('chat.toolRunning') : state === 'done' ? t('chat.toolDone') : t('chat.toolError');
  const duration = result === undefined ? null : formatDuration(result.durationMs, t);
  const sources = result?.sources ?? [];
  const hasSources = sources.length > 0;
  const hasContent = result?.content != null && result.content.trim() !== '';

  return (
    <div
      data-block="tool"
      aria-label={t('chat.toolLabel', { name })}
      title={result?.error?.message}
      className="my-1.5 w-full max-w-2xl rounded-xl border border-border/70 bg-surface/80 p-2 shadow-2xs transition-all hover:border-border hover:bg-surface"
      style={{ animation: 'fade-up 240ms cubic-bezier(0.23, 1, 0.32, 1) both' }}
    >
      {/* Fila principal estilo ToolChips */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-lg p-0.5"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            <ToolIcon aria-hidden="true" className="size-3.5 shrink-0" />
          </span>

          <span className="min-w-0 truncate font-mono text-xs font-semibold text-text">{name}</span>

          <span className="hidden sm:inline-flex min-w-0 max-w-48 truncate rounded-full border border-border/60 bg-surface-subtle/80 px-2 py-0.5 font-mono text-[11px] text-muted">
            {state === 'running' ? 'ejecutando…' : hasSources ? `${sources.length} fuentes` : 'ejecutado'}
          </span>
        </button>

        {duration !== null ? (
          <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{duration}</span>
        ) : null}

        <Badge variant={STATE_VARIANTS[state]} className="gap-1 text-[11px] shrink-0">
          <StateIcon aria-hidden="true" className={cn('size-3', state === 'running' && 'animate-spin')} />
          <span>{stateLabel}</span>
        </Badge>

        <button
          type="button"
          aria-expanded={open}
          aria-label={hasSources ? t('research.toggleSources') : 'Detalles de herramienta'}
          onClick={() => setOpen((prev) => !prev)}
          className="shrink-0 rounded-lg p-1 text-muted transition-colors hover:bg-surface-subtle hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </div>

      {/* Traza de detalle expandible */}
      {open ? (
        <div className="relative mt-2 ml-2.5 border-l border-border-subtle py-1 pl-3.5 space-y-2">
          {result?.error?.message ? (
            <p role="alert" className="text-xs text-danger font-mono leading-relaxed">
              {result.error.message}
            </p>
          ) : null}

          {hasContent ? (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-subtle/70 p-2 font-mono text-[11px] leading-relaxed text-muted">
              {result.content}
            </pre>
          ) : null}

          {hasSources ? (
            <SourcesList sources={sources} className="border-t border-border-subtle/80 pt-2" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatDuration(durationMs: number, t: Translate): string {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safe < 1000) return t('chat.toolDurationMs', { ms: Math.round(safe) });
  return t('chat.toolDurationSeconds', { seconds: (safe / 1000).toFixed(1) });
}

