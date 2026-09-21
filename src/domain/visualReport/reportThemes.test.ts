import { describe, expect, it } from 'vitest';
import {
  extractHtmlReport,
  generateThemeCssVars,
  pickDynamicTheme,
  prepareReportHtml,
  REPORT_THEMES,
  THEME_KEYS,
} from './reportThemes';

describe('reportThemes', () => {
  it('contiene 6 paletas temáticas con colores válidos', () => {
    expect(THEME_KEYS.length).toBe(6);
    for (const key of THEME_KEYS) {
      const theme = REPORT_THEMES[key];
      expect(theme).toBeDefined();
      expect(theme.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.bgMain).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('pickDynamicTheme distribuye determinísticamente diferentes semillas', () => {
    const t1 = pickDynamicTheme('msg-report-1');
    const t2 = pickDynamicTheme('msg-report-2');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    // Verifica que ante la misma semilla devuelva la misma paleta
    expect(pickDynamicTheme('msg-report-1').id).toBe(t1.id);
  });

  it('generateThemeCssVars genera variables CSS correctas', () => {
    const vars = generateThemeCssVars('emerald-mint');
    expect(vars).toContain('--primary: #065F46');
    expect(vars).toContain('--bg-main: #F0FDF4');
  });

  it('extractHtmlReport extrae bloques html Markdown, tags visual-report y HTML directo', () => {
    const fromMarkdown = 'Aquí está el análisis:\n```html\n<div class="card">Resumen</div>\n```\nFin.';
    expect(extractHtmlReport(fromMarkdown)).toBe('<div class="card">Resumen</div>');

    const fromTag = 'Reporte:\n<visual-report>\n<section>Métricas</section>\n</visual-report>';
    expect(extractHtmlReport(fromTag)).toBe('<section>Métricas</section>');

    const directHtml = '<!DOCTYPE html><html><body>Directo</body></html>';
    expect(extractHtmlReport(directHtml)).toBe(directHtml);

    expect(extractHtmlReport('Solo texto sin html')).toBeNull();
  });

  it('prepareReportHtml inyecta tema y estilos en fragmentos y documentos completos', () => {
    const fragment = '<div class="metric">42%</div>';
    const preparedFragment = prepareReportHtml(fragment, 'cyber-indigo');
    expect(preparedFragment).toContain('<!DOCTYPE html>');
    expect(preparedFragment).toContain('--primary: #4338CA');
    expect(preparedFragment).toContain('<div class="metric">42%</div>');

    const fullDoc = '<!DOCTYPE html><html><head><title>Test</title></head><body>Hola</body></html>';
    const preparedFull = prepareReportHtml(fullDoc, 'sunset-amber');
    expect(preparedFull).toContain('--primary: #7C2D12');
    expect(preparedFull).toContain('</head>');
  });
});
