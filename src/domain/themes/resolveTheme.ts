import type { ThemeDefinition } from './themeDefinitions';

const CSS_MAP: Record<string, string> = {
  background: '--bg',
  backgroundPanel: '--surface',
  backgroundElement: '--surface-strong',
  border: '--border',
  borderActive: '--border-strong',
  borderSubtle: '--border-subtle',
  text: '--text',
  textMuted: '--muted',
  primary: '--primary',
  secondary: '--secondary',
  accent: '--accent',
  warning: '--warning',
  success: '--success',
  error: '--danger',
  info: '--info',
  markdownText: '--md-text',
  markdownHeading: '--md-heading',
  markdownLink: '--md-link',
  markdownLinkText: '--md-link-text',
  markdownCode: '--md-code',
  markdownCodeBlock: '--md-code-block',
  markdownBlockQuote: '--md-quote',
  markdownEmph: '--md-emph',
  markdownStrong: '--md-strong',
  markdownHorizontalRule: '--md-hr',
  markdownListItem: '--md-list-item',
  markdownListEnumeration: '--md-list-num',
  markdownImage: '--md-image',
  markdownImageText: '--md-image-text',
  syntaxComment: '--code-comment',
  syntaxKeyword: '--code-keyword',
  syntaxFunction: '--code-function',
  syntaxString: '--code-string',
  syntaxNumber: '--code-number',
  syntaxVariable: '--code-builtin',
  syntaxType: '--code-attr',
  syntaxOperator: '--code-attr',
  syntaxPunctuation: '--code-text',
};

function resolveColor(
  value: unknown,
  defs: Record<string, string>,
  theme: Record<string, unknown>,
  chain: string[],
): string {
  if (typeof value === 'string') {
    if (value.startsWith('#')) return value;
    if (chain.includes(value)) return '#000000';
    const next = defs[value] ?? theme[value];
    if (next !== undefined) return resolveColor(next, defs, theme, [...chain, value]);
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return resolveColor(obj['dark'] ?? obj['light'], defs, theme, chain);
  }
  return '#000000';
}

export function resolveTheme(
  json: ThemeDefinition,
  mode: 'dark' | 'light',
): Record<string, string> {
  const defs = json.defs ?? {};
  const theme = json.theme ?? {};
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(theme)) {
    if (
      key === 'thinkingOpacity' ||
      key === 'selectedListItemText' ||
      key === 'backgroundMenu'
    ) {
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      const modeVal = obj[mode] ?? obj['dark'] ?? obj['light'];
      if (modeVal !== undefined) {
        result[key] = resolveColor(modeVal, defs, theme, []);
      }
    } else if (typeof value === 'string') {
      result[key] = resolveColor(value, defs, theme, []);
    }
  }
  return result;
}

export function themeToCSSVars(resolved: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [slot, hex] of Object.entries(resolved)) {
    const cssName = CSS_MAP[slot];
    if (cssName) vars[cssName] = hex;
  }

  // Fallbacks de superficie y texto
  vars['--surface-subtle'] = resolved['backgroundPanel'] ?? resolved['background'] ?? '#000000';
  vars['--muted-strong'] = resolved['textMuted'] ?? '#666666';
  vars['--thinking-header'] = resolved['warning'] ?? '#f5a742';
  vars['--thinking-text'] = resolved['textMuted'] ?? '#808080';

  // Integración directa con Tailwind v4 theme variables de openher-chat
  vars['--color-background'] = vars['--bg'] ?? resolved['background'] ?? '#09090b';
  vars['--color-surface'] = vars['--surface'] ?? resolved['backgroundPanel'] ?? '#18181b';
  vars['--color-surface-subtle'] = vars['--surface-subtle'] ?? resolved['backgroundElement'] ?? '#27272a';
  vars['--color-border'] = vars['--border'] ?? resolved['border'] ?? '#27272a';
  vars['--color-border-subtle'] = vars['--border-subtle'] ?? resolved['borderSubtle'] ?? '#27272a';
  vars['--color-text'] = vars['--text'] ?? resolved['text'] ?? '#fafafa';
  vars['--color-muted'] = vars['--muted'] ?? resolved['textMuted'] ?? '#a1a1aa';
  vars['--color-primary'] = vars['--primary'] ?? resolved['primary'] ?? '#5e6ad2';
  vars['--color-focus-ring'] = vars['--primary'] ?? '#5e6ad2';

  if (resolved['success']) vars['--color-success'] = resolved['success'];
  if (resolved['warning']) vars['--color-warning'] = resolved['warning'];
  if (resolved['error']) vars['--color-danger'] = resolved['error'];
  if (resolved['info']) vars['--color-info'] = resolved['info'];

  // Color de texto sobre botón primary
  const primaryBg = vars['--color-primary'] ?? '#5e6ad2';
  vars['--color-on-primary'] = luminance(primaryBg) > 0.4 ? '#09090b' : '#fafafa';
  vars['--color-primary-soft'] = mixHex(primaryBg, vars['--color-background'], 0.82);

  if (vars['--color-success']) {
    vars['--color-success-soft'] = mixHex(vars['--color-success'], vars['--color-background'], 0.85);
  }
  if (vars['--color-warning']) {
    vars['--color-warning-soft'] = mixHex(vars['--color-warning'], vars['--color-background'], 0.85);
  }
  if (vars['--color-danger']) {
    vars['--color-danger-soft'] = mixHex(vars['--color-danger'], vars['--color-background'], 0.85);
  }

  const bg = vars['--color-background'] ?? '#000000';
  const surface = vars['--color-surface'] ?? bg;
  const textFg = vars['--color-text'] ?? '#ffffff';
  const textBg = contrast(textFg, bg) <= contrast(textFg, surface) ? bg : surface;

  clampVar(vars, '--color-text', textBg, 4.5);
  clampVar(vars, '--text', textBg, 4.5);
  clampVar(vars, '--color-muted', bg, 3.5);
  clampVar(vars, '--muted', bg, 3.5);
  clampVar(vars, '--color-primary', bg, 3);
  clampVar(vars, '--primary', bg, 3);

  return vars;
}

function clampVar(vars: Record<string, string>, name: string, bg: string, min: number) {
  const fg = vars[name];
  if (!fg || !/^#[0-9a-fA-F]{3,8}$/.test(fg)) return;
  const fixed = ensureContrast(fg, bg, min);
  if (fixed !== fg) vars[name] = fixed;
}

export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    for (const target of ['#000000', '#ffffff']) {
      const mixed = mixHex(fg, target, t);
      if (contrast(mixed, bg) >= min) return mixed;
    }
  }
  return fg;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function applyThemeVars(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}
