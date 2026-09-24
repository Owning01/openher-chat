import hljs from 'highlight.js/lib/common';
import { useMemo, useState } from 'react';

import { extractReportTitle } from '@/domain/visualReport/reportThemes';
import { useT } from '@/i18n/useT';
import { Eye, FileText, Maximize2 } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

import { CopyButton } from './CopyButton';
import { LiveHtmlArtifact } from './LiveHtmlArtifact';
import './highlight.css';

export const PLAIN_TEXT_LANGUAGE = 'text';

/**
 * Bloques gigantes: highlight.js es O(bloque) por pasada y el streaming lo
 * re-ejecuta por token (O(n²) total). Dos guardas:
 * - en streaming, bloques de más de 4k se ven monoespaciados hasta completar;
 * - bloques de más de 100k nunca se colorean (pegar un bundle no cuelga la pestaña).
 */
export const STREAMING_HIGHLIGHT_LIMIT = 4000;
export const MAX_HIGHLIGHT_LENGTH = 100_000;

export interface CodeBlockProps {
  code: string;
  language?: string | null;
  className?: string;
  /** El código aún está llegando: difiere el highlight pesado. */
  streaming?: boolean;
  /**
   * Si es false, este bloque pertenece a un mensaje anterior y se colapsa
   * de forma compacta para evitar acumular múltiples iframes activos.
   */
  isLatestArtifact?: boolean;
  onExpand?: (code: string) => void;
  onRequestEdit?: (instruction: string, code: string) => void;
}

export function CodeBlock({
  code,
  language,
  className,
  streaming = false,
  isLatestArtifact = true,
  onExpand,
  onRequestEdit,
}: CodeBlockProps) {
  const t = useT();
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const resolvedLanguage = resolveLanguage(language);

  if (resolvedLanguage === 'html' || resolvedLanguage === 'htm' || resolvedLanguage === 'svg') {
    const displayTitle = extractReportTitle(code) || t('chat.interactiveHtml');

    // Si no es el artefacto más reciente y el usuario no lo expandió manualmente,
    // se muestra una tarjeta compacta para no saturar el feed con iframes pesados.
    if (!isLatestArtifact && !isManuallyExpanded) {
      return (
        <div
          data-testid="collapsed-html-artifact"
          className={cn(
            'my-2 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/70 bg-surface/80 p-2.5 sm:px-3.5 sm:py-2 text-xs shadow-2xs transition-all hover:border-border hover:bg-surface',
            className,
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/15 text-muted">
              <FileText className="size-3.5" aria-hidden="true" />
            </span>
            <span className="truncate font-medium text-text">
              {displayTitle}
            </span>
            <span className="shrink-0 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-medium text-muted">
              {t('chat.previousVersion')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              type="button"
              onClick={() => setIsManuallyExpanded(true)}
              data-testid="expand-collapsed-artifact"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-subtle hover:text-text transition-colors cursor-pointer"
            >
              <Eye className="size-3" aria-hidden="true" />
              <span>{t('chat.showPreview')}</span>
            </button>
            {onExpand ? (
              <button
                type="button"
                onClick={() => onExpand(code)}
                data-testid="fullscreen-collapsed-artifact"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface-subtle hover:text-text transition-colors cursor-pointer"
                title={t('chat.fullscreen')}
              >
                <Maximize2 className="size-3" aria-hidden="true" />
                <span className="hidden sm:inline">{t('chat.fullscreen')}</span>
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    if (!isLatestArtifact && isManuallyExpanded) {
      return (
        <div className="my-2 space-y-1.5">
          <div className="flex items-center justify-between px-1 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-text">{displayTitle}</span>
              <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-medium text-muted">
                {t('chat.previousVersion')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsManuallyExpanded(false)}
              data-testid="collapse-artifact-btn"
              className="text-xs text-primary hover:underline cursor-pointer"
            >
              {t('chat.hidePreview')}
            </button>
          </div>
          <LiveHtmlArtifact
            code={code}
            language={resolvedLanguage}
            className={className}
            streaming={streaming}
            onExpand={onExpand}
            onRequestEdit={onRequestEdit}
          />
        </div>
      );
    }

    return (
      <LiveHtmlArtifact
        code={code}
        language={resolvedLanguage}
        className={className}
        streaming={streaming}
        onExpand={onExpand}
        onRequestEdit={onRequestEdit}
      />
    );
  }

  const highlighted = useMemo(() => {
    if (resolvedLanguage === PLAIN_TEXT_LANGUAGE) return null;
    if (code.length > MAX_HIGHLIGHT_LENGTH) return null;
    if (streaming && code.length > STREAMING_HIGHLIGHT_LIMIT) return null;
    return hljs.highlight(code, { language: resolvedLanguage, ignoreIllegals: true }).value;
  }, [code, resolvedLanguage, streaming]);

  return (
    <div
      data-testid="code-block"
      className={cn('my-2 overflow-hidden rounded-lg border border-border bg-surface', className)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-1">
        <span className="font-mono text-xs text-muted" data-testid="code-language">
          {resolvedLanguage}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        {highlighted === null ? (
          <code className="font-mono text-text">{code}</code>
        ) : (
          // highlight.js escapa el código antes de envolverlo en spans.
          <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: highlighted }} />
        )}
      </pre>
    </div>
  );
}

function resolveLanguage(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? '';
  if (normalized === '') return PLAIN_TEXT_LANGUAGE;
  return hljs.getLanguage(normalized) === undefined ? PLAIN_TEXT_LANGUAGE : normalized;
}
