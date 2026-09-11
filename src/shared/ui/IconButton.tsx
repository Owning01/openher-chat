import type { ReactNode } from 'react';

import { Button, type ButtonProps } from './Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconOnly' | 'fullWidth'> {
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      iconOnly
      icon={icon}
    />
  );
}
