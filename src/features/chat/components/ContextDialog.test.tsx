import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';
import type { ChatMessage } from '@/domain/types/chat';
import { ContextDialog } from './ContextDialog';

beforeEach(() => setLocale('es'));
afterEach(() => {
  cleanup();
  setLocale('es');
});

function createMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return {
    id: `m_${Math.random()}`,
    conversationId: 'c1',
    role,
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('ContextDialog', () => {
  it('renderiza información de tokens y umbral de 250k cuando open es true', () => {
    const onClose = vi.fn();
    const messages = [
      createMessage('user', 'Hola mundo'),
      createMessage('assistant', 'Hola, ¿en qué puedo ayudarte hoy?'),
    ];

    render(
      <ContextDialog
        open={true}
        onClose={onClose}
        messages={messages}
        summary="Resumen de prueba"
      />,
    );

    expect(screen.getByText('Estado del Contexto')).toBeInTheDocument();
    expect(screen.getByText('Consumo de Contexto')).toBeInTheDocument();
    expect(screen.getByText(/250k tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/250.000 tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/Autoresumen activo en memoria/i)).toBeInTheDocument();
    expect(screen.getByText(/Contexto 100% aislado por sesión/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no renderiza nada cuando open es false', () => {
    const { container } = render(
      <ContextDialog open={false} onClose={vi.fn()} messages={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
