import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Composer } from '@/features/chat/components/Composer';
import type { ComposerResearch } from '@/features/chat/components/Composer';
import { setLocale } from '@/i18n';

function renderComposer(research: Partial<ComposerResearch>) {
  const onToggle = vi.fn();
  render(
    <Composer
      status="idle"
      onSend={vi.fn()}
      onStop={vi.fn()}
      research={{ enabled: false, disabled: false, hint: null, onToggle, ...research }}
    />,
  );
  return onToggle;
}

beforeEach(() => setLocale('es'));

afterEach(() => {
  cleanup();
  setLocale('es');
});

describe('Composer - toggle de investigación', () => {
  it('refleja el estado y notifica el cambio', () => {
    const onToggle = renderComposer({ enabled: true });
    const toggle = screen.getByRole('switch', { name: 'Investigación' });

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('se deshabilita y explica el motivo cuando settings.tools no lo permite', () => {
    renderComposer({ disabled: true });
    const toggle = screen.getByRole('switch', { name: 'Investigación' });

    expect(toggle).toBeDisabled();
    expect(screen.getByText('La búsqueda web está desactivada en Ajustes.')).toBeInTheDocument();
  });

  it('muestra el aviso cuando falta proveedor o proxy', () => {
    renderComposer({ hint: 'Falta la API key de Brave.' });

    expect(screen.getByRole('status')).toHaveTextContent('Falta la API key de Brave.');
  });
});
