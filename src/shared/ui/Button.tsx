import type { ComponentProps, ReactNode } from 'react';

import { LoaderCircle } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
}

const BASE_CLASSES =
  'inline-flex select-none items-center justify-center font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90 active:opacity-80',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-subtle active:bg-surface-subtle',
  ghost: 'bg-transparent text-text hover:bg-surface-subtle active:bg-surface-subtle',
  danger: 'bg-danger text-on-danger hover:opacity-90 active:opacity-80',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-md px-3 text-sm',
  md: 'h-10 gap-2 rounded-lg px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-5 text-base',
};

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'size-8 rounded-md hit-expand',
  md: 'size-10 rounded-lg hit-expand',
  lg: 'size-12 rounded-xl hit-expand',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  iconOnly = false,
  type = 'button',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE_CLASSES,
        VARIANT_CLASSES[variant],
        iconOnly ? ICON_SIZE_CLASSES[size] : SIZE_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : icon}
      {loading && iconOnly ? null : children}
    </button>
  );
}
