import { useEffect } from 'react';

import { applyTheme, type Theme } from './theme';

export function useTheme(theme: Theme): void {
  useEffect(() => applyTheme(theme), [theme]);
}
