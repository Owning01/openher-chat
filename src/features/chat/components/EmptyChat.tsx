import { useT } from '@/i18n/useT';
import type { MessageKey } from '@/i18n/types';
import { Sparkles } from '@/shared/icons';

const SUGGESTION_KEYS: readonly MessageKey[] = [
  'chat.suggestionExplain',
  'chat.suggestionWrite',
  'chat.suggestionSummarize',
  'chat.suggestionCode',
];

export interface EmptyChatProps {
  onSuggestion: (text: string) => void;
}

export function EmptyChat({ onSuggestion }: EmptyChatProps) {
  const t = useT();

  return (
    <section data-testid="chat-empty" className="flex flex-col items-center gap-5 py-8 text-center sm:py-12">
      <div className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
        <Sparkles aria-hidden="true" className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-text">{t('chat.emptyTitle')}</h2>
        <p className="text-sm text-muted">{t('chat.emptyDescription')}</p>
      </div>
      <ul aria-label={t('chat.suggestionsLabel')} className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTION_KEYS.map((key) => {
          const suggestion = t(key);
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className="h-full w-full rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-text transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {suggestion}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
