/**
 * Paletas cromáticas temáticas dinámicas para Informes Visuales HTML.
 * Evita la monotonía visual variando esquemas de color por reporte o elección de usuario.
 */

export type ReportThemeId =
  | 'editorial-navy'
  | 'emerald-mint'
  | 'sunset-amber'
  | 'cyber-indigo'
  | 'warm-earth'
  | 'crimson-velvet';

export interface ReportTheme {
  id: ReportThemeId;
  name: string;
  description: string;
  primary: string;
  secondary: string;
  accent: string;
  bgMain: string;
  bgCard: string;
  textTitle: string;
  textBody: string;
  textMuted: string;
  border: string;
}

export const REPORT_THEMES: Record<ReportThemeId, ReportTheme> = {
  'editorial-navy': {
    id: 'editorial-navy',
    name: 'Editorial Navy',
    description: 'Elegancia periodística y sobriedad corporativa (azul marino y cobalto).',
    primary: '#1E3A8A',
    secondary: '#0284C7',
    accent: '#F59E0B',
    bgMain: '#F8FAFC',
    bgCard: '#FFFFFF',
    textTitle: '#0F172A',
    textBody: '#334155',
    textMuted: '#64748B',
    border: '#E2E8F0',
  },
  'emerald-mint': {
    id: 'emerald-mint',
    name: 'Emerald Mint',
    description: 'Crecimiento, ecología y salud (esmeralda profunda y menta brillante).',
    primary: '#065F46',
    secondary: '#10B981',
    accent: '#FBBF24',
    bgMain: '#F0FDF4',
    bgCard: '#FFFFFF',
    textTitle: '#064E3B',
    textBody: '#166534',
    textMuted: '#047857',
    border: '#DCFCE7',
  },
  'sunset-amber': {
    id: 'sunset-amber',
    name: 'Sunset Amber',
    description: 'Dinamismo, finanzas y energía cálida (ámbar dorado y bronce).',
    primary: '#7C2D12',
    secondary: '#EA580C',
    accent: '#F59E0B',
    bgMain: '#FFFBEB',
    bgCard: '#FFFFFF',
    textTitle: '#451A03',
    textBody: '#78350F',
    textMuted: '#9A3412',
    border: '#FEF3C7',
  },
  'cyber-indigo': {
    id: 'cyber-indigo',
    name: 'Cyber Indigo',
    description: 'Vanguardia tecnológica, IA e investigación de software (índigo y cian).',
    primary: '#4338CA',
    secondary: '#8B5CF6',
    accent: '#06B6D4',
    bgMain: '#F5F3FF',
    bgCard: '#FFFFFF',
    textTitle: '#1E1B4B',
    textBody: '#3730A3',
    textMuted: '#6D28D9',
    border: '#EDE9FE',
  },
  'warm-earth': {
    id: 'warm-earth',
    name: 'Warm Earth',
    description: 'Tradición jurídica, archivos y humanidades (terracota, café y salvia).',
    primary: '#26211C',
    secondary: '#C85A32',
    accent: '#2E7D32',
    bgMain: '#FAF7F0',
    bgCard: '#FFFFFF',
    textTitle: '#26211C',
    textBody: '#4A3E31',
    textMuted: '#7D7060',
    border: '#E7DECE',
  },
  'crimson-velvet': {
    id: 'crimson-velvet',
    name: 'Crimson Velvet',
    description: 'Gestión de crisis, auditoría forense y alto impacto (borgoña y rubí).',
    primary: '#881337',
    secondary: '#E11D48',
    accent: '#F59E0B',
    bgMain: '#FFF1F2',
    bgCard: '#FFFFFF',
    textTitle: '#4C0519',
    textBody: '#831843',
    textMuted: '#9F1239',
    border: '#FFE4E6',
  },
};

export const THEME_KEYS: readonly ReportThemeId[] = [
  'editorial-navy',
  'emerald-mint',
  'sunset-amber',
  'cyber-indigo',
  'warm-earth',
  'crimson-velvet',
];

/**
 * Selecciona una paleta dinámica basada en una semilla (ej. id de mensaje o título)
 * para que diferentes reportes reciban automáticamente paletas diversas y estables.
 */
export function pickDynamicTheme(seed: string | number = 0): ReportTheme {
  let hash = 0;
  if (typeof seed === 'number') {
    hash = Math.abs(seed);
  } else {
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
  }
  const index = hash % THEME_KEYS.length;
  const key = THEME_KEYS[index] ?? 'editorial-navy';
  return REPORT_THEMES[key];
}

/** Genera el bloque de variables CSS para inyectar en el documento HTML. */
export function generateThemeCssVars(themeId: ReportThemeId): string {
  const theme = REPORT_THEMES[themeId] ?? REPORT_THEMES['editorial-navy'];
  return `:root {
  --primary: ${theme.primary};
  --secondary: ${theme.secondary};
  --accent: ${theme.accent};
  --bg-main: ${theme.bgMain};
  --bg-card: ${theme.bgCard};
  --text-title: ${theme.textTitle};
  --text-body: ${theme.textBody};
  --text-muted: ${theme.textMuted};
  --border: ${theme.border};
}`;
}

/** Extrae un fragmento o documento HTML de un texto con código Markdown. */
export function extractHtmlReport(text: string): string | null {
  if (typeof text !== 'string' || text.trim() === '') return null;

  // 1. Busca bloque ```html ... ```
  const codeBlockMatch = /```html\s*([\s\S]*?)\s*```/i.exec(text);
  if (codeBlockMatch && codeBlockMatch[1] && codeBlockMatch[1].trim() !== '') {
    return codeBlockMatch[1].trim();
  }

  // 2. Busca etiqueta <visual-report>...</visual-report>
  const tagMatch = /<visual-report>\s*([\s\S]*?)\s*<\/visual-report>/i.exec(text);
  if (tagMatch && tagMatch[1] && tagMatch[1].trim() !== '') {
    return tagMatch[1].trim();
  }

  // 3. Si el texto completo es un documento HTML directo
  if (/<!DOCTYPE\s+html|<html[\s>]/i.test(text)) {
    return text.trim();
  }

  return null;
}

/**
 * Prepara el HTML completo para ser renderizado dentro del iframe, asegurando
 * doctype, scripts permitidos de estilo, viewport responsivo y las variables de tema.
 */
export function prepareReportHtml(rawHtml: string, themeId: ReportThemeId): string {
  const cssVars = generateThemeCssVars(themeId);

  // Si ya tiene <html> y <head>, inyecta el estilo y variables en el <head>
  if (/<head[\s>]/i.test(rawHtml)) {
    const styleTag = `<style id="openher-theme">\n${cssVars}\nbody { background-color: var(--bg-main); color: var(--text-body); }\n</style>`;
    return rawHtml.replace(/<\/head>/i, `${styleTag}\n</head>`);
  }

  // Si es un fragmento sin boilerplate HTML, envuélvelo en una plantilla completa con Tailwind
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Informe Visual</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style id="openher-theme">
${cssVars}
    body {
      background-color: var(--bg-main);
      color: var(--text-body);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .report-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
    }
  </style>
</head>
<body class="p-6 md:p-10 min-h-screen antialiased">
  <div class="max-w-5xl mx-auto space-y-6">
    ${rawHtml}
  </div>
</body>
</html>`;
}
