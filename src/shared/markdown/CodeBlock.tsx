import hljs from 'highlight.js/lib/common';
import { useMemo } from 'react';

import { cn } from '@/shared/utils/cn';

import { CopyButton } from './CopyButton';
import './highlight.css';

export const PLAIN_TEXT_LANGUAGE = 'text';

export interface CodeBlockProps {
  code: string;
  language?: string | null;
  className?: string;
}

export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const resolvedLanguage = resolveLanguage(language);
  const highlighted = useMemo(
    () =>
      resolvedLanguage === PLAIN_TEXT_LANGUAGE
        ? null
        : hljs.highlight(code, { language: resolvedLanguage, ignoreIllegals: true }).value,
    [code, resolvedLanguage],
  );

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
