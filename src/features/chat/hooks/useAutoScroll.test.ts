import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AUTO_SCROLL_THRESHOLD_PX, useAutoScroll } from './useAutoScroll';

interface ScrollStub {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

function createScrollElement(initial: ScrollStub): HTMLDivElement {
  const element = document.createElement('div');
  let scrollTop = initial.scrollTop;
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => initial.scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => initial.clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  return element;
}

describe('useAutoScroll', () => {
  it('sigue el fondo solo si el usuario ya estaba abajo', () => {
    const element = createScrollElement({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    const { result, rerender } = renderHook(({ revision }) => useAutoScroll<HTMLDivElement>(revision), {
      initialProps: { revision: 0 },
    });

    result.current.scrollRef.current = element;
    expect(result.current.isAtBottom).toBe(true);

    // El usuario sube más allá del umbral: deja de seguir.
    element.scrollTop = 500;
    act(() => result.current.onScroll());
    expect(result.current.isAtBottom).toBe(false);

    rerender({ revision: 1 });
    expect(element.scrollTop).toBe(500);

    // Vuelve al fondo (dentro del umbral): retoma el seguimiento.
    element.scrollTop = 1000 - 400 - (AUTO_SCROLL_THRESHOLD_PX - 10);
    act(() => result.current.onScroll());
    expect(result.current.isAtBottom).toBe(true);

    rerender({ revision: 2 });
    expect(element.scrollTop).toBe(1000);
  });

  it('scrollToBottom pega el contenedor al final', () => {
    const element = createScrollElement({ scrollHeight: 800, clientHeight: 300, scrollTop: 0 });
    const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(0));
    result.current.scrollRef.current = element;

    act(() => result.current.scrollToBottom());

    expect(element.scrollTop).toBe(800);
    expect(result.current.isAtBottom).toBe(true);
  });

  it('respeta el umbral configurado', () => {
    const element = createScrollElement({ scrollHeight: 500, clientHeight: 400, scrollTop: 60 });
    const { result } = renderHook(() => useAutoScroll<HTMLDivElement>(0, { threshold: 20 }));
    result.current.scrollRef.current = element;

    act(() => result.current.onScroll());

    expect(result.current.isAtBottom).toBe(false);
  });

  it('con enabled=false no arrastra al fondo ni ofrece el botón (estado vacío)', () => {
    const element = createScrollElement({ scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    const { result, rerender } = renderHook(({ revision }) => useAutoScroll<HTMLDivElement>(revision, { enabled: false }), {
      initialProps: { revision: 0 },
    });
    result.current.scrollRef.current = element;

    rerender({ revision: 1 });

    expect(element.scrollTop).toBe(0);
    expect(result.current.isAtBottom).toBe(true);

    // Aunque el usuario se aleje del fondo, sin mensajes no se muestra el botón.
    act(() => result.current.onScroll());
    expect(result.current.isAtBottom).toBe(true);
  });

  it('al habilitarse vuelve a pegarse al fondo', () => {
    const element = createScrollElement({ scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    const { result, rerender } = renderHook(
      ({ revision, enabled }) => useAutoScroll<HTMLDivElement>(revision, { enabled }),
      { initialProps: { revision: 0, enabled: false } },
    );
    result.current.scrollRef.current = element;

    rerender({ revision: 1, enabled: true });

    expect(element.scrollTop).toBe(900);
  });
});
