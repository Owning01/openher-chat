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
  it('tiene configurado ade-minimal como tema por defecto con tonalidades modernas', () => {
    expect(DEFAULT_THEME_NAME).toBe('ade-minimal');
    expect(THEME_DEFINITIONS[DEFAULT_THEME_NAME]).toBeDefined();
    expect(THEME_DEFINITIONS[DEFAULT_THEME_NAME]?.label).toContain('Ade Minimal');
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

  it('genera variables CSS compatibles con Tailwind v4 (@theme) y acentos de color', () => {
    const ade = getThemeDefinition('ade-minimal');
    const darkVars = themeToCSSVars(resolveTheme(ade, 'dark'));

    expect(darkVars['--color-background']).toBe('#09090b');
    expect(darkVars['--color-surface']).toBe('#18181b');
    expect(darkVars['--color-text']).toBe('#fafafa');
    expect(darkVars['--color-primary']).toBe('#818cf8');
    expect(darkVars['--color-success']).toBe('#4ade80');
    expect(darkVars['--color-primary-soft']).toBeDefined();
    expect(darkVars['--bg']).toBe('#09090b');
    expect(darkVars['--surface']).toBe('#18181b');
  });

  it('getThemeDefinition provee fallback seguro si el tema solicitado no existe', () => {
    const fallback = getThemeDefinition('tema-inexistente-123');
    expect(fallback.name).toBe('ade-minimal');
  });
});
