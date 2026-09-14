import { useEffect } from 'react';

import { chatHref, navigate } from '@/app/routing';

export interface ChatShortcutsOptions {
  running: boolean;
  onStop: () => void;
  /** Selector del textarea del composer para el atajo de foco. */
  composerSelector?: string;
}

const DEFAULT_COMPOSER_SELECTOR = '[data-testid="chat-composer"] textarea';
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * Atajos globales del chat: `Ctrl/Cmd+K` nuevo chat, `Ctrl/Cmd+/` enfocar el
 * composer y `Escape` detener la generación en curso.
 */
export function useChatShortcuts({ running, onStop, composerSelector }: ChatShortcutsOptions): void {
  useEffect(() => {
    const selector = composerSelector ?? DEFAULT_COMPOSER_SELECTOR;

    const handleKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate(chatHref());
        return;
      }

      if (mod && event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>(selector)?.focus();
        return;
      }

      if (event.key === 'Escape' && running && !isEditableTarget(event.target)) {
        onStop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [running, onStop, composerSelector]);
}
