import { useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n/useT';
import { Check, Sparkles } from '@/shared/icons';
import { IconButton } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

export interface ModesMenuProps {
  /** Fuente T20: intención de investigación de la conversación. */
  researchMode: boolean;
  /** Fuente T20: vínculo legal (`null` = modo general). El menú lo deriva, no lo duplica. */
  legalCaseId: string | null;
  /** Título del expediente para el resumen (opcional: sin provider no hay título). */
  legalCaseTitle?: string | null;
  /** La investigación exige `webSearchEnabled` (misma fuente que el `Switch` del composer). */
  researchDisabled?: boolean;
  /** Workspace legal configurado (onboarding o Ajustes); si no, se ofrece configurarlo. */
  legalConfigured: boolean;
  onToggleResearch: (enabled: boolean) => void;
  /** Apagar desvincula (`setLegalCase(null)`); encender sin caso lo resuelve el menú con el diálogo. */
  onToggleLegal: (enabled: boolean) => void;
  onOpenCaseDialog: () => void;
  onConfigureLegal: () => void;
  /** Acceso "Abrir expediente" (sólo con caso vinculado). */
  onOpenCase?: () => void;
  className?: string;
}

/**
 * Menú de modos combinables de la cabecera (D17): segunda entrada, no segunda
 * fuente. Deriva `researchMode` y `legalCaseId != null` (ortogonales:
 * general, investigación, legal o ambos); prohibido un enum de "modo actual".
 */
export function ModesMenu({
  researchMode,
  legalCaseId,
  legalCaseTitle,
  researchDisabled = false,
  legalConfigured,
  onToggleResearch,
  onToggleLegal,
  onOpenCaseDialog,
  onConfigureLegal,
  onOpenCase,
  className,
}: ModesMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  // Derivación del estado combinado (D17): `legalOn` no es estado propio.
  const legalOn = legalCaseId != null;
  const active = researchMode || legalOn;

  // Cierre con click afuera y Escape; foco al primer ítem al abrir.
  useEffect(() => {
    if (!open) return undefined;
    firstItemRef.current?.focus();
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleLegalClick = (): void => {
    if (legalOn) {
      onToggleLegal(false);
      return;
    }
    // Encender sin caso abre el diálogo de vínculo en vez de inventar un caso.
    setOpen(false);
    onOpenCaseDialog();
  };

  const summary =
    legalOn && researchMode
      ? t('modes.summaryBoth', { title: legalCaseTitle ?? legalCaseId })
      : legalOn
        ? t('modes.summaryLegal', { title: legalCaseTitle ?? legalCaseId })
        : researchMode
          ? t('modes.summaryResearch')
          : t('modes.summaryGeneral');

  return (
    <div ref={rootRef} className={cn('relative shrink-0', className)}>
      <IconButton
        data-testid="modes-menu-button"
        label={t('modes.buttonLabel')}
        size="sm"
        icon={<Sparkles aria-hidden="true" className="size-4" />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(active && 'text-primary')}
      />
      {open ? (
        <div
          data-testid="modes-menu"
          role="menu"
          aria-label={t('modes.menuLabel')}
          className="anim-scale-in absolute right-0 top-full z-20 mt-2 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg [--anim-origin:top_right]"
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitemcheckbox"
            aria-checked={researchMode}
            disabled={researchDisabled}
            data-testid="modes-menu-research"
            onClick={() => onToggleResearch(!researchMode)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
          >
            <CheckMark checked={researchMode} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text">{t('modes.researchTitle')}</span>
              <span className="block truncate text-xs text-muted">{t('modes.researchHint')}</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={legalOn}
            data-testid="modes-menu-legal"
            onClick={handleLegalClick}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <CheckMark checked={legalOn} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text">{t('modes.legalTitle')}</span>
              <span className="block truncate text-xs text-muted">{t('modes.legalHint')}</span>
            </span>
          </button>
          <p data-testid="modes-menu-summary" role="status" className="px-3 py-2 text-xs text-muted">
            {summary}
          </p>
          {legalOn && onOpenCase !== undefined ? (
            <button
              type="button"
              role="menuitem"
              data-testid="modes-menu-open-case"
              onClick={() => {
                setOpen(false);
                onOpenCase();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('modes.openCase')}
            </button>
          ) : null}
          {legalConfigured ? null : (
            <button
              type="button"
              role="menuitem"
              data-testid="modes-menu-configure"
              onClick={() => {
                setOpen(false);
                onConfigureLegal();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('modes.configureLegal')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Marca visible del `aria-checked`: casilla con tilde o vacía (mismo tamaño). */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded border',
        checked ? 'border-primary bg-primary text-on-primary' : 'border-border text-transparent',
      )}
    >
      <Check className="size-3.5" />
    </span>
  );
}
