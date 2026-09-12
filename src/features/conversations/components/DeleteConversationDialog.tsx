import type { Conversation } from '@/domain/types/conversation';
import { useT } from '@/i18n/useT';
import { Button, Dialog } from '@/shared/ui';

export interface DeleteConversationDialogProps {
  conversation: Conversation;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function DeleteConversationDialog({ conversation, onClose, onConfirm }: DeleteConversationDialogProps) {
  const t = useT();
  const name = conversation.title.trim() === '' ? t('conversations.untitled') : conversation.title;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('conversations.deleteTitle')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => void onConfirm()}>
            {t('conversations.delete')}
          </Button>
        </>
      }
    >
      <p>{t('common.confirmDelete', { name })}</p>
      <p className="mt-1 text-muted">{t('conversations.deleteDescription')}</p>
    </Dialog>
  );
}
