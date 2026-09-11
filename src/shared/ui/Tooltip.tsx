import type { ReactNode } from 'react';

import { cn } from '@/shared/utils/cn';

export interface TooltipProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ label, children, className }: TooltipProps) {
  return (
    <span className={cn('inline-flex', className)} title={label}>
      {children}
    </span>
  );
}
