import { useId } from 'react';
import type { ReactNode } from 'react';

export interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ title, description, icon, actions, children }: SectionCardProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-border bg-surface">
      <header className="flex items-start gap-3 border-b border-border-subtle p-4">
        {icon !== undefined ? <span className="mt-0.5 text-muted">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold text-text">
            {title}
          </h2>
          {description !== undefined ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}
