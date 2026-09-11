import type { ComponentProps } from 'react';

import { cn } from '@/shared/utils/cn';

export type SkeletonRounded = 'none' | 'sm' | 'md' | 'lg' | 'full';

export interface SkeletonProps extends ComponentProps<'div'> {
  rounded?: SkeletonRounded;
}

const ROUNDED_CLASSES: Record<SkeletonRounded, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export function Skeleton({ rounded = 'md', className, ...rest }: SkeletonProps) {
  return (
    <div
      {...rest}
      aria-hidden="true"
      className={cn('h-4 w-full animate-pulse bg-surface-subtle', ROUNDED_CLASSES[rounded], className)}
    />
  );
}
