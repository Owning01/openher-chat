import type { ComponentProps } from 'react';

import { cn } from '@/shared/utils/cn';

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean;
}

const BASE_CLASSES =
  'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ invalid = false, className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(BASE_CLASSES, invalid && 'border-danger focus-visible:ring-danger', className)}
    />
  );
}
