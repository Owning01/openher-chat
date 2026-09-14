import { useMemo } from 'react';

import type { ProviderConfig } from '@/domain/types/provider';
import { ChevronDown } from '@/shared/icons';
import { cn } from '@/shared/utils/cn';

export interface ModelPickerProps {
  providers: readonly ProviderConfig[];
  providerId: string | null;
  modelId: string | null;
  /** Etiqueta accesible del control. */
  label: string;
  /** Texto del option deshabilitado cuando no hay selección. */
  placeholder: string;
  onSelect(providerId: string, modelId: string): void;
  className?: string;
}

interface PickerOption {
  /** Clave opaca (índice) para el `<option>`: no expone ids al DOM. */
  key: string;
  providerId: string;
  modelId: string;
  label: string;
}

interface PickerGroup {
  providerId: string;
  label: string;
  options: PickerOption[];
}

interface PickerCatalog {
  groups: PickerGroup[];
  byKey: Map<string, PickerOption>;
  /** `${providerId}\u0000${modelId}` → key del option. */
  byTarget: Map<string, string>;
}

/** Selector compacto de modelo: agrupado por proveedor y ordenado por nombre. */
export function ModelPicker({
  providers,
  providerId,
  modelId,
  label,
  placeholder,
  onSelect,
  className,
}: ModelPickerProps) {
  const catalog = useMemo(() => buildCatalog(providers), [providers]);
  const value =
    providerId === null || modelId === null ? '' : (catalog.byTarget.get(targetKey(providerId, modelId)) ?? '');

  if (catalog.groups.length === 0) return null;

  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        aria-label={label}
        title={label}
        value={value}
        onChange={(event) => {
          const option = catalog.byKey.get(event.target.value);
          if (option !== undefined) onSelect(option.providerId, option.modelId);
        }}
        className="h-8 w-full appearance-none truncate rounded-md border border-border bg-surface pr-7 pl-2.5 text-xs text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {value === '' ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {catalog.groups.map((group) => (
          <optgroup key={group.providerId} label={group.label}>
            {group.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

function buildCatalog(providers: readonly ProviderConfig[]): PickerCatalog {
  const groups: PickerGroup[] = [];
  const byKey = new Map<string, PickerOption>();
  const byTarget = new Map<string, string>();
  let count = 0;

  const sortedProviders = [...providers].sort(
    (a, b) => compareName(a.label, b.label) || compareName(a.id, b.id),
  );

  for (const provider of sortedProviders) {
    const models = [...provider.models].sort(
      (a, b) => compareName(a.label, b.label) || compareName(a.id, b.id),
    );
    if (models.length === 0) continue;

    const options: PickerOption[] = models.map((model) => {
      const option: PickerOption = {
        key: String(count),
        providerId: provider.id,
        modelId: model.id,
        label: displayName(model.label, model.id),
      };
      count += 1;
      byKey.set(option.key, option);
      byTarget.set(targetKey(provider.id, model.id), option.key);
      return option;
    });

    groups.push({ providerId: provider.id, label: displayName(provider.label, provider.id), options });
  }

  return { groups, byKey, byTarget };
}

function targetKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

function displayName(label: string, fallback: string): string {
  const trimmed = label.trim();
  return trimmed === '' ? fallback : trimmed;
}

/** Orden por nombre: ignora mayúsculas y ordena números de forma natural. */
function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}
