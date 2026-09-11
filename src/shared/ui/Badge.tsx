import type { ComponentProps } from 'react';

import { cn } from '@/shared/utils/cn';

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'border-border bg-surface-subtle text-muted',
  primary: 'border-transparent bg-primary-soft text-primary',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  danger: 'border-transparent bg-danger-soft text-danger',
};

export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        VARIANT_CLASSES[variant],
        className,
      )}
    />
  );
}
