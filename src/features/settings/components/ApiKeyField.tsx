import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useId, useState } from 'react';

import { useT } from '@/i18n/useT';
import { Badge, Button, IconButton, Input } from '@/shared/ui';

export interface ApiKeyFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  onSave(): void;
  onClear?: () => void;
  hasStoredKey?: boolean;
  disabled?: boolean;
  saving?: boolean;
  hint?: string;
}

/** Campo de API key con toggle mostrar/ocultar; el valor nunca sale del KeyVault. */
export function ApiKeyField({
  label,
  value,
  onChange,
  onSave,
  onClear,
  hasStoredKey = false,
  disabled = false,
  saving = false,
  hint,
}: ApiKeyFieldProps) {
  const t = useT();
  const id = useId();
  const [visible, setVisible] = useState(false);
  const canSave = value.trim() !== '' || hasStoredKey;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-text">
          {label}
        </label>
        <Badge variant={hasStoredKey ? 'success' : 'neutral'}>
          {hasStoredKey ? t('settings.apiKeyStored') : t('settings.apiKeyMissing')}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input
            id={id}
            type={visible ? 'text' : 'password'}
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('settings.apiKeyPlaceholder')}
            className="pr-10 pl-9"
            onChange={(event) => onChange(event.target.value)}
          />
          <IconButton
            className="absolute top-1/2 right-1 -translate-y-1/2"
            label={visible ? t('settings.apiKeyHide') : t('settings.apiKeyShow')}
            icon={visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            size="sm"
            onClick={() => setVisible((current) => !current)}
          />
        </div>
        <Button variant="secondary" disabled={disabled || !canSave} loading={saving} onClick={onSave}>
          {t('settings.apiKeySave')}
        </Button>
        {hasStoredKey && onClear !== undefined ? (
          <Button variant="ghost" disabled={disabled} onClick={onClear}>
            {t('settings.apiKeyClear')}
          </Button>
        ) : null}
      </div>
      {hint !== undefined ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
