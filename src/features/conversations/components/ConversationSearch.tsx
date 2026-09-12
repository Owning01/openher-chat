import { useT } from '@/i18n/useT';
import { Search } from '@/shared/icons';
import { Input } from '@/shared/ui';

export interface ConversationSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function ConversationSearch({ value, onChange }: ConversationSearchProps) {
  const t = useT();

  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        value={value}
        aria-label={t('conversations.searchLabel')}
        placeholder={t('conversations.searchPlaceholder')}
        className="pl-9"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
