import MarkdownBase from 'react-markdown';
import type { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/shared/utils/cn';

import { CodeBlock } from './CodeBlock';

type HastNode = ExtraProps['node'];

export interface MarkdownProps {
  children: string;
  className?: string;
}

const COMPONENTS: Components = {
  pre({ node, children }) {
    const block = readCodeBlock(node);
    if (block === null) return <pre>{children}</pre>;
    return <CodeBlock code={block.code} language={block.language} />;
  },
  code({ children, className }) {
    return (
      <code className={cn('rounded bg-surface-subtle px-1 py-0.5 font-mono text-[0.85em] text-text', className)}>
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
        className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    );
  },
};

/** Markdown GFM sin HTML crudo: solo http/https se convierten en enlaces externos. */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('space-y-2 break-words text-sm leading-relaxed text-text', className)}>
      <MarkdownBase remarkPlugins={[remarkGfm]} components={COMPONENTS}>
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
