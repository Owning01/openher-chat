import { useMemo } from 'react';

import type { SourceRef } from '@/domain/types/chat';
import { useT } from '@/i18n/useT';
import { Badge } from '@/shared/ui';
import { cn } from '@/shared/utils/cn';

import { SourceChip } from './SourceChip';
import { canonicalSourceKey, dedupeSources } from './selectors';

export interface SourcesListProps {
  sources: SourceRef[];
  title?: string;
  className?: string;
  /** Clases del área de items: permite fijar su altura y darle scroll propio. */
  listClassName?: string;
}

/** Fuentes deduplicadas por URL; numeradas para mapear las citas `[n]` del modelo. */
export function SourcesList({ sources, title, className, listClassName }: SourcesListProps) {
  const t = useT();
  const unique = useMemo(() => dedupeSources(sources), [sources]);

  if (unique.length === 0 && title === undefined) return null;

  return (
    <section data-testid="research-sources" className={cn('space-y-2', className)}>
      {title !== undefined ? (
        <h3 className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className="flex-1">{title}</span>
          <Badge variant="neutral">{t('research.sourceCount', { count: unique.length })}</Badge>
        </h3>
      ) : null}
      <div className={cn(listClassName)}>
        {unique.length === 0 ? (
          <p className="text-xs text-muted">{t('research.sourcesEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {unique.map((source, index) => (
              <li key={canonicalSourceKey(source.url)} className="min-w-0">
                <SourceChip source={source} index={index + 1} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
