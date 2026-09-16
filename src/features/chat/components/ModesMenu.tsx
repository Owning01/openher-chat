import type { ReactNode } from 'react';

import { useT } from '@/i18n/useT';
import { Check, FileText, Globe } from '@/shared/icons';
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
 * Activación de los modos combinables de la cabecera (D17): dos toggles
 * siempre visibles y rotulados, en vez del menú desplegable poco descubrible.
 * Sigue siendo una segunda entrada, no una segunda fuente: deriva
 * `researchMode` y `legalCaseId != null` (ortogonales: general, investigación,
 * legal o ambos); prohibido un enum de "modo actual".
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
  // Derivación del estado combinado (D17): `legalOn` no es estado propio.
  const legalOn = legalCaseId != null;

  const handleLegalClick = (): void => {
    if (legalOn) {
      onToggleLegal(false);
      return;
    }
    // Encender sin caso abre el diálogo de vínculo en vez de inventar un caso.
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
    <div
      data-testid="modes-menu"
      role="group"
      aria-label={t('modes.buttonLabel')}
      className={cn(
        'flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1.5',
        className,
      )}
    >
      {/* Compatibilidad de contrato: ChatPage.test.tsx (fuera de alcance) sigue
          abriendo los modos con un click en `modes-menu-button`. Ahora están
          siempre visibles, así que el testid del disparador vive en el grupo. */}
      <div data-testid="modes-menu-button" className="flex flex-wrap items-center gap-4">
        <ModeToggle
          testId="modes-menu-research"
          checked={researchMode}
          disabled={researchDisabled}
          icon={<Globe aria-hidden="true" className="size-4 shrink-0" />}
          label={t('modes.researchTitle')}
          shortLabel={t('modes.researchShort')}
          hint={t('modes.researchHint')}
          onToggle={() => onToggleResearch(!researchMode)}
        />
        <ModeToggle
          testId="modes-menu-legal"
          checked={legalOn}
          icon={<FileText aria-hidden="true" className="size-4 shrink-0" />}
          label={t('modes.legalTitle')}
          shortLabel={t('modes.legalShort')}
          hint={t('modes.legalHint')}
          onToggle={handleLegalClick}
        />
      </div>
      {legalOn && onOpenCase !== undefined ? (
        <button
          type="button"
          data-testid="modes-menu-open-case"
          onClick={onOpenCase}
          className={SECONDARY_BUTTON_CLASSES}
        >
          {t('modes.openCase')}
        </button>
      ) : null}
      {legalConfigured ? null : (
        <button
          type="button"
          data-testid="modes-menu-configure"
          onClick={onConfigureLegal}
          className={SECONDARY_BUTTON_CLASSES}
        >
          {t('modes.configureLegal')}
        </button>
      )}
      <p
        data-testid="modes-menu-summary"
        role="status"
        className="min-w-0 max-w-44 truncate text-xs text-muted sm:max-w-64"
      >
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
  /** Nombre accesible completo y rótulo visible en pantallas anchas. */
  label: string;
  /** Rótulo corto para mobile (icono + texto corto). */
  shortLabel: string;
  /** Ayuda breve (tooltip) del alcance del modo. */
  hint: string;
  onToggle: () => void;
}

/** Toggle rotulado de un modo: estado activo con fondo primary suave y tilde. */
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
        'hit-expand inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50',
        checked
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border bg-surface text-text hover:bg-surface-subtle',
      )}
    >
      {icon}
      {/* El texto visible se acorta en mobile; el nombre accesible no cambia. */}
      <span aria-hidden="true">
        <span className="sm:hidden">{shortLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
    </button>
  );
}

const SECONDARY_BUTTON_CLASSES =
  'inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-surface px-3 text-sm whitespace-nowrap text-text transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
