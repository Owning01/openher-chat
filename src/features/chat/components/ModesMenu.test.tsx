import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '@/i18n';

import { ModesMenu } from './ModesMenu';
import type { ModesMenuProps } from './ModesMenu';

beforeEach(() => {
  setLocale('es');
});

afterEach(() => {
  cleanup();
  setLocale('es');
});

function renderMenu(overrides: Partial<ModesMenuProps> = {}): ModesMenuProps {
  const props: ModesMenuProps = {
    researchMode: false,
    legalCaseId: null,
    legalConfigured: true,
    onToggleResearch: vi.fn(),
    onToggleLegal: vi.fn(),
    onOpenCaseDialog: vi.fn(),
    onConfigureLegal: vi.fn(),
    ...overrides,
  };
  render(<ModesMenu {...props} />);
  return props;
}

describe('ModesMenu', () => {
  it('muestra los dos modos rotulados siempre visibles, sin abrir nada', () => {
    renderMenu();
    expect(screen.getByTestId('modes-menu')).toBeInTheDocument();
    // Compatibilidad: ChatPage.test.tsx abre los modos clickeando este testid.
    expect(screen.getByTestId('modes-menu-button')).toBeInTheDocument();

    const research = screen.getByTestId('modes-menu-research');
    const legal = screen.getByTestId('modes-menu-legal');
    expect(research).toHaveAttribute('role', 'switch');
    expect(research).toHaveAttribute('aria-checked', 'false');
    expect(legal).toHaveAttribute('role', 'switch');
    expect(legal).toHaveAttribute('aria-checked', 'false');
    // El modo abogado es un Switch rotulado dentro de su contenedor propio.
    const legalSwitch = screen.getByTestId('legal-switch');
    expect(legalSwitch).toContainElement(legal);
    expect(within(legalSwitch).getByText('Modo abogado')).toBeInTheDocument();
    expect(screen.getByText('Buscar en internet')).toBeInTheDocument();
    expect(screen.getByText('Modo abogado')).toBeInTheDocument();
    expect(screen.getByText('Buscar')).toBeInTheDocument();
    expect(screen.getByText('Abogado')).toBeInTheDocument();
  });

  it('expone nombre accesible y área táctil por control', () => {
    renderMenu();
    const research = screen.getByRole('switch', { name: 'Buscar en internet' });
    const legal = screen.getByRole('switch', { name: 'Modo abogado' });
    expect(research).toBe(screen.getByTestId('modes-menu-research'));
    expect(legal).toBe(screen.getByTestId('modes-menu-legal'));
    expect(research.className).toContain('h-9');
    expect(research.className).toContain('hit-expand');
    expect(research.className).toContain('text-sm');
    // El Switch legal conserva hitbox expandido (44px táctiles) pese a su tamaño visual.
    expect(legal.className).toContain('hit-expand');
    expect(legal.className).toContain('w-11');
    expect(screen.getByTestId('legal-switch')).toContainElement(legal);
  });

  it('marca el modo activo con el color primary', () => {
    renderMenu({ researchMode: true });
    const research = screen.getByTestId('modes-menu-research');
    expect(research.className).toContain('bg-primary-soft');
    expect(research.querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('modes-menu-legal').className).not.toContain('bg-primary');

    cleanup();
    renderMenu({ legalCaseId: 'case-1' });
    // El Switch encendido se pinta con primary; el toggle de investigación sigue apagado.
    expect(screen.getByTestId('modes-menu-legal').className).toContain('bg-primary');
    expect(screen.getByTestId('modes-menu-research').className).not.toContain('bg-primary-soft');
  });

  it('muestra el estado general en lenguaje llano', () => {
    renderMenu();
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Modo general (normal): sin investigación ni expediente.',
    );
  });

  it('muestra el estado de sólo investigación', () => {
    renderMenu({ researchMode: true });
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Busca en internet: sin expediente vinculado.',
    );
  });

  it('muestra el estado de sólo abogado con el título del expediente', () => {
    renderMenu({ legalCaseId: 'case-1', legalCaseTitle: 'Pérez c/ Gómez' });
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Modo abogado — Expediente vinculado: Pérez c/ Gómez.',
    );
  });

  it('muestra el estado combinado internet + abogado', () => {
    renderMenu({ researchMode: true, legalCaseId: 'case-1', legalCaseTitle: 'Pérez c/ Gómez' });
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Internet + abogado — Investigación y expediente activos: Pérez c/ Gómez.',
    );
  });

  it('el toggle de investigación llama con el valor negado', () => {
    const props = renderMenu({ researchMode: false });
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    expect(props.onToggleResearch).toHaveBeenCalledTimes(1);
    expect(props.onToggleResearch).toHaveBeenCalledWith(true);
    expect(props.onToggleLegal).not.toHaveBeenCalled();

    cleanup();
    const activeProps = renderMenu({ researchMode: true });
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    expect(activeProps.onToggleResearch).toHaveBeenCalledWith(false);
  });

  it('apagar el modo abogado desvincula sin abrir el diálogo', () => {
    const props = renderMenu({ legalCaseId: 'case-1', legalCaseTitle: 'Caso A' });
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(props.onToggleLegal).toHaveBeenCalledTimes(1);
    expect(props.onToggleLegal).toHaveBeenCalledWith(false);
    expect(props.onOpenCaseDialog).not.toHaveBeenCalled();
  });

  it('encender el modo abogado sin caso abre el diálogo de vínculo', () => {
    const props = renderMenu({ legalCaseId: null });
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(props.onOpenCaseDialog).toHaveBeenCalledTimes(1);
    expect(props.onToggleLegal).not.toHaveBeenCalled();
  });

  it('los modos son ortogonales: uno no altera al otro', () => {
    const props = renderMenu({ researchMode: false, legalCaseId: 'case-1' });
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    expect(props.onToggleResearch).toHaveBeenCalledWith(true);
    expect(props.onToggleLegal).not.toHaveBeenCalled();
    expect(props.onOpenCaseDialog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(props.onToggleLegal).toHaveBeenCalledWith(false);
    expect(props.onToggleResearch).toHaveBeenCalledTimes(1);
  });

  it('muestra "Abrir expediente" sólo con caso vinculado y lo dispara', () => {
    const props = renderMenu({ legalCaseId: 'case-1', onOpenCase: vi.fn() });
    fireEvent.click(screen.getByTestId('modes-menu-open-case'));
    expect(props.onOpenCase).toHaveBeenCalledTimes(1);

    cleanup();
    renderMenu({ legalCaseId: null, onOpenCase: vi.fn() });
    expect(screen.queryByTestId('modes-menu-open-case')).not.toBeInTheDocument();
  });

  it('ofrece "Configurar modo legal" sólo si el workspace no está configurado', () => {
    const props = renderMenu({ legalConfigured: false });
    fireEvent.click(screen.getByTestId('modes-menu-configure'));
    expect(props.onConfigureLegal).toHaveBeenCalledTimes(1);

    cleanup();
    renderMenu({ legalConfigured: true });
    expect(screen.queryByTestId('modes-menu-configure')).not.toBeInTheDocument();
  });

  it('deshabilita el toggle de investigación cuando la fuente lo exige', () => {
    renderMenu({ researchDisabled: true });
    expect(screen.getByTestId('modes-menu-research')).toBeDisabled();
    expect(screen.getByTestId('modes-menu-legal')).toBeEnabled();
  });

  it('traduce rótulos y estado al inglés', () => {
    setLocale('en');
    renderMenu();
    expect(screen.getByRole('switch', { name: 'Search the web' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lawyer mode' })).toBeInTheDocument();
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent('General mode (normal)');
  });
});
