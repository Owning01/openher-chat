import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/useT';
import { X } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const INVALID_FOCUSABLE_SELECTOR = 'input[type="hidden"], [disabled], [hidden], [aria-hidden="true"]';

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.matches(INVALID_FOCUSABLE_SELECTOR) && element.closest('fieldset[disabled]') === null,
  );
}

/** Registro module-level de diálogos abiertos: solo el último atrapa foco y atiende Escape. */
const openDialogStack: object[] = [];

function isTopDialog(entry: object): boolean {
  return openDialogStack[openDialogStack.length - 1] === entry;
}

export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;

    const panel = panelRef.current;
    if (!panel) return undefined;

    const entry = {};
    openDialogStack.push(entry);

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = getFocusable(panel)[0] ?? panel;
    focusTarget.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTopDialog(entry)) return;

      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getFocusable(panel);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      const stackIndex = openDialogStack.indexOf(entry);
      if (stackIndex !== -1) openDialogStack.splice(stackIndex, 1);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'anim-scale-in relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xl focus:outline-none',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold text-text">
            {title}
          </h2>
          <IconButton label={t('common.close')} icon={<X />} size="sm" onClick={onClose} />
        </header>
        {children ? <div className="flex-1 min-h-0 flex flex-col text-sm text-text">{children}</div> : null}
        {footer ? <footer className="flex items-center justify-end gap-2">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
