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

  it('la respuesta del asistente se puede descargar como archivo', () => {
    render(
      <MessageList messages={[assistantMessage('a1', [{ type: 'text', text: 'escrito' }])]} runStatus="idle" {...handlers()} />,
    );

    expect(screen.getByRole('button', { name: 'Descargar como archivo' })).toBeInTheDocument();
  });

  it('la respuesta del asistente se puede descargar como Word', () => {
    render(
      <MessageList messages={[assistantMessage('a1', [{ type: 'text', text: '# Título' }])]} runStatus="idle" {...handlers()} />,
    );

    expect(screen.getByRole('button', { name: 'Descargar Word (.docx)' })).toBeInTheDocument();
  });

  it('el mensaje de usuario no ofrece descarga', () => {
    render(<MessageList messages={[userMessage('u1', 'hola')]} runStatus="idle" {...handlers()} />);

    expect(screen.queryByRole('button', { name: 'Descargar como archivo' })).not.toBeInTheDocument();
  });

  it('el adjunto del usuario va acoplado pero colapsado (se abre al tocar)', () => {
    const composed = 'mira el caso\n\n## Documento PDF: fallo.pdf\n```\ntexto largo del fallo\n```';
    const { container } = render(
      <MessageList messages={[userMessage('u1', composed)]} runStatus="idle" {...handlers()} />,
    );

    expect(screen.getByText('mira el caso')).toBeInTheDocument();
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary')?.textContent).toBe('fallo.pdf');
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('el asistente no colapsa sus bloques de código', () => {
    const { container } = render(
      <MessageList
        messages={[assistantMessage('a1', [{ type: 'text', text: '## Título\n```\ncódigo\n```' }])]}
        runStatus="idle"
        {...handlers()}
      />,
    );

    expect(container.querySelector('details')).toBeNull();
  });

  it('el mensaje de usuario muestra las imágenes adjuntas', () => {
    const message = userMessage('u1', '');
    message.content.push({
      type: 'image',
      imageId: 'img_1',
      name: 'foto.png',
      mime: 'image/png',
      dataUrl: 'data:image/png;base64,AAA',
    });
    render(<MessageList messages={[message]} runStatus="idle" {...handlers()} />);

    expect(screen.getByAltText('foto.png')).toBeInTheDocument();
  });

  it('en streaming difiere el highlight del bloque grande y lo colorea al completar', () => {
    const bigCode = `\`\`\`js\n${'const x = 1;\n'.repeat(500)}\`\`\``;
    const streaming = assistantMessage('a1', [{ type: 'text', text: bigCode }], { status: 'streaming' });
    const { container, rerender } = render(
      <MessageList messages={[streaming]} runStatus="running" {...handlers()} />,
    );

    expect(container.querySelector('.hljs-keyword')).toBeNull();
    expect(screen.getByTestId('streaming-cursor')).toBeInTheDocument();

    const complete = assistantMessage('a1', [{ type: 'text', text: bigCode }], { status: 'complete' });
    rerender(<MessageList messages={[complete]} runStatus="idle" {...handlers()} />);

    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('muestra el callout de informe visual y abre el diálogo al hacer click cuando hay reporte HTML', () => {
    const reportHtml = '```html\n<div class="card"><h1>Reporte Gráfico</h1></div>\n```';
    const message = assistantMessage('a1', [{ type: 'text', text: reportHtml }], { status: 'complete' });
    render(<MessageList messages={[message]} runStatus="idle" {...handlers()} />);

    const callout = screen.getByTestId('visual-report-callout');
    expect(callout).toBeInTheDocument();

    const openButtons = screen.getAllByRole('button', { name: 'Ver informe visual' });
    expect(openButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(openButtons[0]!);
    expect(screen.getByTestId('visual-report-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('visual-report-iframe')).toBeInTheDocument();
  });

  it('dispara onVisualReport al presionar Generar informe visual en un mensaje sin HTML', () => {
    const onVisualReport = vi.fn();
    const message = assistantMessage('a1', [{ type: 'text', text: 'Respuesta analítica sin html' }], {
      status: 'complete',
    });
    render(<MessageList messages={[message]} runStatus="idle" onVisualReport={onVisualReport} {...handlers()} />);

    const generateBtn = screen.getByRole('button', { name: 'Generar informe visual' });
    expect(generateBtn).toBeInTheDocument();

    fireEvent.click(generateBtn);
    expect(onVisualReport).toHaveBeenCalledWith('a1');
  });

  it('durante streaming de bloque html dibuja el artefacto interactivo en vivo con badge y permite expandir', () => {
    const partialHtml = 'Analizando métricas:\n```html\n<div class="metrics"><h1>Auditoría en Progreso</h1>';
    const streamingMsg = assistantMessage('a1', [{ type: 'text', text: partialHtml }], {
      status: 'streaming',
    });
    render(<MessageList messages={[streamingMsg]} runStatus="running" {...handlers()} />);

    // El artefacto interactivo se dibuja en vivo dentro del mensaje
    expect(screen.getByTestId('live-html-artifact')).toBeInTheDocument();
    expect(screen.getByTestId('live-drawing-badge')).toHaveTextContent('Dibujando en vivo…');
    expect(screen.getByTestId('live-artifact-iframe')).toBeInTheDocument();

    // Al pulsar el botón de expandir en el artefacto en vivo, abre el diálogo modal
    const expandBtn = screen.getByTestId('live-artifact-expand');
    expect(expandBtn).toBeInTheDocument();
    fireEvent.click(expandBtn);

    expect(screen.getByTestId('visual-report-dialog')).toBeInTheDocument();
  });
});

