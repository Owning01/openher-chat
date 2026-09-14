import { useT } from '@/i18n/useT';
import { Button, Dialog } from '@/shared/ui';

import type { ToolApprovalRequest } from '../state/chatStore';

export interface ToolApprovalDialogProps {
  request: ToolApprovalRequest;
  onApprove: (always: boolean) => void;
  onDeny: () => void;
}

/** Diálogo del gate de permisos: autoriza o deniega la ejecución de una tool. */
export function ToolApprovalDialog({ request, onApprove, onDeny }: ToolApprovalDialogProps) {
  const t = useT();

  return (
    <Dialog
      open
      onClose={onDeny}
      title={t('chat.approvalTitle')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onDeny}>
            {t('chat.approvalDeny')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onApprove(false)}>
            {t('chat.approvalOnce')}
          </Button>
          <Button size="sm" onClick={() => onApprove(true)}>
            {t('chat.approvalAlways')}
          </Button>
        </>
      }
    >
      <p>{t('chat.approvalBody', { tool: request.tool })}</p>
      <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-subtle p-2 font-mono text-xs text-text">
        {request.argumentsText}
      </pre>
    </Dialog>
  );
}
