import hljs from 'highlight.js/lib/common';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReportThemeId } from '@/domain/visualReport/reportThemes';
import {
  extractReportTitle,
  pickDynamicTheme,
  prepareStreamingReportHtml,
} from '@/domain/visualReport/reportThemes';
import { useT } from '@/i18n/useT';
import {
  Check,
  Code as CodeIcon,
  Copy,
  Eye,
  Maximize2,
  Moon,
  Pencil,
  Send,
  Sparkles,
  Sun,
} from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export const STREAMING_LIVE_THROTTLE_MS = 120;
export const MAX_HIGHLIGHT_LENGTH = 100_000;

export const QUICK_HTML_SUGGESTIONS = [
  '+ Agregar métricas clave',
  '+ Tabla comparativa',
  '+ Añadir filtros',
  '+ Botón de descarga',
] as const;

export interface LiveHtmlArtifactProps {
  code: string;
  language?: string | null;
  streaming?: boolean;
  className?: string;
  onExpand?: (code: string) => void;
  onRequestEdit?: (instruction: string, code: string) => void;
  title?: string;
  themeId?: ReportThemeId;
}

export function LiveHtmlArtifact({
  code,
  streaming = false,
  className,
  onExpand,
  onRequestEdit,
  title,
  themeId,
}: LiveHtmlArtifactProps) {
  const t = useT();
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [colorMode, setColorMode] = useState<'dark' | 'light'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );
  const [showEditBar, setShowEditBar] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');

  // Paleta temática para el artefacto (estable a partir del contenido o provista)
  const resolvedThemeId = useMemo(() => {
    if (themeId) return themeId;
    return pickDynamicTheme(code.slice(0, 50)).id;
  }, [themeId, code]);

  // Título extraído del HTML o predeterminado
  const displayTitle = useMemo(() => {
    if (title && title.trim()) return title;
    const extracted = extractReportTitle(code);
    if (extracted) return extracted;
    return t('chat.interactiveHtml');
  }, [title, code, t]);

  // HTML progresivo para el iframe
  const [renderedHtml, setRenderedHtml] = useState(() =>
    prepareStreamingReportHtml(code, resolvedThemeId, colorMode),
  );

  useEffect(() => {
    if (!streaming) {
      setRenderedHtml(prepareStreamingReportHtml(code, resolvedThemeId, colorMode));
      return;
    }

    const timer = setTimeout(() => {
      setRenderedHtml(prepareStreamingReportHtml(code, resolvedThemeId, colorMode));
    }, STREAMING_LIVE_THROTTLE_MS);

    return () => clearTimeout(timer);
  }, [code, streaming, resolvedThemeId, colorMode]);

  // Resaltado de sintaxis para la pestaña de código
  const highlightedCode = useMemo(() => {
    if (viewMode !== 'code') return null;
    if (code.length > MAX_HIGHLIGHT_LENGTH) return null;
    return hljs.highlight(code, { language: 'html', ignoreIllegals: true }).value;
  }, [code, viewMode]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignorar fallback
    }
  }, [code]);

  const handleToggleColorMode = useCallback(() => {
    setColorMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleSendEdit = useCallback(() => {
    const trimmed = editPrompt.trim();
    if (!trimmed || !onRequestEdit) return;
    onRequestEdit(trimmed, code);
    setEditPrompt('');
    setShowEditBar(false);
  }, [editPrompt, onRequestEdit, code]);

  return (
    <div
      data-testid="live-html-artifact"
      data-streaming={streaming ? 'true' : 'false'}
      className={cn(
        'my-3 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow',
        className,
      )}
    >
      {/* Barra superior estilo Claude Artifacts */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-2">
        {/* Lado izquierdo: icono y título */}
        <div className="flex items-center gap-2 min-w-0 max-w-[50%] sm:max-w-md">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span
            className="truncate text-xs font-semibold text-text"
            title={displayTitle}
            data-testid="live-artifact-title"
          >
            {displayTitle}
          </span>
          {streaming ? (
            <span
              data-testid="live-drawing-badge"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span>{t('chat.liveDrawing')}</span>
            </span>
          ) : null}
        </div>

        {/* Lado derecho: selector de pestañas y botones de acción */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Segmented Control: Vista previa / Código */}
          <div
            role="tablist"
            aria-label="Modo de visualización"
            className="flex items-center rounded-lg bg-black/5 p-0.5 dark:bg-white/5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'preview'}
              onClick={() => setViewMode('preview')}
              data-testid="live-artifact-tab-preview"
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'preview'
                  ? 'bg-surface text-text shadow-xs'
                  : 'text-muted hover:text-text',
              )}
            >
              <Eye className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('chat.preview')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'code'}
              onClick={() => setViewMode('code')}
              data-testid="live-artifact-tab-code"
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'code'
                  ? 'bg-surface text-text shadow-xs'
                  : 'text-muted hover:text-text',
              )}
            >
              <CodeIcon className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('chat.codeTab')}</span>
            </button>
          </div>

          {/* Switch de modo Claro / Oscuro interno */}
          <button
            type="button"
            onClick={handleToggleColorMode}
            title={colorMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-label={colorMode === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            data-testid="live-artifact-colormode-toggle"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
          >
            {colorMode === 'dark' ? (
              <Sun className="size-3.5 text-warning" aria-hidden="true" />
            ) : (
              <Moon className="size-3.5" aria-hidden="true" />
            )}
          </button>

          {/* Botón de solicitar modificaciones */}
          {onRequestEdit ? (
            <button
              type="button"
              onClick={() => setShowEditBar((prev) => !prev)}
              title="Pedir cambios o agregar elementos"
              aria-label="Pedir cambios"
              data-testid="live-artifact-edit-toggle"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                showEditBar
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted hover:bg-surface hover:text-text',
              )}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Modificar</span>
            </button>
          ) : null}

          {/* Botón de copiar */}
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? t('chat.copied') : t('chat.copy')}
            aria-label={copied ? t('chat.copied') : t('chat.copy')}
            data-testid="live-artifact-copy"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
          >
            {copied ? (
              <Check className="size-3.5 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
          </button>

          {/* Botón de pantalla completa / expandir */}
          {onExpand ? (
            <button
              type="button"
              onClick={() => onExpand(code)}
              title={t('chat.fullscreen')}
              aria-label={t('chat.fullscreen')}
              data-testid="live-artifact-expand"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
            >
              <Maximize2 className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Barra interactiva de solicitud de modificaciones */}
      {showEditBar && onRequestEdit ? (
        <div
          data-testid="live-artifact-edit-bar"
          className="flex flex-col gap-2 border-b border-border bg-surface-subtle/70 p-3"
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
              data-testid="live-artifact-edit-input"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text placeholder:text-muted focus:border-primary focus:outline-none"
              autoFocus
            />
            <button
              type="button"
              onClick={handleSendEdit}
              disabled={!editPrompt.trim()}
              data-testid="live-artifact-edit-send"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="size-3" aria-hidden="true" />
              <span>Pedir cambios</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted">Sugerencias:</span>
            {QUICK_HTML_SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setEditPrompt(sug.replace(/^\+\s*/, ''))}
                className="rounded-md border border-border/60 bg-surface px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-border hover:text-text"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Contenido según pestaña */}
      {viewMode === 'preview' ? (
        <div className="relative h-[400px] sm:h-[480px] w-full overflow-hidden bg-white dark:bg-[#09090b]">
          <iframe
            data-testid="live-artifact-iframe"
            title={displayTitle}
            srcDoc={renderedHtml}
            sandbox="allow-scripts allow-same-origin"
            className="size-full border-none block"
          />
        </div>
      ) : (
        <pre
          data-testid="live-artifact-code-pre"
          className="max-h-[480px] overflow-auto p-3 text-xs leading-relaxed bg-surface"
        >
          {highlightedCode === null ? (
            <code className="font-mono text-text">{code}</code>
          ) : (
            <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          )}
        </pre>
      )}
    </div>
  );
}
