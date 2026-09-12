import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import { COPY_FEEDBACK_MS } from './CopyButton';
import { CodeBlock } from './CodeBlock';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
  vi.useRealTimers();
});

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('CodeBlock', () => {
  it('resalta con highlight.js y muestra el lenguaje', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="js" />);

    expect(screen.getByTestId('code-language')).toHaveTextContent('js');
    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
    expect(container.querySelector('.hljs-number')).not.toBeNull();
  });

  it('cae a texto plano con lenguaje desconocido y escapa el contenido', () => {
    const { container } = render(<CodeBlock code={'<img src=x onerror="boom()">'} language="desconocido" />);

    expect(screen.getByTestId('code-language')).toHaveTextContent('text');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
  });

  it('copia el código y muestra «Copiado» durante 1.2 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CodeBlock code="hola mundo" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await act(async () => undefined);

    expect(writeText).toHaveBeenCalledWith('hola mundo');
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });

    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
  });
});
