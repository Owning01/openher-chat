import MarkdownBase from 'react-markdown';
import type { Components, ExtraProps } from 'react-markdown';
import { useMemo } from 'react';
import remarkGfm from 'remark-gfm';

import { cn } from '@/shared/utils/cn';

import { CodeBlock } from './CodeBlock';

type HastNode = ExtraProps['node'];

export interface MarkdownProps {
  children: string;
  className?: string;
  /**
   * El bloque que aún está llegando: difiere el highlight pesado hasta que
   * complete (ver `CodeBlock`). Sólo lo usa el último bloque en streaming.
   */
  streaming?: boolean;
  /** Callback para abrir el reporte visual / artefacto HTML a pantalla completa */
  onOpenVisualReport?: (html: string) => void;
  /** Callback para solicitar modificaciones al agente sobre el bloque HTML */
  onRequestHtmlEdit?: (instruction: string, code: string) => void;
}

const BASE_COMPONENTS: Omit<Components, 'pre'> = {
  h1({ children }) {
    return (
      <h1 className="mt-5 mb-2.5 flex items-center gap-2 border-b border-border/50 pb-1.5 text-lg font-bold tracking-tight text-text sm:text-xl">
        <span className="inline-block h-4 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{children}</span>
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="mt-4 mb-2 flex items-center gap-2 text-base font-semibold tracking-tight text-text sm:text-lg">
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-primary/80" aria-hidden="true" />
        <span className="min-w-0 flex-1">{children}</span>
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="mt-3.5 mb-1.5 text-sm font-semibold text-text sm:text-base">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wider text-muted sm:text-sm">
        {children}
      </h4>
    );
  },
  h5({ children }) {
    return (
      <h5 className="mt-2.5 mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted">
        {children}
      </h5>
    );
  },
  h6({ children }) {
    return (
      <h6 className="mt-2 mb-0.5 text-xs font-medium text-muted">
        {children}
      </h6>
    );
  },
  p({ children }) {
    return (
      <p className="my-2 leading-relaxed text-text/95 break-words">
        {children}
      </p>
    );
  },
  ul({ children }) {
    return (
      <ul className="my-2.5 ml-4 list-disc space-y-1.5 pl-1 text-text marker:font-bold marker:text-primary">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="my-2.5 ml-4 list-decimal space-y-1.5 pl-1 text-text marker:font-semibold marker:text-primary">
        {children}
      </ol>
    );
  },
  li({ children }) {
    return (
      <li className="leading-relaxed pl-1">
        {children}
      </li>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            {children}
          </table>
        </div>
      </div>
    );
  },
  thead({ children }) {
    return (
      <thead className="border-b border-border bg-primary-soft/40 dark:bg-primary-soft/20 text-xs font-semibold uppercase tracking-wider text-text">
        {children}
      </thead>
    );
  },
  th({ children }) {
    return (
      <th className="px-4 py-2.5 font-semibold text-primary whitespace-nowrap">
        {children}
      </th>
    );
  },
  tbody({ children }) {
    return (
      <tbody className="divide-y divide-border/60">
        {children}
      </tbody>
    );
  },
  tr({ children }) {
    return (
      <tr className="transition-colors hover:bg-surface-subtle/80 even:bg-surface-subtle/25">
        {children}
      </tr>
    );
  },
  td({ children }) {
    return (
      <td className="px-4 py-2.5 text-text leading-relaxed align-top">
        {children}
      </td>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2.5 rounded-r-xl border-l-4 border-primary bg-primary-soft/30 dark:bg-primary-soft/15 px-3.5 py-2 italic text-text">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-4 h-px border-0 bg-gradient-to-r from-transparent via-border to-transparent" />;
  },
  strong({ children }) {
    return <strong className="font-semibold text-text">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-text/90">{children}</em>;
  },
  code({ children, className }) {
    return (
      <code className={cn('rounded-md border border-border/50 bg-surface-subtle px-1.5 py-0.5 font-mono text-[0.85em] font-medium text-primary shadow-2xs', className)}>
        {children}
      </code>
    );
  },
  a({ href, children }) {
    if (!isSafeHref(href)) return <span>{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary transition-colors hover:opacity-90"
      >
        {children}
      </a>
    );
  },
};

/** Markdown GFM sin HTML crudo: solo http/https se convierten en enlaces externos. */
export function Markdown({
  children,
  className,
  streaming = false,
  onOpenVisualReport,
  onRequestHtmlEdit,
}: MarkdownProps) {
  // Objeto estable mientras `streaming`, `onOpenVisualReport` o `onRequestHtmlEdit` no cambien
  const components = useMemo<Components>(
    () => ({
      ...BASE_COMPONENTS,
      pre({ node, children }) {
        const block = readCodeBlock(node);
        if (block === null) return <pre>{children}</pre>;
        return (
          <CodeBlock
            code={block.code}
            language={block.language}
            streaming={streaming}
            onExpand={onOpenVisualReport}
            onRequestEdit={onRequestHtmlEdit}
          />
        );
      },
    }),
    [streaming, onOpenVisualReport, onRequestHtmlEdit],
  );
  return (
    <div className={cn('space-y-2.5 break-words text-sm leading-relaxed text-text selection:bg-primary-soft selection:text-text', className)}>
      <MarkdownBase remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </MarkdownBase>
    </div>
  );
}

function readCodeBlock(node: HastNode): { code: string; language: string | null } | null {
  const child = node?.children[0];
  if (child === undefined || child.type !== 'element' || child.tagName !== 'code') return null;

  let code = '';
  for (const content of child.children) {
    if (content.type === 'text') code += content.value;
  }
  return { code, language: readLanguage(child.properties.className) };
}

function readLanguage(className: unknown): string | null {
  if (!Array.isArray(className)) return null;
  for (const entry of className) {
    if (typeof entry === 'string' && entry.startsWith('language-')) {
      return entry.slice('language-'.length);
    }
  }
  return null;
}

function isSafeHref(href: string | undefined): href is string {
  if (href === undefined) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
