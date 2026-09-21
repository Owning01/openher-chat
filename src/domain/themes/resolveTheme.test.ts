import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_NAME,
  getThemeDefinition,
  resolveTheme,
  THEME_DEFINITIONS,
  THEME_NAMES,
  themeToCSSVars,
} from './index';

describe('theme system', () => {
  it('tiene configurado monochrome como tema por defecto', () => {
    expect(DEFAULT_THEME_NAME).toBe('monochrome');
    expect(THEME_DEFINITIONS[DEFAULT_THEME_NAME]).toBeDefined();
    expect(THEME_DEFINITIONS[DEFAULT_THEME_NAME]?.label).toContain('Monochrome');
  });

  it('exporta al menos 34 temas de OpenCode y estilos reconocidos', () => {
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(34);
    expect(THEME_NAMES).toContain('dracula');
    expect(THEME_NAMES).toContain('nord');
    expect(THEME_NAMES).toContain('catppuccin');
    expect(THEME_NAMES).toContain('tokyonight');
    expect(THEME_NAMES).toContain('gruvbox');
    expect(THEME_NAMES).toContain('monochrome');
  });

  it('resuelve el tema monocromático en modos claro y oscuro', () => {
    const mono = getThemeDefinition('monochrome');
    const darkResolved = resolveTheme(mono, 'dark');
    const lightResolved = resolveTheme(mono, 'light');

    expect(darkResolved.background).toBe('#09090b');
    expect(darkResolved.text).toBe('#f4f4f5');

    expect(lightResolved.background).toBe('#ffffff');
    expect(lightResolved.text).toBe('#09090b');
  });

  it('genera variables CSS compatibles con Tailwind v4 (@theme)', () => {
    const mono = getThemeDefinition('monochrome');
    const darkVars = themeToCSSVars(resolveTheme(mono, 'dark'));

    expect(darkVars['--color-background']).toBe('#09090b');
    expect(darkVars['--color-surface']).toBe('#18181b');
    expect(darkVars['--color-text']).toBe('#f4f4f5');
    expect(darkVars['--color-primary']).toBe('#fafafa');
    expect(darkVars['--bg']).toBe('#09090b');
    expect(darkVars['--surface']).toBe('#18181b');
  });

  it('getThemeDefinition provee fallback seguro si el tema solicitado no existe', () => {
    const fallback = getThemeDefinition('tema-inexistente-123');
    expect(fallback.name).toBe('monochrome');
  });
});
