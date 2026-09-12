import { useState } from 'react';

import type { Role } from '@/domain/types/chat';
import { useT } from '@/i18n/useT';
import { Pencil, RefreshCw, Trash } from '@/shared/icons';
import { CopyButton } from '@/shared/markdown/CopyButton';
import { Button, IconButton, TextArea } from '@/shared/ui';

export interface MessageActionsProps {
  messageId: string;
  role: Role;
  text: string;
  canRegenerate: boolean;
  disabled: boolean;
  onRegenerate: (messageId: string) => void;
  onEditStart: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}

export function MessageActions({
  messageId,
  role,
  text,
  canRegenerate,
  disabled,
  onRegenerate,
  onEditStart,
  onDelete,
}: MessageActionsProps) {
  const t = useT();

  return (
    <div className="flex items-center gap-0.5">
      <CopyButton text={text} label={t('chat.copy')} copiedLabel={t('chat.copied')} />
      {role === 'assistant' && canRegenerate ? (
        <IconButton
          size="sm"
          disabled={disabled}
          label={t('chat.regenerate')}
          icon={<RefreshCw aria-hidden="true" className="size-4" />}
          onClick={() => onRegenerate(messageId)}
        />
      ) : null}
      {role === 'user' ? (
        <IconButton
          size="sm"
          disabled={disabled}
          label={t('chat.edit')}
          icon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={() => onEditStart(messageId)}
        />
      ) : null}
      <IconButton
        size="sm"
        disabled={disabled}
        label={t('chat.delete')}
        icon={<Trash aria-hidden="true" className="size-4" />}
        onClick={() => onDelete(messageId)}
      />
    </div>
  );
}

export interface MessageEditFormProps {
  initialText: string;
  disabled: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function MessageEditForm({ initialText, disabled, onSubmit, onCancel }: MessageEditFormProps) {
  const t = useT();
  const [value, setValue] = useState(initialText);
  const canSave = value.trim() !== '' && !disabled;

  return (
    <form
      className="flex flex-col gap-2"
      data-testid="message-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSubmit(value.trim());
      }}
    >
      <TextArea
        autoResize
        rows={2}
        value={value}
        disabled={disabled}
        aria-label={t('chat.edit')}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" disabled={disabled} onClick={onCancel}>
          {t('chat.cancel')}
        </Button>
        <Button size="sm" type="submit" disabled={!canSave}>
          {t('chat.save')}
        </Button>
      </div>
    </form>
  );
}
