import hljs from 'highlight.js/lib/common';
import { useMemo } from 'react';

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
  onExpand?: (code: string) => void;
}

export function CodeBlock({ code, language, className, streaming = false, onExpand }: CodeBlockProps) {
  const resolvedLanguage = resolveLanguage(language);

  if (resolvedLanguage === 'html' || resolvedLanguage === 'htm' || resolvedLanguage === 'svg') {
    return (
      <LiveHtmlArtifact
        code={code}
        language={resolvedLanguage}
        className={className}
        streaming={streaming}
        onExpand={onExpand}
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
