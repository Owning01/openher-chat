import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageError } from '@/domain/types/chat';
import { setLocale } from '@/i18n';

import { ErrorBanner } from './ErrorBanner';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

function buildError(overrides: Partial<MessageError> = {}): MessageError {
  return { code: 'network', message: 'fetch failed', retryable: true, ...overrides };
}

describe('ErrorBanner', () => {
  it('muestra el mensaje traducido y reintenta cuando es retryable', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner error={buildError()} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('No hay conexión con el proveedor.');
    expect(screen.getByRole('alert')).toHaveTextContent('fetch failed');

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('no ofrece reintento cuando el error no es retryable', () => {
    render(<ErrorBanner error={buildError({ code: 'auth', retryable: false })} onRetry={() => undefined} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Revisa la API key del proveedor.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('traduce cada código de error común', () => {
    const codes = [
      ['auth', 'Revisa la API key del proveedor.'],
      ['rate_limit', 'El proveedor limitó la frecuencia. Inténtalo en un momento.'],
      ['timeout', 'La respuesta tardó demasiado.'],
      ['server', 'El proveedor devolvió un error interno.'],
      ['invalid_request', 'La solicitud no es válida para este modelo.'],
      ['context_length', 'La conversación supera el contexto del modelo.'],
      ['aborted', 'La respuesta se detuvo.'],
      ['unknown', 'Ocurrió un error inesperado.'],
    ] as const;

    for (const [code, expected] of codes) {
      const { unmount } = render(
        <ErrorBanner error={buildError({ code, retryable: false })} onRetry={() => undefined} />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(expected);
      unmount();
    }
  });
});
