import { useMemo } from 'react';
import type { ChatMessage } from '@/domain/types/chat';
import { computeContextBreakdown } from '@/domain/chat/estimateTokens';
import { AUTOCOMPACT_THRESHOLD_TOKENS } from '@/domain/agent/compaction';
import { Brain, Check, Info, MessageSquare, ShieldCheck, Sparkles } from '@/shared/icons';
import { Button, Dialog } from '@/shared/ui';

export interface ContextDialogProps {
  open: boolean;
  onClose: () => void;
  messages: readonly ChatMessage[];
  summary?: string;
  systemTokens?: number;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const k = count / 1_000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`;
  }
  return count.toLocaleString();
}

export function ContextDialog({ open, onClose, messages, summary, systemTokens = 150 }: ContextDialogProps) {
  const breakdown = useMemo(
    () =>
      computeContextBreakdown({
        messages,
        summary,
        systemTokens,
        autocompactThreshold: AUTOCOMPACT_THRESHOLD_TOKENS,
      }),
    [messages, summary, systemTokens],
  );

  const isNearLimit = breakdown.percentage >= 80;
  const isOverLimit = breakdown.totalTokens >= breakdown.autocompactThreshold;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Estado del Contexto"
      className="max-w-lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
            <span>Contexto 100% aislado por sesión</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {/* Medidor principal hacia el umbral de 250k */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-text flex items-center gap-1.5">
              <Brain aria-hidden="true" className="size-4 text-accent" />
              Consumo de Contexto
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isOverLimit
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                  : isNearLimit
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {formatTokens(breakdown.totalTokens)} / {formatTokens(breakdown.autocompactThreshold)} tokens ({breakdown.percentage}%)
            </span>
          </div>

          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-field">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isOverLimit
                  ? 'bg-red-500'
                  : isNearLimit
                    ? 'bg-amber-500'
                    : 'bg-accent'
              }`}
              style={{ width: `${Math.max(2, breakdown.percentage)}%` }}
            />
          </div>

          <p className="mt-2 text-xs text-muted">
            Al alcanzar <strong className="text-text">250.000 tokens</strong>, se activa automáticamente el{' '}
            <strong className="text-text">autoresumen (autocompact)</strong> para compactar turnos antiguos sin perder
            la memoria relevante del trabajo.
          </p>
        </div>

        {/* Desglose por componentes */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Desglose de memoria activa
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border/80 bg-surface/70 p-2.5">
              <div className="flex items-center justify-between text-muted">
                <span className="flex items-center gap-1">
                  <MessageSquare className="size-3.5" /> Usuario
                </span>
                <span className="font-medium text-text">{breakdown.userCount} msgs</span>
              </div>
              <div className="mt-1 text-base font-semibold text-text">
                {formatTokens(breakdown.userTokens)}
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/70 p-2.5">
              <div className="flex items-center justify-between text-muted">
                <span className="flex items-center gap-1">
                  <Sparkles className="size-3.5 text-accent" /> Asistente
                </span>
                <span className="font-medium text-text">{breakdown.assistantCount} msgs</span>
              </div>
              <div className="mt-1 text-base font-semibold text-text">
                {formatTokens(breakdown.assistantTokens)}
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/70 p-2.5">
              <div className="flex items-center justify-between text-muted">
                <span>Herramientas / Web</span>
              </div>
              <div className="mt-1 text-base font-semibold text-text">
                {formatTokens(breakdown.toolTokens)}
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/70 p-2.5">
              <div className="flex items-center justify-between text-muted">
                <span>Sistema y Directivas</span>
              </div>
              <div className="mt-1 text-base font-semibold text-text">
                {formatTokens(breakdown.systemTokens)}
              </div>
            </div>
          </div>

          {breakdown.summaryTokens > 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-accent">
                <Check className="size-3.5" /> Autoresumen activo en memoria
              </span>
              <span className="font-semibold text-text">{formatTokens(breakdown.summaryTokens)} tokens</span>
            </div>
          ) : null}
        </div>

        {/* Aislamiento y Eliminación de Mensajes */}
        <div className="rounded-xl border border-border/80 bg-field/60 p-3 text-xs text-muted space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-text">
            <Info aria-hidden="true" className="size-3.5 text-accent" />
            Garantías de aislamiento estricto
          </div>
          <p>
            • Cada chat opera en un hilo aislado. Cambiar de chat o crear uno nuevo restablece el contexto de trabajo.
          </p>
          <p>
            • Si eliminas un mensaje, este y sus respuestas son retirados de inmediato del contexto del modelo y de la memoria persistente.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
