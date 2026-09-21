import { useMemo, useState } from 'react';
import { Check, Copy, Download } from '@/shared/icons';
import { Button, Dialog } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';
import { downloadTextFile } from '@/shared/utils/download';
import {
  prepareReportHtml,
  REPORT_THEMES,
  THEME_KEYS,
  type ReportThemeId,
} from '@/domain/visualReport/reportThemes';

export interface VisualReportDialogProps {
  open: boolean;
  onClose: () => void;
  rawHtml: string;
  initialThemeId?: ReportThemeId;
  title?: string;
}

export function VisualReportDialog({
  open,
  onClose,
  rawHtml,
  initialThemeId = 'editorial-navy',
  title,
}: VisualReportDialogProps) {
  const [selectedTheme, setSelectedTheme] = useState<ReportThemeId>(initialThemeId);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const preparedHtml = useMemo(() => {
    return prepareReportHtml(rawHtml, selectedTheme);
  }, [rawHtml, selectedTheme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(preparedHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownload = () => {
    const filename = `informe-visual-${selectedTheme}-${Date.now().toString(36)}.html`;
    downloadTextFile(filename, preparedHtml, 'text/html');
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? 'Informe Visual Interactivo'}
      className={cn(
        'flex flex-col transition-all duration-200',
        isFullscreen
          ? 'w-[98vw] h-[96vh] max-w-none p-2'
          : 'w-[94vw] max-w-6xl h-[88vh] p-4',
      )}
    >
      <div className="flex flex-col flex-1 min-h-0 h-full w-full gap-3" data-testid="visual-report-dialog">
        {/* Controles de barra superior */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
          {/* Selector de Paletas Temáticas */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <span className="text-xs font-semibold text-muted mr-1">Paleta:</span>
            {THEME_KEYS.map((themeKey) => {
              const theme = REPORT_THEMES[themeKey];
              const isSelected = selectedTheme === themeKey;
              return (
                <button
                  key={themeKey}
                  type="button"
                  onClick={() => setSelectedTheme(themeKey)}
                  title={`${theme.name}: ${theme.description}`}
                  aria-pressed={isSelected}
                  data-testid={`theme-select-${themeKey}`}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border',
                    isSelected
                      ? 'border-primary bg-primary-soft text-primary ring-1 ring-primary'
                      : 'border-border bg-surface text-muted hover:text-text hover:border-border-hover',
                  )}
                >
                  <span
                    className="size-3 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: theme.primary }}
                  />
                  <span>{theme.name}</span>
                </button>
              );
            })}
          </div>

          {/* Acciones del visualizador */}
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              onClick={handleCopy}
              data-testid="visual-report-copy"
            >
              {copied ? 'Copiado' : 'Copiar HTML'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Download className="size-3.5" />}
              onClick={handleDownload}
              data-testid="visual-report-download"
            >
              Descargar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsFullscreen((prev) => !prev)}
              data-testid="visual-report-fullscreen"
            >
              {isFullscreen ? 'Ventana' : 'Pantalla Completa'}
            </Button>
          </div>
        </div>

        {/* Viewport del iframe para el informe */}
        <div className="relative flex-1 min-h-[450px] w-full h-full rounded-xl overflow-hidden border border-border bg-white shadow-inner">
          <iframe
            data-testid="visual-report-iframe"
            title="Informe Visual"
            srcDoc={preparedHtml}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full min-h-full border-none block"
          />
        </div>
      </div>
    </Dialog>
  );
}
