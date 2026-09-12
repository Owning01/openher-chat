import { useEffect, useId, useState } from 'react';

import { Input } from '@/shared/ui';

import { clampToRange } from '../state/validation';

export interface NumberFieldProps {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  disabled?: boolean;
  allowNull?: boolean;
  onCommit(value: number | null): void;
}

/** Input numérico con draft local: valida y acota al confirmar (blur o Enter). */
export function NumberField({
  label,
  value,
  min,
  max,
  step,
  hint,
  disabled = false,
  allowNull = false,
  onCommit,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(formatValue(value));

  useEffect(() => {
    setDraft(formatValue(value));
  }, [value]);

  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (allowNull) {
        if (value !== null) onCommit(null);
        return;
      }
      setDraft(formatValue(value));
      return;
    }

    const parsed = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setDraft(formatValue(value));
      return;
    }

    const clamped = clampToRange(parsed, min, max);
    setDraft(formatValue(clamped));
    onCommit(clamped);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {hint !== undefined ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function formatValue(value: number | null): string {
  return value === null ? '' : String(value);
}
