import { useEffect, useRef, useState } from 'react';

import type { Conversation } from '@/domain/types/conversation';
import { useT } from '@/i18n/useT';
import { Button, Dialog, Input } from '@/shared/ui';

export interface RenameConversationDialogProps {
  conversation: Conversation;
  onClose: () => void;
  onSubmit: (title: string) => void | Promise<void>;
}

export function RenameConversationDialog({ conversation, onClose, onSubmit }: RenameConversationDialogProps) {
  const t = useT();
  const [title, setTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = title.trim();
  const canSave = trimmed !== '';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    if (!canSave) return;
    void onSubmit(trimmed);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('conversations.renameTitle')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t('conversations.renameLabel')}</span>
        <Input
          ref={inputRef}
          value={title}
          maxLength={120}
          placeholder={t('conversations.renamePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Dialog>
  );
}
