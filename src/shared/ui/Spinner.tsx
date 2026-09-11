import { useT } from '@/i18n/useT';
import { LoaderCircle } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-7',
};

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const t = useT();

  return (
    <span
      role="status"
      aria-label={label ?? t('common.loading')}
      className={cn('inline-flex items-center justify-center text-muted', className)}
    >
      <LoaderCircle aria-hidden="true" className={cn('animate-spin', SIZE_CLASSES[size])} />
    </span>
  );
}
