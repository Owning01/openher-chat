import {
  applyThemeVars,
  DEFAULT_THEME_NAME,
  getThemeDefinition,
  resolveTheme as resolveThemeColors,
  themeToCSSVars,
} from '@/domain/themes';

export type Theme = 'light' | 'dark' | 'system';

type ResolvedTheme = 'light' | 'dark';

interface LegacyMediaQueryList {
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Lee `prefers-color-scheme` de forma duck-typed: exige que `matchMedia` sea
 * función, que la llamada no lance y que el resultado exponga `matches`.
 * Devuelve null si el entorno no lo soporta (theme claro, sin listener).
 */
function readDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    const mediaQueryList = window.matchMedia(DARK_MEDIA_QUERY);
    return typeof mediaQueryList.matches === 'boolean' ? mediaQueryList : null;
  } catch {
    return null;
  }
}

/** Suscribe al cambio de tema y devuelve el unsubscribe, soportando listeners modernos y legacy. */
function subscribeToChange(mediaQueryList: MediaQueryList, listener: () => void): () => void {
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', listener);
    return () => {
      if (typeof mediaQueryList.removeEventListener === 'function') {
        mediaQueryList.removeEventListener('change', listener);
        return;
      }
      (mediaQueryList as unknown as LegacyMediaQueryList).removeListener?.(listener);
    };
  }

  const legacy = mediaQueryList as unknown as LegacyMediaQueryList;
  if (typeof legacy.addListener === 'function') {
    legacy.addListener(listener);
    return () => legacy.removeListener?.(listener);
  }

  return () => undefined;
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return readDarkQuery()?.matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, themeVariant: string = DEFAULT_THEME_NAME): () => void {
  const root = document.documentElement;

  const apply = (): void => {
    const resolved = resolveTheme(theme);
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    root.setAttribute('data-theme', resolved);

    try {
      const themeDef = getThemeDefinition(themeVariant);
      const resolvedColors = resolveThemeColors(themeDef, resolved);
      const cssVars = themeToCSSVars(resolvedColors);
      applyThemeVars(cssVars);
    } catch {
      // Ignorar fallback
    }
  };

  apply();

  if (theme !== 'system') return () => undefined;

  const mediaQueryList = readDarkQuery();
  if (!mediaQueryList) return () => undefined;

  return subscribeToChange(mediaQueryList, apply);
}

