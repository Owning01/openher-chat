import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Distancia al fondo (px) por debajo de la cual el scroll se considera «pegado». */
export const AUTO_SCROLL_THRESHOLD_PX = 80;

export interface UseAutoScrollOptions {
  threshold?: number;
}

export interface UseAutoScrollResult<T extends HTMLElement> {
  scrollRef: RefObject<T | null>;
  isAtBottom: boolean;
  onScroll: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Auto-scroll condicional: sigue el fondo solo si el usuario ya estaba ahí;
 * si se aleja, expone `isAtBottom` para ofrecer el botón «ir al final».
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  revision: unknown,
  options: UseAutoScrollOptions = {},
): UseAutoScrollResult<T> {
  const threshold = options.threshold ?? AUTO_SCROLL_THRESHOLD_PX;
  const scrollRef = useRef<T | null>(null);
  const pinnedRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto'): void => {
    pinnedRef.current = true;
    setIsAtBottom(true);
    const element = scrollRef.current;
    if (element === null) return;
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior });
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback((): void => {
    const element = scrollRef.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance <= threshold;
    pinnedRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, [threshold]);

  useLayoutEffect(() => {
    if (!pinnedRef.current) return;
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, [revision]);

  return { scrollRef, isAtBottom, onScroll, scrollToBottom };
}
