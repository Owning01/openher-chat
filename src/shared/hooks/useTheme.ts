import { useEffect } from 'react';

import { applyTheme, type Theme } from './theme';

export function useTheme(theme: Theme, themeVariant?: string): void {
  useEffect(() => applyTheme(theme, themeVariant), [theme, themeVariant]);
}

