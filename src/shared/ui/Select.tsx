import type { ComponentProps } from 'react';

import { ChevronDown } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'children'> {
  options: readonly SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

const BASE_CLASSES =
  'h-10 w-full appearance-none rounded-lg border border-border bg-surface px-3 pr-9 text-sm text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

export function Select({ options, placeholder, invalid = false, className, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={cn(BASE_CLASSES, invalid && 'border-danger focus-visible:ring-danger', className)}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
