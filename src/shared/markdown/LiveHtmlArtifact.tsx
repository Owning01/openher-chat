import hljs from 'highlight.js/lib/common';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReportThemeId } from '@/domain/visualReport/reportThemes';
import {
  extractReportTitle,
  pickDynamicTheme,
  prepareStreamingReportHtml,
} from '@/domain/visualReport/reportThemes';
import { useT } from '@/i18n/useT';
import { Check, Code as CodeIcon, Copy, Eye, Maximize2, Sparkles } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export const STREAMING_LIVE_THROTTLE_MS = 120;
export const MAX_HIGHLIGHT_LENGTH = 100_000;

export interface LiveHtmlArtifactProps {
  code: string;
  language?: string | null;
  streaming?: boolean;
  className?: string;
  onExpand?: (code: string) => void;
  title?: string;
  themeId?: ReportThemeId;
}

export function LiveHtmlArtifact({
  code,
  streaming = false,
  className,
  onExpand,
  title,
  themeId,
}: LiveHtmlArtifactProps) {
  const t = useT();
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);

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
    prepareStreamingReportHtml(code, resolvedThemeId),
  );

  useEffect(() => {
    if (!streaming) {
      setRenderedHtml(prepareStreamingReportHtml(code, resolvedThemeId));
      return;
    }

    const timer = setTimeout(() => {
      setRenderedHtml(prepareStreamingReportHtml(code, resolvedThemeId));
    }, STREAMING_LIVE_THROTTLE_MS);

    return () => clearTimeout(timer);
  }, [code, streaming, resolvedThemeId]);

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
        <div className="flex items-center gap-2 min-w-0 max-w-[60%] sm:max-w-md">
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
        <div className="flex items-center gap-1 sm:gap-2">
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

      {/* Contenido según pestaña */}
      {viewMode === 'preview' ? (
        <div className="relative h-[400px] sm:h-[480px] w-full overflow-hidden bg-white">
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
