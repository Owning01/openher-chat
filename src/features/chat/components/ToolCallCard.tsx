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
  argumentsText?: string;
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

function extractChipText(name: string, argumentsText?: string, result?: ToolResult): string {
  if (argumentsText) {
    try {
      const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
      if (typeof parsed.query === 'string' && parsed.query.trim() !== '') return parsed.query;
      if (typeof parsed.url === 'string' && parsed.url.trim() !== '') return parsed.url;
      if (typeof parsed.file === 'string' && parsed.file.trim() !== '') return parsed.file;
      if (typeof parsed.path === 'string' && parsed.path.trim() !== '') return parsed.path;
      if (typeof parsed.skill === 'string' && parsed.skill.trim() !== '') return parsed.skill;
      if (typeof parsed.name === 'string' && parsed.name.trim() !== '') return parsed.name;
    } catch {
      // Ignorar fallback
    }
  }
  if (result?.sources && result.sources.length > 0) {
    return `${result.sources.length} ${result.sources.length === 1 ? 'fuente' : 'fuentes'}`;
  }
  return result === undefined ? 'ejecutando…' : result.ok ? 'ejecutado' : 'error';
}

export function ToolCallCard({ name, result, argumentsText }: ToolCallCardProps) {
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
  const chipText = extractChipText(name, argumentsText, result);
  const hasContent = result?.content != null && result.content.trim() !== '';

  return (
    <div
      data-block="tool"
      aria-label={t('chat.toolLabel', { name })}
      title={result?.error?.message}
      className="my-1 w-full max-w-2xl"
    >
      {/* Fila compacta estilo Beautiful UI ToolChips */}
      <div className="group -mx-1.5 flex h-7 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-surface-subtle/80">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded py-0.5"
        >
          <span className="relative flex size-4 shrink-0 items-center justify-center text-muted group-hover:text-primary transition-colors">
            <ToolIcon aria-hidden="true" className="size-3.5" />
          </span>

          <span className="shrink-0 font-medium text-[12.5px] text-text">{name}</span>

          <span
            title={chipText}
            className="inline-flex h-5 min-w-0 max-w-44 sm:max-w-72 items-center truncate rounded-md border border-border/50 bg-surface-subtle px-1.5 font-mono text-[11px] text-muted transition-colors hover:border-primary/40 hover:text-text"
          >
            {chipText}
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
          className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </div>

      {/* Traza de detalle expandible con línea vertical estilo ToolChips */}
      {open ? (
        <div className="relative mt-1 mb-1.5 ml-2 border-l border-border-subtle py-1 pl-3.5 space-y-1.5 animate-in fade-in-50 duration-150">
          {result?.error?.message ? (
            <p role="alert" className="text-xs text-danger font-mono leading-relaxed">
              {result.error.message}
            </p>
          ) : null}

          {hasContent ? (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-subtle/80 p-2 font-mono text-[11px] leading-relaxed text-muted/90">
              {result.content}
            </pre>
          ) : null}

          {hasSources ? (
            <SourcesList sources={sources} className="border-t border-border-subtle/80 pt-1.5" />
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

