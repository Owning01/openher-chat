import { useState } from 'react';

import { useT } from '@/i18n/useT';
import { Brain, ChevronDown } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export interface ReasoningBlockProps {
  text: string;
  streaming?: boolean;
}

export function ReasoningBlock({ text, streaming = false }: ReasoningBlockProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div data-block="reasoning" className="my-1.5 w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group -mx-1.5 flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
          <Brain aria-hidden="true" className="size-3.5 shrink-0" />
        </span>
        <span className={cn('flex-1 transition-colors', streaming && 'anim-shimmer-text font-medium')}>
          {t('chat.reasoning')}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 shrink-0 text-muted transition-transform duration-300 ease-out', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="relative mt-1.5 ml-2.5 border-l border-border-subtle py-1 pl-3.5">
          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted/90 selection:bg-primary/20">
            {text}
          </div>
        </div>
      ) : null}
    </div>
  );
}

