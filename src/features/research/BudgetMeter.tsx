import { useT } from '@/i18n/useT';
import type { Translate } from '@/i18n/useT';
import { cn } from '@/shared/utils/cn';

import type { BudgetUsage } from './selectors';

export interface BudgetMeterProps {
  usage: BudgetUsage;
  className?: string;
}

/** Medidor de consumo del run (pasos, tools, tokens y tiempo) contra `settings.agent`. */
export function BudgetMeter({ usage, className }: BudgetMeterProps) {
  const t = useT();
  const safe = sanitizeUsage(usage);

  return (
    <section data-testid="research-budget" className={cn('space-y-1.5', className)}>
      <h3 className="text-xs font-medium text-muted">{t('research.budgetTitle')}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Meter
          label={t('research.budgetSteps')}
          value={t('research.budgetValue', { used: safe.steps, max: safe.maxSteps })}
          used={safe.steps}
          max={safe.maxSteps}
        />
        <Meter
          label={t('research.budgetToolCalls')}
          value={t('research.budgetValue', { used: safe.toolCalls, max: safe.maxToolCalls })}
          used={safe.toolCalls}
          max={safe.maxToolCalls}
        />
        <Meter
          label={t('research.budgetTokens')}
          value={t('research.budgetValue', { used: safe.tokens, max: safe.maxTotalTokens })}
          used={safe.tokens}
          max={safe.maxTotalTokens}
        />
        <Meter
          label={t('research.budgetWallClock')}
          value={t('research.budgetValue', {
            used: formatClock(t, safe.wallClockMs),
            max: formatClock(t, safe.maxWallClockMs),
          })}
          used={safe.wallClockMs}
          max={safe.maxWallClockMs}
        />
      </div>
    </section>
  );
}

/** Copia con todo campo finito y no negativo: `NaN`/`Infinity` caen a 0. */
function sanitizeUsage(usage: BudgetUsage): BudgetUsage {
  return {
    steps: sanitizeNumber(usage.steps),
    maxSteps: sanitizeNumber(usage.maxSteps),
    toolCalls: sanitizeNumber(usage.toolCalls),
    maxToolCalls: sanitizeNumber(usage.maxToolCalls),
    tokens: sanitizeNumber(usage.tokens),
    maxTotalTokens: sanitizeNumber(usage.maxTotalTokens),
    wallClockMs: sanitizeNumber(usage.wallClockMs),
    maxWallClockMs: sanitizeNumber(usage.maxWallClockMs),
  };
}

function sanitizeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

interface MeterProps {
  label: string;
  value: string;
  used: number;
  max: number;
}

function Meter({ label, value, used, max }: MeterProps) {
  const safeMax = sanitizeNumber(max);
  const safeUsed = Math.min(sanitizeNumber(used), safeMax);
  const ratio = safeMax > 0 ? safeUsed / safeMax : 0;
  const exhausted = ratio >= 1;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted">{label}</span>
        <span className="shrink-0 font-mono text-text">{value}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeUsed}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn('h-full rounded-full transition-[width]', exhausted ? 'bg-danger' : 'bg-primary')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function formatClock(t: Translate, durationMs: number): string {
  const safe = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (safe < 1000) return t('research.durationMs', { ms: Math.round(safe) });
  return t('research.durationSeconds', { seconds: (safe / 1000).toFixed(1) });
}
