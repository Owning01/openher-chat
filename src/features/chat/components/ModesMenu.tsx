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
  const legalOn = legalCaseId != null;

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
      data-testid="modes-menu"
      role="group"
      aria-label={t('modes.buttonLabel')}
      className={cn('inline-flex items-center gap-2', className)}
    >
      {/* Botón directo de Modo Abogado en la cabecera */}
      <div
        data-testid="legal-switch"
        className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface/80 px-2.5 py-1 text-xs transition-colors hover:border-border hover:bg-surface"
      >
        <Scale aria-hidden="true" className={cn('size-3.5 shrink-0', legalOn ? 'text-primary' : 'text-muted')} />
        <span
          onClick={() => {
            if (legalOn) onToggleLegal(false);
            else onActivateLegal();
          }}
          className={cn('cursor-pointer select-none font-medium', legalOn ? 'text-primary font-semibold' : 'text-muted hover:text-text')}
        >
          <span className="sm:hidden">{t('modes.legalShort')}</span>
          <span className="hidden sm:inline">{t('modes.legalTitle')}</span>
        </span>
        <Switch
          data-testid="modes-menu-legal"
          checked={legalOn}
          label={t('modes.legalTitle')}
          title={t('modes.legalHint')}
          className="hit-expand w-11 scale-90"
          onCheckedChange={(enabled) => {
            if (enabled) {
              onActivateLegal();
            } else {
              onToggleLegal(false);
            }
          }}
        />
      </div>

      {legalOn && onOpenCase !== undefined ? (
        <button
          type="button"
          data-testid="modes-menu-open-case"
          onClick={onOpenCase}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border/80 bg-surface px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-text"
        >
          <span>{t('modes.openCase')}</span>
        </button>
      ) : null}

      {!legalConfigured ? (
        <button
          type="button"
          data-testid="modes-menu-configure"
          onClick={onConfigureLegal}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border/80 bg-surface px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-text"
        >
          <span>{t('modes.configureLegal')}</span>
        </button>
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
