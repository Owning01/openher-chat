import type { ReactNode } from 'react';

import { CircleAlert, Info, TriangleAlert } from '@/shared/icons';
import type { LucideIcon } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export type AlertVariant = 'info' | 'warning' | 'danger';

export interface AlertBannerProps {
  variant: AlertVariant;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

const VARIANT_ICONS: Record<AlertVariant, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const VARIANT_CONTAINERS: Record<AlertVariant, string> = {
  info: 'border-border bg-surface-subtle',
  warning: 'border-warning/30 bg-warning-soft',
  danger: 'border-danger/30 bg-danger-soft',
};

const VARIANT_ICON_CLASSES: Record<AlertVariant, string> = {
  info: 'text-primary',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function AlertBanner({ variant, title, description, action, className }: AlertBannerProps) {
  const Icon = VARIANT_ICONS[variant];

  return (
    <div
      role={variant === 'danger' ? 'alert' : 'note'}
      className={cn('flex items-start gap-3 rounded-lg border p-3', VARIANT_CONTAINERS[variant], className)}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', VARIANT_ICON_CLASSES[variant])} />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium text-text">{title}</p>
        {description !== undefined ? <p className="break-words text-muted">{description}</p> : null}
        {action}
      </div>
    </div>
  );
}
