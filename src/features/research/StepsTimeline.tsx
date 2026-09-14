import { useState } from 'react';

import type { AgentStep } from '@/domain/types/agent';
import type { ToolCall, ToolResult } from '@/domain/types/chat';
import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { ChevronDown, CircleAlert, CircleCheck, Globe, LoaderCircle, Search } from '@/shared/icons';
import type { LucideIcon } from '@/shared/icons';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import { summarizeToolCall } from './selectors';

export interface StepsTimelineProps {
  steps: AgentStep[];
  defaultOpen?: boolean;
  /** Clases del cuerpo colapsable: permite fijar su altura y darle scroll propio. */
  bodyClassName?: string;
  /** Clases de la sección raíz (permite repartir el espacio del panel). */
  className?: string;
  /** Notifica cada cambio de plegado para que el contenedor reajuste el layout. */
  onToggle?: (open: boolean) => void;
}

type StepState = AgentStep['status'];

const STATE_ICONS: Record<StepState, LucideIcon> = {
  running: LoaderCircle,
  complete: CircleCheck,
  error: CircleAlert,
};

const STATE_ICON_CLASSES: Record<StepState, string> = {
  running: 'text-muted animate-spin',
  complete: 'text-success',
  error: 'text-danger',
};

/** Timeline en vivo del loop de investigación: pasos, tools, estado y duración. */
export function StepsTimeline({
  steps,
  defaultOpen = true,
  bodyClassName,
  className,
  onToggle,
}: StepsTimelineProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };

  return (
    <section
      data-testid="research-steps"
      className={cn('rounded-lg border border-border-subtle bg-surface-subtle/40', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Search aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex-1">{t('research.stepsTitle')}</span>
        <Badge variant="neutral">{steps.length}</Badge>
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className={cn('border-t border-border-subtle px-3 py-2', bodyClassName)}>
          {steps.length === 0 ? (
            <p className="text-xs text-muted">{t('research.noSteps')}</p>
          ) : (
            <ol className="space-y-2">
              {steps.map((step) => (
                <StepRow key={step.index} step={step} />
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const t = useT();
  const StateIcon = STATE_ICONS[step.status];
  const statusLabel =
    step.status === 'running'
      ? t('research.stepStatusRunning')
      : step.status === 'complete'
        ? t('research.stepStatusComplete')
        : t('research.stepStatusError');
  const duration = step.endedAt === undefined ? null : formatDuration(t, step.endedAt - step.startedAt);

  return (
    <li data-testid="research-step" data-status={step.status} className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <StateIcon aria-hidden="true" className={cn('size-3.5 shrink-0', STATE_ICON_CLASSES[step.status])} />
        <span className="font-medium text-text">{t('research.stepLabel', { index: step.index + 1 })}</span>
        <span className="text-muted">{statusLabel}</span>
        {duration !== null ? <span className="ml-auto shrink-0 font-mono text-muted">{duration}</span> : null}
      </div>
      {step.toolCalls.length > 0 ? (
        <ul className="space-y-1 pl-5">
          {step.toolCalls.map((call, index) => (
            <ToolRow key={`${call.id}:${index}`} call={call} result={step.toolResults[index]} />
          ))}
        </ul>
      ) : null}
      {step.text.trim() !== '' ? <p className="line-clamp-2 pl-5 text-xs text-muted">{step.text}</p> : null}
    </li>
  );
}

function ToolRow({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const t = useT();

  return (
    <li className="flex items-center gap-2 text-xs">
      <Globe aria-hidden="true" className="size-3 shrink-0 text-muted" />
      <span className="shrink-0 font-mono font-medium text-text">{call.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted" title={summarizeToolCall(call)}>
        {summarizeToolCall(call)}
      </span>
      {result === undefined ? (
        <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin text-muted" />
      ) : result.ok ? (
        <span className="shrink-0 font-mono text-muted">{formatDuration(t, result.durationMs)}</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1" title={result.error?.message ?? result.content}>
          <CircleAlert aria-hidden="true" className="size-3 shrink-0 text-danger" />
          <span className="font-mono text-muted">{formatDuration(t, result.durationMs)}</span>
        </span>
      )}
    </li>
  );
}

function formatDuration(t: Translate, durationMs: number): string {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safe < 1000) return t('research.durationMs', { ms: Math.round(safe) });
  return t('research.durationSeconds', { seconds: (safe / 1000).toFixed(1) });
}
