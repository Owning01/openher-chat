import type { ComponentProps } from 'react';

import { cn } from '@/shared/utils/cn';

export interface TextAreaProps extends ComponentProps<'textarea'> {
  autoResize?: boolean;
  invalid?: boolean;
}

const BASE_CLASSES =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

function resizeToContent(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

export function TextArea({
  autoResize = false,
  invalid = false,
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
        autoResize && 'resize-none overflow-hidden',
        invalid && 'border-danger focus-visible:ring-danger',
        className,
      )}
    />
  );
}
