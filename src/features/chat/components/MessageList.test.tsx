import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import { MessageList } from './MessageList';
import { assistantMessage, userMessage } from './__fixtures__/messages';

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

const handlers = () => ({
  onRegenerate: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
});

describe('MessageList', () => {
  it('renderiza los bloques en orden: text, reasoning y tool', () => {
    const message = assistantMessage('a1', [
      { type: 'text', text: 'Primero' },
      { type: 'reasoning', text: 'Pensando' },
      { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{}' } },
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'web_search',
        result: { ok: true, content: 'resultado', durationMs: 1500 },
      },
      { type: 'text', text: 'Después' },
    ]);
    const { container } = render(
      <MessageList messages={[message]} runStatus="idle" {...handlers()} />,
    );

    const blocks = [...container.querySelectorAll('[data-block]')];
    expect(blocks.map((block) => block.getAttribute('data-block'))).toEqual(['text', 'reasoning', 'tool', 'text']);
  });

  it('colapsa el razonamiento hasta que se expande', () => {
    const message = assistantMessage('a1', [{ type: 'reasoning', text: 'Cadena de pensamiento' }]);
    render(<MessageList messages={[message]} runStatus="idle" {...handlers()} />);

    expect(screen.queryByText('Cadena de pensamiento')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Razonamiento' }));
    expect(screen.getByText('Cadena de pensamiento')).toBeInTheDocument();
  });

  it('muestra la tarjeta de herramienta con estado y duración', () => {
    const message = assistantMessage('a1', [
      { type: 'tool-call', toolCall: { id: 't1', name: 'web_search', argumentsText: '{}' } },
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'web_search',
        result: { ok: true, content: 'resultado', durationMs: 1500 },
      },
      { type: 'tool-call', toolCall: { id: 't2', name: 'open_url', argumentsText: '{}' } },
    ]);
    render(<MessageList messages={[message]} runStatus="running" {...handlers()} />);

    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('Completado')).toBeInTheDocument();
    expect(screen.getByText('1.5 s')).toBeInTheDocument();
    expect(screen.getByText('open_url')).toBeInTheDocument();
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });

  it('renderiza los mensajes de usuario como texto plano', () => {
    const message = userMessage('u1', '**no es negrita**');
    const { container } = render(<MessageList messages={[message]} runStatus="idle" {...handlers()} />);

    expect(screen.getByText('**no es negrita**')).toBeInTheDocument();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('solo permite regenerar el último mensaje del asistente', () => {
    const fakes = handlers();
    render(
      <MessageList
        messages={[assistantMessage('a1', [{ type: 'text', text: 'uno' }]), userMessage('u1', 'seguí'), assistantMessage('a2', [{ type: 'text', text: 'dos' }])]}
        runStatus="idle"
        {...fakes}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerar' }));
    expect(fakes.onRegenerate).toHaveBeenCalledTimes(1);
    expect(fakes.onRegenerate).toHaveBeenCalledWith('a2');
  });

  it('edita un mensaje de usuario inline con guardar y cancelar', () => {
    const fakes = handlers();
    render(<MessageList messages={[userMessage('u1', 'original')]} runStatus="idle" {...fakes} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar mensaje' }));
    const textarea = screen.getByRole('textbox', { name: 'Editar mensaje' });
    fireEvent.change(textarea, { target: { value: 'corregido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(fakes.onEdit).toHaveBeenCalledWith('u1', 'corregido');
  });

  it('cancela la edición sin llamar al store', () => {
    const fakes = handlers();
    render(<MessageList messages={[userMessage('u1', 'original')]} runStatus="idle" {...fakes} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar mensaje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(fakes.onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('original')).toBeInTheDocument();
  });

  it('borra el mensaje con su id y copia el texto', async () => {
    const fakes = handlers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MessageList messages={[userMessage('u1', 'hola mundo')]} runStatus="idle" {...fakes} />);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar mensaje' }));
    expect(fakes.onDelete).toHaveBeenCalledWith('u1');

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('hola mundo'));
  });

  it('deshabilita las acciones mientras el run está activo', () => {
    render(<MessageList messages={[assistantMessage('a1', [{ type: 'text', text: 'uno' }])]} runStatus="running" {...handlers()} />);

    expect(screen.getByRole('button', { name: 'Regenerar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eliminar mensaje' })).toBeDisabled();
  });
});
