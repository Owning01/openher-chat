import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code,
  Copy,
  Download,
  Eye,
  History,
  Moon,
  Pencil,
  RotateCcw,
  Save,
  Send,
  Sun,
} from '@/shared/icons';
import { Button, Dialog } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';
import { downloadTextFile } from '@/shared/utils/download';
import {
  prepareReportHtml,
  REPORT_THEMES,
  THEME_KEYS,
  type ReportThemeId,
} from '@/domain/visualReport/reportThemes';
import { useArtifactStore } from '../state/artifactStore';

export const QUICK_HTML_SUGGESTIONS = [
  '+ Agregar métricas clave',
  '+ Tabla comparativa',
  '+ Añadir filtros',
  '+ Botón de descarga',
] as const;

export type DialogTab = 'preview' | 'code' | 'history';

export interface VisualReportDialogProps {
  open: boolean;
  onClose: () => void;
  rawHtml: string;
  initialThemeId?: ReportThemeId;
  title?: string;
  messageId?: string;
  onRequestEdit?: (instruction: string, code: string) => void;
}

export function VisualReportDialog({
  open,
  onClose,
  rawHtml,
  initialThemeId = 'editorial-navy',
  title,
  messageId,
  onRequestEdit,
}: VisualReportDialogProps) {
  const [selectedTheme, setSelectedTheme] = useState<ReportThemeId>(initialThemeId);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<DialogTab>('preview');
  const [colorMode, setColorMode] = useState<'dark' | 'light'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );
  const [showEditBar, setShowEditBar] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Integración con el Artifact Store
  const artifactStoreKey = messageId ?? 'default-report';
  const getOrCreateArtifact = useArtifactStore((s) => s.getOrCreateArtifact);
  const updateArtifactWithHtml = useArtifactStore((s) => s.updateArtifactWithHtml);
  const restoreVersion = useArtifactStore((s) => s.restoreVersion);
  const previousRawHtml = useRef<string | null>(null);

  // Inicializa o sincroniza el artefacto cuando cambia la prop rawHtml externamente
  useEffect(() => {
    if (!open || !rawHtml) return;
    const existing = useArtifactStore.getState().artifacts[artifactStoreKey];
    if (!existing) {
      getOrCreateArtifact(artifactStoreKey, rawHtml, title);
      previousRawHtml.current = rawHtml;
    } else if (previousRawHtml.current !== null && previousRawHtml.current !== rawHtml) {
      updateArtifactWithHtml(artifactStoreKey, rawHtml, 'agent-rewrite');
      previousRawHtml.current = rawHtml;
    } else if (previousRawHtml.current === null) {
      previousRawHtml.current = rawHtml;
    }
  }, [open, rawHtml, artifactStoreKey, title, getOrCreateArtifact, updateArtifactWithHtml]);

  const currentArtifact = useArtifactStore((s) => s.artifacts[artifactStoreKey]);
  const activeHtml = currentArtifact?.activeHtml ?? rawHtml;
  const versions = currentArtifact?.versions ?? [
    { version: 1, html: rawHtml, timestamp: Date.now(), source: 'initial' as const },
  ];
  const currentVersionNum = currentArtifact?.currentVersion ?? 1;

  // Estado local para el editor de código
  const [editableCode, setEditableCode] = useState(activeHtml);
  useEffect(() => {
    setEditableCode(activeHtml);
  }, [activeHtml]);

  const preparedHtml = useMemo(() => {
    return prepareReportHtml(activeHtml, selectedTheme, colorMode);
  }, [activeHtml, selectedTheme, colorMode]);

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
    const filename = `informe-visual-v${currentVersionNum}-${selectedTheme}-${Date.now().toString(36)}.html`;
    downloadTextFile(filename, preparedHtml, 'text/html');
  };

  const handleToggleColorMode = () => {
    setColorMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleSendEdit = () => {
    const trimmed = editPrompt.trim();
    if (!trimmed || !onRequestEdit) return;
    onRequestEdit(trimmed, activeHtml);
    setEditPrompt('');
    setShowEditBar(false);
    onClose();
  };

  const handleSaveCode = () => {
    updateArtifactWithHtml(artifactStoreKey, editableCode, 'user-edit', 'Edición manual de código');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleRestoreVersion = (verNum: number) => {
    restoreVersion(artifactStoreKey, verNum);
    setActiveTab('preview');
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
      <div className="flex flex-col flex-1 min-h-0 h-full w-full gap-2.5" data-testid="visual-report-dialog">
        {/* Controles de barra superior */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
          {/* Selector de Pestañas (Visual / Código / Historial) */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-subtle p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              data-testid="visual-report-tab-preview"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all',
                activeTab === 'preview'
                  ? 'bg-surface text-primary shadow-xs'
                  : 'text-muted hover:text-text',
              )}
            >
              <Eye className="size-3.5" />
              <span>Vista previa</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('code')}
              data-testid="visual-report-tab-code"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all',
                activeTab === 'code'
                  ? 'bg-surface text-primary shadow-xs'
                  : 'text-muted hover:text-text',
              )}
            >
              <Code className="size-3.5" />
              <span>Código</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              data-testid="visual-report-tab-history"
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all',
                activeTab === 'history'
                  ? 'bg-surface text-primary shadow-xs'
                  : 'text-muted hover:text-text',
              )}
            >
              <History className="size-3.5" />
              <span>Historial</span>
              <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.2 text-[10px] text-primary font-bold">
                v{currentVersionNum}
              </span>
            </button>
          </div>

          {/* Selector de Paletas Temáticas (visible en preview) */}
          {activeTab === 'preview' ? (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="text-[11.5px] font-semibold text-muted mr-1">Paleta:</span>
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
                      'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium transition-all border',
                      isSelected
                        ? 'border-primary bg-primary-soft text-primary ring-1 ring-primary'
                        : 'border-border bg-surface text-muted hover:text-text hover:border-border-hover',
                    )}
                  >
                    <span
                      className="size-2.5 rounded-full shrink-0 border border-black/10"
                      style={{ backgroundColor: theme.primary }}
                    />
                    <span>{theme.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Acciones del visualizador */}
          <div className="flex items-center gap-1.5 ml-auto">
            {activeTab === 'preview' ? (
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
            ) : null}

            {onRequestEdit ? (
              <Button
                size="sm"
                variant={showEditBar ? 'primary' : 'secondary'}
                icon={<Pencil className="size-3.5" />}
                onClick={() => setShowEditBar((prev) => !prev)}
                data-testid="visual-report-edit-toggle"
              >
                Pedir cambios
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
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface-subtle p-3 animate-in fade-in-50 duration-150"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendEdit();
                }}
                placeholder="¿Qué deseas agregar o modificar quirúrgicamente en este HTML?..."
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
              <span className="text-[11px] font-medium text-muted">Sugerencias rápidas:</span>
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

        {/* CONTENIDO PRINCIPAL POR PESTAÑA */}
        {activeTab === 'preview' ? (
          /* Viewport del iframe para el informe */
          <div className="relative flex-1 min-h-[450px] w-full h-full rounded-xl overflow-hidden border border-border bg-white dark:bg-[#09090b] shadow-inner">
            <iframe
              data-testid="visual-report-iframe"
              title="Informe Visual"
              srcDoc={preparedHtml}
              sandbox="allow-scripts allow-same-origin"
              className="w-full h-full min-h-full border-none block"
            />
          </div>
        ) : activeTab === 'code' ? (
          /* Editor de Código integrado */
          <div className="relative flex flex-col flex-1 min-h-[450px] w-full h-full rounded-xl overflow-hidden border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-3 py-2 text-xs">
              <span className="font-mono text-muted">
                HTML Activo (v{currentVersionNum}) · {editableCode.split('\n').length} líneas
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  icon={saveSuccess ? <Check className="size-3.5 text-success" /> : <Save className="size-3.5" />}
                  onClick={handleSaveCode}
                  data-testid="visual-report-save-code"
                >
                  {saveSuccess ? 'Guardado como nueva versión' : 'Aplicar cambios'}
                </Button>
              </div>
            </div>
            <textarea
              value={editableCode}
              onChange={(e) => setEditableCode(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  handleSaveCode();
                }
              }}
              data-testid="visual-report-code-editor"
              spellCheck={false}
              className="flex-1 w-full p-4 font-mono text-xs leading-relaxed text-text bg-surface resize-none focus:outline-none"
            />
          </div>
        ) : (
          /* Historial de Versiones */
          <div
            data-testid="visual-report-history-view"
            className="flex flex-col flex-1 min-h-[450px] w-full h-full rounded-xl overflow-y-auto border border-border bg-surface p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-sm font-semibold text-text">Historial de Versiones del Artefacto</h3>
              <span className="text-xs text-muted">{versions.length} versiones registradas</span>
            </div>
            <div className="space-y-2">
              {versions.map((ver) => {
                const isCurrent = ver.version === currentVersionNum;
                return (
                  <div
                    key={ver.version}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border transition-all',
                      isCurrent
                        ? 'border-primary/50 bg-primary/5 shadow-xs'
                        : 'border-border bg-surface-subtle hover:border-border-hover',
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-text">Versión {ver.version}</span>
                        {isCurrent ? (
                          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                            Actual
                          </span>
                        ) : null}
                        <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted capitalize">
                          {ver.source === 'initial'
                            ? 'Inicial'
                            : ver.source === 'user-edit'
                              ? 'Edición manual'
                              : ver.source === 'agent-patch'
                                ? 'Parche quirúrgico'
                                : 'Regeneración'}
                        </span>
                      </div>
                      <p className="text-xs text-muted">{ver.summary ?? 'Sin descripción'}</p>
                      <span className="text-[10px] text-muted/70">
                        {new Date(ver.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isCurrent ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<RotateCcw className="size-3" />}
                          data-testid={`restore-version-${ver.version}`}
                          onClick={() => handleRestoreVersion(ver.version)}
                        >
                          Restaurar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
