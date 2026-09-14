import { ConversationsPanel } from '@/features/conversations/ConversationsPanel';
import { useT } from '@/i18n/useT';
import { Sparkles } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const t = useT();

  return (
    <aside
      aria-label={t('app.sidebarLabel')}
      className={cn(
        'flex w-72 flex-col border-r border-border bg-surface pt-[var(--safe-area-inset-top)] pb-[var(--safe-area-inset-bottom)]',
        className,
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <Sparkles aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <span className="truncate text-sm font-semibold text-text">{t('app.title')}</span>
      </div>
      <ConversationsPanel onNavigate={onNavigate} />
    </aside>
  );
}
