import { useState } from 'react';

import { useT } from '@/i18n/useT';
import { Brain, ChevronDown } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export interface ReasoningBlockProps {
  text: string;
}

export function ReasoningBlock({ text }: ReasoningBlockProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div data-block="reasoning" className="rounded-lg border border-border-subtle bg-surface-subtle/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Brain aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex-1">{t('chat.reasoning')}</span>
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="whitespace-pre-wrap border-t border-border-subtle px-3 py-2 text-xs leading-relaxed text-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}
