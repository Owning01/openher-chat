import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@/i18n/useT';
import { useEscapeKey } from '@/shared/hooks/useEscapeKey';

import { Sidebar } from './Sidebar';

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Subconjunto estándar de elementos enfocables dentro del panel. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEscapeKey(onClose, open);

  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const currentPanel = panelRef.current;
      if (currentPanel === null) return;
      const focusables = getFocusableElements(currentPanel);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        currentPanel.focus();
        return;
      }
      const active = document.activeElement;
      // Foco fuera del panel (o en el propio dialog): entra por el borde correspondiente.
      if (active === currentPanel || !currentPanel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('app.sidebarLabel')}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl focus:outline-none"
      >
        <Sidebar className="h-full" onNavigate={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function getFocusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}
