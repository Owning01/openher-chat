import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, resolveTheme } from './theme';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';

  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  } else {
    delete (window as unknown as Record<string, unknown>)['matchMedia'];
  }
});

describe('applyTheme', () => {
  it('aplica y quita la clase dark', () => {
    const cleanupDark = applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    cleanupDark();

    const cleanupLight = applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
    cleanupLight();
  });

  it('resuelve system con matchMedia y reacciona a sus cambios', () => {
    let prefersDark = false;
    const listeners = new Set<() => void>();

    const mediaQueryList = {
      media: '(prefers-color-scheme: dark)',
      get matches() {
        return prefersDark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    };

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => mediaQueryList as unknown as MediaQueryList),
    });

    expect(resolveTheme('system')).toBe('light');

    const cleanup = applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    prefersDark = true;
    for (const listener of listeners) listener();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    cleanup();
    expect(listeners.size).toBe(0);
  });

  it('cae a light cuando matchMedia no existe', () => {
    expect(typeof window.matchMedia).toBe('undefined');
    expect(resolveTheme('system')).toBe('light');

    const cleanup = applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    cleanup();
  });

  it('cae a light sin listener si matchMedia lanza', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw new Error('matchMedia no soportado');
      }),
    });

    expect(resolveTheme('system')).toBe('light');
    const cleanup = applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    cleanup();
  });

  it('cae a light si matchMedia devuelve un objeto sin matches', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({}) as MediaQueryList),
    });

    expect(resolveTheme('system')).toBe('light');
    const cleanup = applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    cleanup();
  });

  it('soporta el listener legacy addListener/removeListener', () => {
    let listener: (() => void) | null = null;
    const removeListener = vi.fn(() => {
      listener = null;
    });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(
        () =>
          ({
            matches: false,
            addListener: (callback: () => void) => {
              listener = callback;
            },
            removeListener,
          }) as unknown as MediaQueryList,
      ),
    });

    const cleanup = applyTheme('system');
    expect(listener).toBeTypeOf('function');
    cleanup();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(listener).toBeNull();
  });

  it('no registra listener si el MediaQueryList no expone ninguno', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: false }) as MediaQueryList),
    });

    const cleanup = applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    cleanup();
  });

  it('cleanup no lanza si hay addEventListener pero falta removeEventListener', () => {
    const addEventListener = vi.fn();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: false, addEventListener }) as unknown as MediaQueryList),
    });

    const cleanup = applyTheme('system');
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(() => cleanup()).not.toThrow();
  });

  it('cleanup cae a removeListener legacy si falta removeEventListener', () => {
    const addEventListener = vi.fn();
    const removeListener = vi.fn();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(
        () => ({ matches: false, addEventListener, removeListener }) as unknown as MediaQueryList,
      ),
    });

    const cleanup = applyTheme('system');
    cleanup();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
