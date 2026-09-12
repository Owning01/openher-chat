import { useT } from '@/i18n/useT';
import type { Conversation } from '@/domain/types/conversation';
import { Pencil, Trash } from '@/shared/icons';
import { IconButton } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

export interface ConversationItemProps {
  conversation: Conversation;
  active: boolean;
  onSelect: (id: string) => void;
  onRename: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
}

export function ConversationItem({ conversation, active, onSelect, onRename, onDelete }: ConversationItemProps) {
  const t = useT();
  const title = conversation.title.trim() === '' ? t('conversations.untitled') : conversation.title;
  const preview = conversation.lastMessagePreview.trim() === '' ? t('conversations.previewEmpty') : conversation.lastMessagePreview;

  return (
    <li
      className={cn(
        'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
        active ? 'bg-primary-soft' : 'hover:bg-surface-subtle',
      )}
    >
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        aria-label={t('conversations.itemLabel', { title })}
        onClick={() => onSelect(conversation.id)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="truncate text-sm font-medium text-text">{title}</span>
        <span className="truncate text-xs text-muted">{preview}</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
        <IconButton
          size="sm"
          label={t('conversations.rename')}
          icon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={() => onRename(conversation)}
        />
        <IconButton
          size="sm"
          label={t('conversations.delete')}
          icon={<Trash aria-hidden="true" className="size-4" />}
          onClick={() => onDelete(conversation)}
        />
      </div>
    </li>
  );
}
