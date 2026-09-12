import { useT } from '@/i18n/useT';
import { LoaderCircle } from '@/shared/icons';

export function StreamingIndicator() {
  const t = useT();

  return (
    <div
      data-testid="chat-streaming-indicator"
      role="status"
      aria-label={t('chat.streaming')}
      className="flex items-center gap-2 px-1 py-2 text-xs text-muted"
    >
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      <span>{t('chat.streaming')}</span>
    </div>
  );
}
