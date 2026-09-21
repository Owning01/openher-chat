import { useMemo, useState } from 'react';
import { Check, Copy, Download, Moon, Pencil, Send, Sun } from '@/shared/icons';
import { Button, Dialog } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';
import { downloadTextFile } from '@/shared/utils/download';
import {
  prepareReportHtml,
  REPORT_THEMES,
  THEME_KEYS,
  type ReportThemeId,
} from '@/domain/visualReport/reportThemes';

export const QUICK_HTML_SUGGESTIONS = [
  '+ Agregar métricas clave',
  '+ Tabla comparativa',
  '+ Añadir filtros',
  '+ Botón de descarga',
] as const;

export interface VisualReportDialogProps {
  open: boolean;
  onClose: () => void;
  rawHtml: string;
  initialThemeId?: ReportThemeId;
  title?: string;
  onRequestEdit?: (instruction: string, code: string) => void;
}

export function VisualReportDialog({
  open,
  onClose,
  rawHtml,
  initialThemeId = 'editorial-navy',
  title,
  onRequestEdit,
}: VisualReportDialogProps) {
  const [selectedTheme, setSelectedTheme] = useState<ReportThemeId>(initialThemeId);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [colorMode, setColorMode] = useState<'dark' | 'light'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );
  const [showEditBar, setShowEditBar] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');

  const preparedHtml = useMemo(() => {
    return prepareReportHtml(rawHtml, selectedTheme, colorMode);
  }, [rawHtml, selectedTheme, colorMode]);

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

  const handleToggleColorMode = () => {
    setColorMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleSendEdit = () => {
    const trimmed = editPrompt.trim();
    if (!trimmed || !onRequestEdit) return;
    onRequestEdit(trimmed, rawHtml);
    setEditPrompt('');
    setShowEditBar(false);
    onClose();
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
            {/* Switch Modo Claro / Oscuro interno */}
            <Button
              size="sm"
              variant="ghost"
              icon={colorMode === 'dark' ? <Sun className="size-3.5 text-warning" /> : <Moon className="size-3.5" />}
              onClick={handleToggleColorMode}
              title={colorMode === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              data-testid="visual-report-colormode"
            >
              {colorMode === 'dark' ? 'Claro' : 'Oscuro'}
            </Button>

            {onRequestEdit ? (
              <Button
                size="sm"
                variant={showEditBar ? 'primary' : 'secondary'}
                icon={<Pencil className="size-3.5" />}
                onClick={() => setShowEditBar((prev) => !prev)}
                data-testid="visual-report-edit-toggle"
              >
                Modificar
              </Button>
            ) : null}

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

        {/* Barra interactiva de solicitud de modificaciones */}
        {showEditBar && onRequestEdit ? (
          <div
            data-testid="visual-report-edit-bar"
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface-subtle p-3"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendEdit();
                }}
                placeholder="¿Qué deseas agregar o modificar en este HTML? (ej: 'agrega una tabla comparativa')..."
                data-testid="visual-report-edit-input"
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text placeholder:text-muted focus:border-primary focus:outline-none"
                autoFocus
              />
              <Button
                size="sm"
                variant="primary"
                onClick={handleSendEdit}
                disabled={!editPrompt.trim()}
                icon={<Send className="size-3.5" />}
                data-testid="visual-report-edit-send"
              >
                Pedir cambios
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted">Sugerencias:</span>
              {QUICK_HTML_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setEditPrompt(sug.replace(/^\+\s*/, ''))}
                  className="rounded-md border border-border/60 bg-surface px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-border hover:text-text"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Viewport del iframe para el informe */}
        <div className="relative flex-1 min-h-[450px] w-full h-full rounded-xl overflow-hidden border border-border bg-white dark:bg-[#09090b] shadow-inner">
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
