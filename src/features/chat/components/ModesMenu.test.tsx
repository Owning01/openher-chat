import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function openMenu(): void {
  fireEvent.click(screen.getByTestId('modes-menu-button'));
}

describe('ModesMenu', () => {
  it('expone el botón con aria-haspopup y aria-expanded en la cabecera', () => {
    renderMenu();
    const button = screen.getByTestId('modes-menu-button');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    openMenu();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('modes-menu')).toHaveAttribute('role', 'menu');
  });

  it('muestra el estado general con ambos toggles apagados', () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Modo general: sin investigación ni expediente.',
    );
  });

  it('muestra el estado de sólo investigación', () => {
    renderMenu({ researchMode: true });
    openMenu();
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Investigación activada; sin expediente vinculado.',
    );
  });

  it('muestra el estado de sólo legal con el título del expediente', () => {
    renderMenu({ legalCaseId: 'case-1', legalCaseTitle: 'Pérez c/ Gómez' });
    openMenu();
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Expediente vinculado: Pérez c/ Gómez.',
    );
  });

  it('muestra el estado combinado investigación + legal', () => {
    renderMenu({ researchMode: true, legalCaseId: 'case-1', legalCaseTitle: 'Pérez c/ Gómez' });
    openMenu();
    expect(screen.getByTestId('modes-menu-research')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-legal')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('modes-menu-summary')).toHaveTextContent(
      'Investigación y expediente activos: Pérez c/ Gómez.',
    );
  });

  it('el toggle de investigación llama con el valor negado', () => {
    const props = renderMenu({ researchMode: false });
    openMenu();
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    expect(props.onToggleResearch).toHaveBeenCalledTimes(1);
    expect(props.onToggleResearch).toHaveBeenCalledWith(true);
  });

  it('apagar el modo legal desvincula sin abrir el diálogo', () => {
    const props = renderMenu({ legalCaseId: 'case-1', legalCaseTitle: 'Caso A' });
    openMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(props.onToggleLegal).toHaveBeenCalledTimes(1);
    expect(props.onToggleLegal).toHaveBeenCalledWith(false);
    expect(props.onOpenCaseDialog).not.toHaveBeenCalled();
  });

  it('encender el modo legal sin caso abre el diálogo de vínculo', () => {
    const props = renderMenu({ legalCaseId: null });
    openMenu();
    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(props.onOpenCaseDialog).toHaveBeenCalledTimes(1);
    expect(props.onToggleLegal).not.toHaveBeenCalled();
    // El diálogo toma el foco: el menú se cierra al delegar.
    expect(screen.queryByTestId('modes-menu')).not.toBeInTheDocument();
  });

  it('encender investigación no altera el estado legal y viceversa', () => {
    const props = renderMenu({ researchMode: false, legalCaseId: 'case-1' });
    openMenu();
    fireEvent.click(screen.getByTestId('modes-menu-research'));
    expect(props.onToggleResearch).toHaveBeenCalledWith(true);
    expect(props.onToggleLegal).not.toHaveBeenCalled();
    expect(props.onOpenCaseDialog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('modes-menu-legal'));
    expect(props.onToggleLegal).toHaveBeenCalledWith(false);
    expect(props.onToggleResearch).toHaveBeenCalledTimes(1);
  });

  it('cierra con Escape', () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId('modes-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('modes-menu')).not.toBeInTheDocument();
  });

  it('cierra con click afuera pero no con click adentro', () => {
    renderMenu();
    openMenu();
    fireEvent.mouseDown(screen.getByTestId('modes-menu-research'));
    expect(screen.getByTestId('modes-menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('modes-menu')).not.toBeInTheDocument();
  });

  it('mueve el foco al primer ítem al abrir', () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId('modes-menu-research')).toHaveFocus();
  });

  it('muestra "Abrir expediente" sólo con caso vinculado', () => {
    const props = renderMenu({ legalCaseId: 'case-1', onOpenCase: vi.fn() });
    openMenu();
    const openCase = screen.getByTestId('modes-menu-open-case');
    fireEvent.click(openCase);
    expect(props.onOpenCase).toHaveBeenCalledTimes(1);

    cleanup();
    renderMenu({ legalCaseId: null });
    openMenu();
    expect(screen.queryByTestId('modes-menu-open-case')).not.toBeInTheDocument();
  });

  it('ofrece "Configurar modo legal" sólo si el workspace no está configurado', () => {
    const props = renderMenu({ legalConfigured: false });
    openMenu();
    fireEvent.click(screen.getByTestId('modes-menu-configure'));
    expect(props.onConfigureLegal).toHaveBeenCalledTimes(1);

    cleanup();
    renderMenu({ legalConfigured: true });
    openMenu();
    expect(screen.queryByTestId('modes-menu-configure')).not.toBeInTheDocument();
  });

  it('el menú no desborda el viewport móvil (anclado a la derecha con tope de ancho)', () => {
    renderMenu();
    openMenu();
    const menu = screen.getByTestId('modes-menu');
    expect(menu.className).toContain('right-0');
    expect(menu.className).toContain('max-w-[calc(100vw-2rem)]');
    expect(menu.className).toContain('max-h-64');
    expect(menu.className).toContain('overflow-y-auto');
  });

  it('deshabilita el toggle de investigación cuando la fuente lo exige', () => {
    renderMenu({ researchDisabled: true });
    openMenu();
    expect(screen.getByTestId('modes-menu-research')).toBeDisabled();
    expect(screen.getByTestId('modes-menu-legal')).toBeEnabled();
  });
});
