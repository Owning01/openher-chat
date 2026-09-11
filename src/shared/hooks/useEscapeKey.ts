import { useEffect } from 'react';

export function useEscapeKey(handler: (event: KeyboardEvent) => void, active = true): void {
  useEffect(() => {
    if (!active) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') handler(event);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handler, active]);
}
