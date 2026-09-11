import type { ReactNode } from 'react';

import { cn } from '@/shared/utils/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 px-6 py-12 text-center', className)}>
      {icon ? (
        <div className="grid size-12 place-items-center rounded-full bg-surface-subtle text-muted">{icon}</div>
      ) : null}
      <div className="space-y-1">
        <p className="text-base font-medium text-text">{title}</p>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
