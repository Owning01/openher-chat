import { LEGAL_CIRCUIT_ROLES } from '@/domain/types/legal';
import type { LegalCircuitRole } from '@/domain/types/legal';
import { useT } from '@/i18n/useT';
import type { MessageKey } from '@/i18n/types';
import { Button, Dialog } from '@/shared/ui';

export interface CircuitStage {
  role: LegalCircuitRole;
  conversationId: string | null;
  title: string | null;
}

export interface CircuitDialogProps {
  open: boolean;
  caseTitle: string | null;
  currentConversationId: string | null;
  /** Etapas en cualquier orden; se muestran en orden canónico del circuito. */
  stages: CircuitStage[];
  /** Hay documento del asistente para atacar desde el chat actual. */
  canDeriveAtacante: boolean;
  /** Existen escrito + ataque para elevar al definitivo. */
  canDeriveJuez: boolean;
  /** Existen escrito + ataque + veredicto para pasar a síntesis final. */
  canDeriveSintesis: boolean;
  busy: boolean;
  onDerive(role: LegalCircuitRole): void;
  onOpen(conversationId: string): void;
  onClose(): void;
}

export const ROLE_LABEL_KEYS: Record<LegalCircuitRole, MessageKey> = {
  redactor: 'chat.circuitRole_redactor',
  atacante: 'chat.circuitRole_atacante',
  juez: 'chat.circuitRole_juez',
  sintesis: 'chat.circuitRole_sintesis',
};

const ROLE_DESC_KEYS: Record<LegalCircuitRole, MessageKey> = {
  redactor: 'chat.circuitRoleDesc_redactor',
  atacante: 'chat.circuitRoleDesc_atacante',
  juez: 'chat.circuitRoleDesc_juez',
  sintesis: 'chat.circuitRoleDesc_sintesis',
};

const DERIVE_LABEL_KEYS: Record<LegalCircuitRole, MessageKey> = {
  redactor: 'chat.circuitNewRedactor',
  atacante: 'chat.circuitDeriveAtacante',
  juez: 'chat.circuitDeriveJuez',
  sintesis: 'chat.circuitDeriveSintesis',
};

/**
 * Circuito adversarial del expediente: cuatro chats con cuatro reglas
 * (redacción → ataque → veredicto → síntesis final). Cada etapa abre su chat
 * o lo deriva con la semilla correspondiente; el padre crea, vincula, navega
 * y auto-envía.
 */
export function CircuitDialog({
  open,
  caseTitle,
  currentConversationId,
  stages,
  canDeriveAtacante,
  canDeriveJuez,
  canDeriveSintesis,
  busy,
  onDerive,
  onOpen,
  onClose,
}: CircuitDialogProps) {
  const t = useT();
  const byRole = new Map(stages.map((stage) => [stage.role, stage]));
  const canDerive = (role: LegalCircuitRole): boolean => {
    if (role === 'redactor') return true;
    if (role === 'atacante') return canDeriveAtacante;
    if (role === 'juez') return canDeriveJuez;
    return canDeriveSintesis;
  };
  const blocked = LEGAL_CIRCUIT_ROLES.some(
    (role) => (byRole.get(role)?.conversationId ?? null) === null && !canDerive(role),
  );

  return (
    <Dialog open={open} onClose={onClose} title={t('chat.circuitTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {t('chat.circuitDescription')}
          {caseTitle !== null && caseTitle.trim() !== '' ? ` — ${caseTitle.trim()}` : ''}
        </p>
        <ol className="space-y-2">
          {LEGAL_CIRCUIT_ROLES.map((role, index) => {
            const stage = byRole.get(role);
            const conversationId = stage?.conversationId ?? null;
            const isCurrent = conversationId !== null && conversationId === currentConversationId;
            const derivable = canDerive(role);
            return (
              <li
                key={role}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-semibold text-muted"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">
                    {t(ROLE_LABEL_KEYS[role])}
                    {isCurrent ? ` · ${t('chat.circuitCurrent')}` : ''}
                  </p>
                  <p className="truncate text-xs text-muted" title={t(ROLE_DESC_KEYS[role])}>
                    {stage?.title !== null && stage?.title !== undefined && stage.title.trim() !== ''
                      ? stage.title.trim()
                      : t(ROLE_DESC_KEYS[role])}
                  </p>
                </div>
                {conversationId !== null ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => onOpen(conversationId)}
                  >
                    {t('chat.circuitOpen')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy || !derivable}
                    title={derivable ? undefined : t('chat.circuitNeedsDoc')}
                    onClick={() => onDerive(role)}
                  >
                    {t(DERIVE_LABEL_KEYS[role])}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
        {blocked ? <p className="text-xs text-muted">{t('chat.circuitNeedsDoc')}</p> : null}
      </div>
    </Dialog>
  );
}
