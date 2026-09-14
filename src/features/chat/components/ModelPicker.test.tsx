import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderConfig } from '@/domain/types/provider';

import { ModelPicker } from './ModelPicker';

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'zeta',
    label: 'Zeta',
    kind: 'openai-compatible',
    baseUrl: 'https://zeta.example/v1',
    requiresKey: false,
    keyRef: null,
    models: [
      { id: 'z2', label: 'zeta modelo', source: 'manual' },
      { id: 'z1', label: 'Alfa modelo', source: 'manual' },
    ],
    defaultModelId: 'z1',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'beta',
    label: 'beta',
    kind: 'openai-compatible',
    baseUrl: 'https://beta.example/v1',
    requiresKey: false,
    keyRef: null,
    models: [{ id: 'b1', label: 'Bravo', source: 'manual' }],
    defaultModelId: 'b1',
    createdAt: 0,
    updatedAt: 0,
  },
];

function optionValues(container: HTMLElement, text: string): string {
  const option = Array.from(container.querySelectorAll('option')).find((entry) => entry.textContent === text);
  if (option === undefined) throw new Error(`missing option ${text}`);
  return option.value;
}

afterEach(cleanup);

describe('ModelPicker', () => {
  it('agrupa por proveedor y ordena por nombre', () => {
    const { container } = render(
      <ModelPicker
        providers={PROVIDERS}
        providerId="zeta"
        modelId="z1"
        label="Modelo"
        placeholder="Modelo"
        onSelect={() => undefined}
      />,
    );

    const groups = Array.from(container.querySelectorAll('optgroup'));
    expect(groups.map((group) => group.label)).toEqual(['beta', 'Zeta']);

    const zeta = groups[1];
    if (zeta === undefined) throw new Error('missing Zeta group');
    expect(Array.from(zeta.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'Alfa modelo',
      'zeta modelo',
    ]);
    expect(screen.getByRole('combobox', { name: 'Modelo' })).toHaveValue(optionValues(container, 'Alfa modelo'));
  });

  it('notifica proveedor y modelo al elegir una opción', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ModelPicker
        providers={PROVIDERS}
        providerId="beta"
        modelId="b1"
        label="Modelo"
        placeholder="Modelo"
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Modelo' }), {
      target: { value: optionValues(container, 'zeta modelo') },
    });

    expect(onSelect).toHaveBeenCalledWith('zeta', 'z2');
  });

  it('no renderiza nada sin modelos disponibles', () => {
    const { container } = render(
      <ModelPicker
        providers={[{ ...PROVIDERS[0]!, models: [] }]}
        providerId={null}
        modelId={null}
        label="Modelo"
        placeholder="Modelo"
        onSelect={() => undefined}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
