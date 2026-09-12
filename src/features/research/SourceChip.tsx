import type { SourceRef } from '@/domain/types/chat';
import { useT } from '@/i18n/useT';
import { ExternalLink, Globe } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export interface SourceChipProps {
  source: SourceRef;
  index?: number;
  className?: string;
}

const CHIP_CLASSES =
  'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-text transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/** Fuente clicable: título + host, abre la URL en pestaña nueva solo si es http(s). */
export function SourceChip({ source, index, className }: SourceChipProps) {
  const t = useT();
  const title = source.title.trim() === '' ? source.url : source.title.trim();
  const host = hostnameOf(source.url);
  const href = safeExternalHref(source.url);

  const content = (
    <>
      {index === undefined ? (
        <Globe aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
      ) : (
        <span aria-hidden="true" className="shrink-0 font-mono text-muted">
          {index}
        </span>
      )}
      <span className="min-w-0 truncate">{title}</span>
      {host !== null ? <span className="shrink-0 text-muted">{host}</span> : null}
      {href !== null ? <ExternalLink aria-hidden="true" className="size-3 shrink-0 text-muted" /> : null}
    </>
  );

  if (href === null) {
    return (
      <span data-testid="research-source-chip" title={source.url} className={cn(CHIP_CLASSES, className)}>
        {content}
      </span>
    );
  }

  return (
    <a
      data-testid="research-source-chip"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={source.url}
      aria-label={t('research.sourceLinkLabel', { title })}
      className={cn(CHIP_CLASSES, className)}
    >
      {content}
    </a>
  );
}

/** Allowlist de esquemas: solo URLs absolutas http(s) se convierten en enlace. */
function safeExternalHref(url: string): string | null {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname === '' ? null : hostname;
  } catch {
    return null;
  }
}
