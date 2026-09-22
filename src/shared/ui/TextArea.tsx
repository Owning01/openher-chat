import type { ComponentProps } from 'react';

import { cn } from '@/shared/utils/cn';

export interface TextAreaProps extends ComponentProps<'textarea'> {
  autoResize?: boolean;
  invalid?: boolean;
  variant?: 'default' | 'ghost';
}

const DEFAULT_CLASSES =
  'rounded-lg border border-border bg-surface px-3 py-2 placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

const GHOST_CLASSES =
  'border-0 bg-transparent px-2 py-1 placeholder:text-muted/70 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 shadow-none';

const BASE_CLASSES =
  'w-full text-sm text-text transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function resizeToContent(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

export function TextArea({
  autoResize = false,
  invalid = false,
  variant = 'default',
  rows,
  className,
  onInput,
  ref,
  ...rest
}: TextAreaProps) {
  const handleRef = (node: HTMLTextAreaElement | null): void => {
    if (node && autoResize) resizeToContent(node);

    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <textarea
      {...rest}
      ref={handleRef}
      rows={rows ?? (autoResize ? 1 : 3)}
      aria-invalid={invalid || undefined}
      onInput={(event) => {
        if (autoResize) resizeToContent(event.currentTarget);
        onInput?.(event);
      }}
      className={cn(
        BASE_CLASSES,
        variant === 'ghost' ? GHOST_CLASSES : DEFAULT_CLASSES,
        autoResize && 'resize-none overflow-hidden',
        invalid && variant !== 'ghost' && 'border-danger focus-visible:ring-danger',
        className,
      )}
    />
  );
}
