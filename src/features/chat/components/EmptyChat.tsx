import { useT } from '@/i18n/useT';
import type { MessageKey } from '@/i18n/types';
import { Logo } from '@/shared/brand/Logo';
import { BookOpen, Code, FileText, Sparkles } from '@/shared/icons';
import type { LucideIcon } from '@/shared/icons';

const SUGGESTIONS: readonly { key: MessageKey; icon: LucideIcon }[] = [
  { key: 'chat.suggestionExplain', icon: BookOpen },
  { key: 'chat.suggestionWrite', icon: Sparkles },
  { key: 'chat.suggestionSummarize', icon: FileText },
  { key: 'chat.suggestionCode', icon: Code },
];

export interface EmptyChatProps {
  onSuggestion: (text: string) => void;
}

export function EmptyChat({ onSuggestion }: EmptyChatProps) {
  const t = useT();

  return (
    <section data-testid="chat-empty" className="flex flex-col items-center gap-6 py-8 text-center sm:py-14">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-surface-subtle/80 p-2 shadow-xs ring-1 ring-border/50">
        <Logo size={44} />
      </div>
      <div className="space-y-1.5 max-w-md">
        <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">{t('chat.emptyTitle')}</h2>
        <p className="text-sm leading-relaxed text-muted">{t('chat.emptyDescription')}</p>
      </div>
      <ul aria-label={t('chat.suggestionsLabel')} className="grid w-full gap-2.5 sm:grid-cols-2 pt-2">
        {SUGGESTIONS.map(({ key, icon: Icon }, index) => {
          const suggestion = t(key);
          return (
            <li key={key} className="anim-blur-in" style={{ animationDelay: `${index * 70}ms` }}>
              <button
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className="group flex h-full w-full items-start gap-3 rounded-2xl border border-border/80 bg-surface/70 p-3.5 text-left text-sm text-text shadow-xs backdrop-blur-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:translate-y-0 active:scale-[0.99]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1 leading-snug font-medium pt-1 text-text/90 group-hover:text-text">
                  {suggestion}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
