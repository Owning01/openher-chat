import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale, t } from '@/i18n';

import type { CircuitStage } from './CircuitDialog';
import { CircuitDialog } from './CircuitDialog';

beforeEach(() => {
  localStorage.clear();
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

const STAGES: CircuitStage[] = [
  { role: 'redactor', conversationId: 'c-red', title: 'Demanda' },
  { role: 'atacante', conversationId: null, title: null },
  { role: 'juez', conversationId: null, title: null },
  { role: 'sintesis', conversationId: null, title: null },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof CircuitDialog>> = {}) {
  const handlers = {
    onDerive: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <CircuitDialog
      open
      caseTitle="Pérez c/ Gómez"
      currentConversationId="c-red"
      stages={STAGES}
      canDeriveAtacante
      canDeriveJuez={false}
      canDeriveSintesis={false}
      busy={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('CircuitDialog', () => {
  it('muestra las cuatro etapas en orden con sus reglas', () => {
    renderDialog();

    expect(screen.getByText(t('chat.circuitTitle'))).toBeInTheDocument();
    // El nombre del rol y el marcador "actual" viven en nodos de texto
    // separados: se matchea por contenido completo del párrafo.
    expect(
      screen.getByText((_, element) => element?.textContent === `${t('chat.circuitRole_redactor')} · ${t('chat.circuitCurrent')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === t('chat.circuitRole_atacante')),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === t('chat.circuitRole_juez')),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === t('chat.circuitRole_sintesis')),
    ).toBeInTheDocument();
  });

  it('la etapa existente se abre y la faltante se deriva', () => {
    const handlers = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: t('chat.circuitOpen') }));
    expect(handlers.onOpen).toHaveBeenCalledWith('c-red');

    fireEvent.click(screen.getByRole('button', { name: t('chat.circuitDeriveAtacante') }));
    expect(handlers.onDerive).toHaveBeenCalledWith('atacante');
  });

  it('deshabilita derivar sin documento y lo explica', () => {
    renderDialog({ canDeriveAtacante: false });

    const button = screen.getByRole('button', { name: t('chat.circuitDeriveAtacante') });
    expect(button).toBeDisabled();
    expect(screen.getByText(t('chat.circuitNeedsDoc'))).toBeInTheDocument();
  });

  it('no renderiza nada cuando está cerrado', () => {
    renderDialog({ open: false });

    expect(screen.queryByText(t('chat.circuitTitle'))).not.toBeInTheDocument();
  });
});
