import {
  DEFAULT_THEME_NAME,
  THEME_DEFINITIONS,
  type ThemeDefinition,
} from './themeDefinitions';

export * from './themeDefinitions';
export * from './resolveTheme';

/**
 * Obtiene la definición de un tema por nombre, con fallback seguro a 'monochrome'.
 */
export function getThemeDefinition(name: string): ThemeDefinition {
  const def = THEME_DEFINITIONS[name];
  if (def) return def;
  const fallback = THEME_DEFINITIONS[DEFAULT_THEME_NAME];
  if (fallback) return fallback;
  // Fallback de emergencia si ni siquiera 'monochrome' estuviera
  return Object.values(THEME_DEFINITIONS)[0]!;
}
