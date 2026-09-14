import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import type { ChatRunStatus } from '../state/chatStore';
import { Composer, STOP_GUARD_MS } from './Composer';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

function setup(status: ChatRunStatus = 'idle') {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(<Composer status={status} onSend={onSend} onStop={onStop} />);
  return {
    onSend,
    onStop,
    textarea: screen.getByRole('textbox', { name: 'Escribe un mensaje…' }),
  };
}

describe('Composer', () => {
  it('envía con Enter y limpia el borrador', () => {
    const { onSend, textarea } = setup();

    fireEvent.change(textarea, { target: { value: 'hola' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('hola');
    expect(textarea).toHaveValue('');
  });

  it('inserta salto de línea con Shift+Enter', () => {
    const { onSend, textarea } = setup();

    fireEvent.change(textarea, { target: { value: 'primera' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('primera');
  });

  it('no envía borradores vacíos', () => {
    const { onSend } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('se deshabilita mientras corre y muestra Detener', () => {
    const { onSend, onStop, textarea } = setup('running');

    expect(textarea).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Detener' }));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('deshabilita Detener mientras se está deteniendo', () => {
    setup('stopping');

    expect(screen.getByRole('button', { name: 'Detener' })).toBeDisabled();
  });

  it('ignora el click de Stop inmediato tras enviar (doble click) y lo habilita después', () => {
    vi.useFakeTimers();
    try {
      const onSend = vi.fn();
      const onStop = vi.fn();
      const { rerender } = render(<Composer status="idle" onSend={onSend} onStop={onStop} />);

      fireEvent.change(screen.getByRole('textbox', { name: 'Escribe un mensaje…' }), {
        target: { value: 'hola' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      expect(onSend).toHaveBeenCalledWith('hola');

      rerender(<Composer status="running" onSend={onSend} onStop={onStop} />);
      const stop = screen.getByRole('button', { name: 'Detener' });
      expect(stop).toBeDisabled();

      fireEvent.click(stop);
      expect(onStop).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(STOP_GUARD_MS);
      });
      expect(stop).not.toBeDisabled();

      fireEvent.click(stop);
      expect(onStop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Composer — dictado por voz', () => {
  class FakeRecognition {
    static instances: FakeRecognition[] = [];
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
      FakeRecognition.instances.push(this);
    }
  }

  beforeEach(() => {
    FakeRecognition.instances = [];
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
  });

  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('añade el dictado sin borrar el texto escrito', async () => {
    render(<Composer status="idle" onSend={vi.fn()} onStop={vi.fn()} />);

    const textarea = screen.getByRole('textbox', { name: 'Escribe un mensaje…' });
    fireEvent.change(textarea, { target: { value: 'Hola' } });

    const mic = await screen.findByRole('button', { name: 'Dictar por voz' });
    await act(async () => {
      fireEvent.click(mic);
    });

    const rec = FakeRecognition.instances[0];
    act(() => {
      rec?.onresult?.({ results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'mundo' } } } });
    });

    expect(textarea).toHaveValue('Hola mundo');
  });

  it('el micrófono alterna a "Detener dictado" mientras escucha', async () => {
    render(<Composer status="idle" onSend={vi.fn()} onStop={vi.fn()} />);

    const mic = await screen.findByRole('button', { name: 'Dictar por voz' });
    await act(async () => {
      fireEvent.click(mic);
    });

    expect(screen.getByRole('button', { name: 'Detener dictado' })).toBeInTheDocument();
  });
});
