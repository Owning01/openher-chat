import { useCallback, useState } from 'react';

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

export interface ToolCallItem {
  id?: string;
  name: string;
  result?: ToolResult;
  argumentsText?: string;
}

export interface ToolCallCardProps {
  name?: string;
  result?: ToolResult;
  argumentsText?: string;
  items?: ToolCallItem[];
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

function extractChipText(argumentsText?: string, result?: ToolResult): string {
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

function formatDuration(durationMs: number, t: Translate): string {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safe < 1000) return t('chat.toolDurationMs', { ms: Math.round(safe) });
  return t('chat.toolDurationSeconds', { seconds: (safe / 1000).toFixed(1) });
}

interface ToolRowProps {
  item: ToolCallItem;
  isOpen: boolean;
  onToggle: () => void;
}

function ToolCallRow({ item, isOpen, onToggle }: ToolRowProps) {
  const t = useT();
  const { name, result, argumentsText } = item;
  const state: ToolState = result === undefined ? 'running' : result.ok ? 'done' : 'error';
  const StateIcon = STATE_ICONS[state];
  const ToolIcon = pickToolIcon(name);
  const stateLabel =
    state === 'running' ? t('chat.toolRunning') : state === 'done' ? t('chat.toolDone') : t('chat.toolError');
  const duration = result === undefined ? null : formatDuration(result.durationMs, t);
  const sources = result?.sources ?? [];
  const hasSources = sources.length > 0;
  const chipText = extractChipText(argumentsText, result);
  const hasContent = result?.content != null && result.content.trim() !== '';

  return (
    <div className="w-full">
      <div className="group/row -mx-1 flex h-7 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-surface-subtle/80">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left rounded py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <span className="relative flex size-4 shrink-0 items-center justify-center text-muted group-hover/row:text-primary transition-colors">
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
          aria-expanded={isOpen}
          aria-label={hasSources ? t('research.toggleSources') : 'Detalles de herramienta'}
          onClick={onToggle}
          className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-200', isOpen && 'rotate-180')}
          />
        </button>
      </div>

      {isOpen ? (
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

export function ToolCallCard({ name = 'tool', result, argumentsText, items }: ToolCallCardProps) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [openRowIndices, setOpenRowIndices] = useState<Set<number>>(() => new Set());

  const toolList: ToolCallItem[] = items && items.length > 0 ? items : [{ name, result, argumentsText }];

  const isAllWebSearch = toolList.every(
    (item) => item.name.toLowerCase().includes('search') || item.name.toLowerCase().includes('web'),
  );
  const isRunning = toolList.some((item) => item.result === undefined);

  let headerLabel = '';
  if (isRunning) {
    headerLabel = t('chat.toolsHeaderRunning');
  } else if (toolList.length === 1) {
    headerLabel = isAllWebSearch ? t('chat.toolsHeaderWebSearchSingle') : t('chat.toolsHeaderSingle');
  } else if (isAllWebSearch) {
    headerLabel = t('chat.toolsHeaderWebSearch', { count: toolList.length });
  } else {
    headerLabel = t('chat.toolsHeader', { count: toolList.length });
  }

  const toggleRow = useCallback((index: number) => {
    setOpenRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  return (
    <div
      data-block="tool"
      aria-label={toolList.length === 1 && toolList[0] ? t('chat.toolLabel', { name: toolList[0].name }) : headerLabel}
      title={toolList.length === 1 ? toolList[0]?.result?.error?.message : undefined}
      className="my-1.5 w-full max-w-2xl"
    >
      {/* Encabezado colapsable unificado estilo Beautiful UI ToolChips */}
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('chat.toggleTools')}
        onClick={() => setOpen((prev) => !prev)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-text select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')}
        />
        <span className="tabular-nums">{headerLabel}</span>
      </button>

      {/* Lista de filas de herramientas acopladas */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-1 flex flex-col gap-1 pb-1">
            {toolList.map((item, index) => (
              <ToolCallRow
                key={item.id ?? `${item.name}-${index}`}
                item={item}
                isOpen={openRowIndices.has(index)}
                onToggle={() => toggleRow(index)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
