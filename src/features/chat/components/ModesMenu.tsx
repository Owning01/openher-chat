import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/useT';
import { Check, ChevronDown, Globe, Scale } from '@/shared/icons';
import { Switch } from '@/shared/ui';
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
  /** Encender el modo: activa directo (auto-crea/vincula expediente o degrada a diálogo). */
  onActivateLegal: () => void;
  onConfigureLegal: () => void;
  /** Acceso "Abrir expediente" (sólo con caso vinculado). */
  onOpenCase?: () => void;
  className?: string;
}

export function ModesMenu({
  researchMode,
  legalCaseId,
  legalCaseTitle,
  researchDisabled = false,
  legalConfigured,
  onToggleResearch,
  onToggleLegal,
  onActivateLegal,
  onConfigureLegal,
  onOpenCase,
  className,
}: ModesMenuProps) {
  const t = useT();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const legalOn = legalCaseId != null;

  useEffect(() => {
    if (!popoverOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [popoverOpen]);

  const summary =
    legalOn && researchMode
      ? t('modes.summaryBoth', { title: legalCaseTitle ?? legalCaseId })
      : legalOn
        ? t('modes.summaryLegal', { title: legalCaseTitle ?? legalCaseId })
        : researchMode
          ? t('modes.summaryResearch')
          : t('modes.summaryGeneral');

  return (
    <div
      ref={containerRef}
      data-testid="modes-menu"
      role="group"
      aria-label={t('modes.buttonLabel')}
      className={cn('relative inline-flex items-center', className)}
    >
      {/* Botón principal de Modos en la cabecera */}
      <button
        type="button"
        aria-expanded={popoverOpen}
        aria-haspopup="true"
        onClick={() => setPopoverOpen((prev) => !prev)}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all shadow-2xs backdrop-blur-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-95',
          legalOn
            ? 'border-primary/50 bg-primary-soft text-primary font-semibold'
            : 'border-border/80 bg-surface/80 text-text hover:bg-surface hover:border-border',
        )}
      >
        <Scale aria-hidden="true" className={cn('size-3.5 shrink-0', legalOn ? 'text-primary' : 'text-muted')} />
        <span>{legalOn ? t('modes.legalShort') : 'Modos'}</span>
        <ChevronDown aria-hidden="true" className={cn('size-3 text-muted transition-transform duration-150', popoverOpen && 'rotate-180')} />
      </button>

      {/* Popover flotante de selección de Modos */}
      {popoverOpen ? (
        <div
          role="dialog"
          aria-label="Menú de modos"
          className="absolute top-full right-0 z-30 mt-2 w-72 rounded-2xl border border-border bg-surface p-3 shadow-raised"
          style={{ animation: 'pop-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both' }}
        >
          <div className="mb-2.5 flex items-center justify-between border-b border-border/60 pb-2">
            <span className="text-xs font-semibold text-text">Modos de conversación</span>
            {legalOn ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                Abogado activo
              </span>
            ) : null}
          </div>

          <div className="space-y-2.5">
            {/* Modo Abogado */}
            <div
              data-testid="legal-switch"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button[role="switch"]')) return;
                if (legalOn) {
                  onToggleLegal(false);
                } else {
                  onActivateLegal();
                }
              }}
              className={cn(
                'flex cursor-pointer select-none items-center justify-between gap-2.5 rounded-xl border p-2.5 transition-colors',
                legalOn ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-surface-subtle/50 hover:bg-surface-subtle',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-text">{t('modes.legalTitle')}</div>
                <div className="text-[11px] text-muted leading-tight mt-0.5">{t('modes.legalHint')}</div>
              </div>
              <Switch
                data-testid="modes-menu-legal"
                checked={legalOn}
                label={t('modes.legalTitle')}
                title={t('modes.legalHint')}
                className="hit-expand scale-90"
                onCheckedChange={(enabled) => {
                  if (enabled) {
                    onActivateLegal();
                  } else {
                    onToggleLegal(false);
                  }
                }}
              />
              <span className="sr-only">
                <span>{t('modes.legalShort')}</span>
                <span>{t('modes.legalTitle')}</span>
              </span>
            </div>

            {legalOn && onOpenCase !== undefined ? (
              <button
                type="button"
                data-testid="modes-menu-open-case"
                onClick={() => {
                  setPopoverOpen(false);
                  onOpenCase();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-surface py-2 text-xs font-medium text-text transition-colors hover:bg-surface-subtle"
              >
                {t('modes.openCase')}
              </button>
            ) : null}

            {!legalConfigured ? (
              <button
                type="button"
                data-testid="modes-menu-configure"
                onClick={() => {
                  setPopoverOpen(false);
                  onConfigureLegal();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-surface py-2 text-xs font-medium text-text transition-colors hover:bg-surface-subtle"
              >
                {t('modes.configureLegal')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Contenedor accesible / de compatibilidad para tests */}
      <div data-testid="modes-menu-button" className="sr-only">
        <ModeToggle
          testId="modes-menu-research"
          checked={researchMode}
          disabled={researchDisabled}
          icon={<Globe aria-hidden="true" className="size-3.5 shrink-0" />}
          label={t('modes.researchTitle')}
          shortLabel={t('modes.researchShort')}
          hint={t('modes.researchHint')}
          onToggle={() => onToggleResearch(!researchMode)}
        />
        {!popoverOpen ? (
          <>
            <div data-testid="legal-switch" className="sr-only">
              <Switch
                data-testid="modes-menu-legal"
                checked={legalOn}
                label={t('modes.legalTitle')}
                title={t('modes.legalHint')}
                className="hit-expand"
                onCheckedChange={(enabled) => {
                  if (enabled) onActivateLegal();
                  else onToggleLegal(false);
                }}
              />
              <span>{t('modes.legalShort')}</span>
              <span>{t('modes.legalTitle')}</span>
            </div>
            {legalOn && onOpenCase !== undefined ? (
              <button
                type="button"
                data-testid="modes-menu-open-case"
                onClick={onOpenCase}
              >
                {t('modes.openCase')}
              </button>
            ) : null}
            {!legalConfigured ? (
              <button
                type="button"
                data-testid="modes-menu-configure"
                onClick={onConfigureLegal}
              >
                {t('modes.configureLegal')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <p data-testid="modes-menu-summary" role="status" className="sr-only">
        {summary}
      </p>
    </div>
  );
}

interface ModeToggleProps {
  testId: string;
  checked: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  shortLabel: string;
  hint: string;
  onToggle: () => void;
}

function ModeToggle({
  testId,
  checked,
  disabled = false,
  icon,
  label,
  shortLabel,
  hint,
  onToggle,
}: ModeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={hint}
      disabled={disabled}
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        'hit-expand inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap shadow-2xs transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 active:scale-95',
        checked
          ? 'border-primary/50 bg-primary-soft text-primary'
          : 'border-border/80 bg-surface/80 text-muted backdrop-blur-xs hover:border-border hover:bg-surface hover:text-text',
      )}
    >
      {icon}
      <span>
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      {checked ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
    </button>
  );
}
