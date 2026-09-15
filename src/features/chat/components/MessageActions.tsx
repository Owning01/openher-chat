import { useState } from 'react';

import type { Role } from '@/domain/types/chat';
import { useCitationGuard } from '@/features/legal/state/CitationGuardContext';
import { useT } from '@/i18n/useT';
import { Download, FileText, Pencil, Play, RefreshCw, Trash } from '@/shared/icons';
import { CopyButton } from '@/shared/markdown/CopyButton';
import { Button, IconButton, TextArea } from '@/shared/ui';
import { downloadBinaryFile, downloadTextFile } from '@/shared/utils/download';
import { DOCX_MIME, markdownToDocx } from '@/adapters/documents/docxWriter';

export interface MessageActionsProps {
  messageId: string;
  role: Role;
  text: string;
  canRegenerate: boolean;
  /** Presente solo cuando la respuesta se truncó y puede reanudarse. */
  onContinue?: (messageId: string) => void;
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
  onContinue,
  disabled,
  onRegenerate,
  onEditStart,
  onDelete,
}: MessageActionsProps) {
  const t = useT();
  // En contexto legal el copiar usa el texto post-guard (con los `[VERIFICAR]`
  // visibles); fuera del provider el guard es identidad y no cambia nada. La API
  // pública no cambia: `CopyButton` sigue recibiendo `text` (vive en otro archivo).
  const guard = useCitationGuard();
  const copyText = guard.mark(text);

  return (
    <div className="flex items-center gap-0.5">
      <CopyButton text={copyText} label={t('chat.copy')} copiedLabel={t('chat.copied')} />
      {role === 'assistant' ? (
        <IconButton
          size="sm"
          disabled={disabled || text.trim() === ''}
          label={t('chat.download')}
          icon={<Download aria-hidden="true" className="size-4" />}
          onClick={() =>
            downloadTextFile(`respuesta-${messageId.slice(0, 8)}.md`, copyText, 'text/markdown')
          }
        />
      ) : null}
      {role === 'assistant' ? (
        <IconButton
          size="sm"
          disabled={disabled || text.trim() === ''}
          label={t('chat.downloadWord')}
          icon={<FileText aria-hidden="true" className="size-4" />}
          onClick={() =>
            downloadBinaryFile(`respuesta-${messageId.slice(0, 8)}.docx`, markdownToDocx(copyText), DOCX_MIME)
          }
        />
      ) : null}
      {role === 'assistant' && onContinue !== undefined ? (
        <IconButton
          size="sm"
          disabled={disabled}
          label={t('chat.continue')}
          icon={<Play aria-hidden="true" className="size-4" />}
          onClick={() => onContinue(messageId)}
        />
      ) : null}
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
